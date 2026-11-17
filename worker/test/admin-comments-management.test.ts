import { describe, expect, it } from "vitest"
import {
  activePrefix,
  initializedContext,
  request,
  seedSession
} from "./support/app"
import type {
  AdminCommentBatchResult,
  AdminDeleteCommentResult,
  AdminImportResult,
  AdminListCommentsResult,
  CalineDataDump,
  CalineSiteSettings,
  CreateCommentResult
} from "@caline/shared"

describe("Admin Comments and System Management", () => {
  it("enforces admin authentication on all /api/admin endpoints", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const userSession = await seedSession(db, prefix, { role: "user" })

    // Unauthenticated
    const unauth = await request(env, "/api/admin/comments")
    expect(unauth.status).toBe(401)

    // Normal user (forbidden)
    const forbidden = await request(env, "/api/admin/comments", {
      headers: { Cookie: userSession.cookie }
    })
    expect(forbidden.status).toBe(403)
  })

  it("lists, searches, and filters comments with IP, UA, and real email", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const adminSession = await seedSession(db, prefix, { role: "admin" })

    // Create 1 approved and 1 waiting comment
    await request(env, "/api/comments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSession.cookie,
        "User-Agent": "AdminAgent/1.0"
      },
      body: JSON.stringify({
        url: "/posts/searchable",
        content: "Admin approved comment"
      })
    })

    await request(env, "/api/comments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "192.168.1.100",
        "User-Agent": "GuestAgent/2.0"
      },
      body: JSON.stringify({
        url: "/posts/searchable",
        content: "Visitor waiting comment keywordXYZ",
        nick: "SearchVisitor",
        mail: "visitor@private.mail"
      })
    })

    // List all
    const allRes = await request(env, "/api/admin/comments", {
      headers: { Cookie: adminSession.cookie }
    })
    expect(allRes.status).toBe(200)
    const allBody = (await allRes.json()) as { data: AdminListCommentsResult }
    expect(allBody.data.items.length).toBe(2)

    // Filter by status=waiting
    const waitingRes = await request(
      env,
      "/api/admin/comments?status=waiting",
      {
        headers: { Cookie: adminSession.cookie }
      }
    )
    const waitingBody = (await waitingRes.json()) as {
      data: AdminListCommentsResult
    }
    expect(waitingBody.data.items.length).toBe(1)
    expect(waitingBody.data.items[0].mail).toBe("visitor@private.mail")
    expect(waitingBody.data.items[0].ip).toBe("192.168.1.100")
    expect(waitingBody.data.items[0].ua).toBe("GuestAgent/2.0")

    // Search by keyword q
    const qRes = await request(env, "/api/admin/comments?q=keywordXYZ", {
      headers: { Cookie: adminSession.cookie }
    })
    const qBody = (await qRes.json()) as { data: AdminListCommentsResult }
    expect(qBody.data.items.length).toBe(1)
    expect(qBody.data.items[0].contentRaw).toContain("keywordXYZ")
  })

  it("updates comment status, sticky flag, and content with sanitization", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const adminSession = await seedSession(db, prefix, { role: "admin" })

    const postRes = await request(env, "/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "/posts/update-test",
        content: "Initial content",
        nick: "Guest"
      })
    })
    const id = ((await postRes.json()) as { data: CreateCommentResult }).data
      .comment.id

    const patchRes = await request(env, `/api/admin/comments/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSession.cookie
      },
      body: JSON.stringify({
        status: "approved",
        sticky: true,
        content: "New content **bold** <script>alert(1)</script>"
      })
    })
    expect(patchRes.status).toBe(200)

    // Verify change took effect in public comments
    const listRes = await request(env, "/api/comments?url=/posts/update-test")
    const listBody = (await listRes.json()) as {
      data: { items: Array<{ contentHtml: string; sticky: boolean }> }
    }
    expect(listBody.data.items.length).toBe(1)
    expect(listBody.data.items[0].sticky).toBe(true)
    expect(listBody.data.items[0].contentHtml).toContain(
      "<strong>bold</strong>"
    )
    expect(listBody.data.items[0].contentHtml).not.toContain("<script")
  })

  it("performs cascade deletion of root comment and all its replies", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const adminSession = await seedSession(db, prefix, { role: "admin" })

    // Create root
    const rootRes = await request(env, "/api/comments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSession.cookie
      },
      body: JSON.stringify({ url: "/posts/cascade", content: "Root" })
    })
    const rootId = ((await rootRes.json()) as { data: CreateCommentResult })
      .data.comment.id

    // Create reply1 to root
    const reply1Res = await request(env, "/api/comments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSession.cookie
      },
      body: JSON.stringify({
        url: "/posts/cascade",
        content: "Reply 1",
        pid: rootId
      })
    })
    const reply1Id = ((await reply1Res.json()) as { data: CreateCommentResult })
      .data.comment.id

    // Create reply2 to reply1
    const reply2Res = await request(env, "/api/comments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSession.cookie
      },
      body: JSON.stringify({
        url: "/posts/cascade",
        content: "Reply 2",
        pid: reply1Id
      })
    })
    const reply2Id = ((await reply2Res.json()) as { data: CreateCommentResult })
      .data.comment.id

    // Cascade delete root
    const delRes = await request(env, `/api/admin/comments/${rootId}`, {
      method: "DELETE",
      headers: { Cookie: adminSession.cookie }
    })
    expect(delRes.status).toBe(200)
    const delBody = (await delRes.json()) as { data: AdminDeleteCommentResult }
    expect(delBody.data.success).toBe(true)
    expect(delBody.data.deletedCount).toBe(3)
    expect(delBody.data.deletedIds).toContain(rootId)
    expect(delBody.data.deletedIds).toContain(reply1Id)
    expect(delBody.data.deletedIds).toContain(reply2Id)

    // Public list should now be completely empty
    const listRes = await request(env, "/api/comments?url=/posts/cascade")
    const listBody = (await listRes.json()) as { data: { items: unknown[] } }
    expect(listBody.data.items.length).toBe(0)
  })

  it("handles batch status changes and batch cascade deletion", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const adminSession = await seedSession(db, prefix, { role: "admin" })

    // Create 3 waiting visitor comments
    const ids: number[] = []
    for (let i = 1; i <= 3; i++) {
      const res = await request(env, "/api/comments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": `127.0.0.${i}`
        },
        body: JSON.stringify({
          url: "/posts/batch",
          content: `Batch item ${i}`,
          nick: `User${i}`
        })
      })
      ids.push(
        ((await res.json()) as { data: CreateCommentResult }).data.comment.id
      )
    }

    // Batch approve first two
    const batchApproveRes = await request(env, "/api/admin/comments/batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSession.cookie
      },
      body: JSON.stringify({
        ids: [ids[0], ids[1]],
        action: "approve"
      })
    })
    expect(batchApproveRes.status).toBe(200)
    const approveBody = (await batchApproveRes.json()) as {
      data: AdminCommentBatchResult
    }
    expect(approveBody.data.affectedCount).toBe(2)

    // Batch delete all three
    const batchDeleteRes = await request(env, "/api/admin/comments/batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSession.cookie
      },
      body: JSON.stringify({
        ids,
        action: "delete"
      })
    })
    expect(batchDeleteRes.status).toBe(200)
    const deleteBody = (await batchDeleteRes.json()) as {
      data: AdminCommentBatchResult
    }
    expect(deleteBody.data.affectedCount).toBe(3)
  })

  it("manages user role, label, and status with last admin guards", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const adminSession = await seedSession(db, prefix, { role: "admin" })
    const targetSession = await seedSession(db, prefix, {
      role: "user",
      email: "worker@site.test"
    })

    // Update target user label and role to admin
    const patchRes = await request(
      env,
      `/api/admin/users/${targetSession.userId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminSession.cookie
        },
        body: JSON.stringify({
          role: "admin",
          label: "协管员"
        })
      }
    )
    expect(patchRes.status).toBe(200)

    // Verify label in listUsers
    const listRes = await request(env, "/api/admin/users", {
      headers: { Cookie: adminSession.cookie }
    })
    const listBody = (await listRes.json()) as {
      items: Array<{ id: number; label?: string; role: string }>
    }
    const target = listBody.items.find((u) => u.id === targetSession.userId)
    expect(target?.label).toBe("协管员")
    expect(target?.role).toBe("admin")

    // Demote target back to user
    await request(env, `/api/admin/users/${targetSession.userId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSession.cookie
      },
      body: JSON.stringify({ role: "user" })
    })

    // Now adminSession is the last admin: attempting to demote or disable adminSession fails
    const demoteLastRes = await request(
      env,
      `/api/admin/users/${adminSession.userId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminSession.cookie
        },
        body: JSON.stringify({ role: "user" })
      }
    )
    expect(demoteLastRes.status).toBe(409)

    // Attempting to delete oneself fails with 403
    const selfDeleteRes = await request(
      env,
      `/api/admin/users/${adminSession.userId}`,
      {
        method: "DELETE",
        headers: { Cookie: adminSession.cookie }
      }
    )
    expect(selfDeleteRes.status).toBe(403)
  })

  it("reads and updates site settings", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const adminSession = await seedSession(db, prefix, { role: "admin" })

    // Read initial settings
    const getRes = await request(env, "/api/admin/settings", {
      headers: { Cookie: adminSession.cookie }
    })
    expect(getRes.status).toBe(200)
    const getBody = (await getRes.json()) as { site: CalineSiteSettings }
    expect(getBody.site.auditSwitch).toBe(false)
    expect(getBody.site.guestMode).toBe("open")

    // Update settings
    const putRes = await request(env, "/api/admin/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSession.cookie
      },
      body: JSON.stringify({
        site: {
          auditSwitch: true,
          guestMode: "login_only",
          reservedNicks: ["Root", "Chief"],
          disallowedWords: ["spamword"],
          maxContentLength: 500
        }
      })
    })
    expect(putRes.status).toBe(200)
    const putBody = (await putRes.json()) as { site: CalineSiteSettings }
    expect(putBody.site.auditSwitch).toBe(true)
    expect(putBody.site.guestMode).toBe("login_only")
    expect(putBody.site.reservedNicks).toContain("Root")
    expect(putBody.site.maxContentLength).toBe(500)
  })

  it("handles export and import with overwrite confirmation guard", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const adminSession = await seedSession(db, prefix, { role: "admin" })

    // Create a comment and a pageview
    await request(env, "/api/comments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSession.cookie
      },
      body: JSON.stringify({ url: "/export-page", content: "To be exported" })
    })

    await request(env, "/api/pages/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "/export-page" })
    })

    // GET /api/admin/export
    const exportRes = await request(env, "/api/admin/export", {
      headers: { Cookie: adminSession.cookie }
    })
    expect(exportRes.status).toBe(200)
    const exportBody = (await exportRes.json()) as { data: CalineDataDump }
    expect(exportBody.data.version).toBe("1.0.0")
    expect(exportBody.data.comments.length).toBeGreaterThanOrEqual(1)
    expect(exportBody.data.counters.length).toBeGreaterThanOrEqual(1)
    expect(exportBody.data.users.length).toBeGreaterThanOrEqual(1)

    // Security assertion: password_hash must never be exported!
    for (const u of exportBody.data.users) {
      expect("password_hash" in u).toBe(false)
    }

    const dump = exportBody.data

    // POST /api/admin/import without overwrite flag -> 409
    const noOverwriteRes = await request(env, "/api/admin/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSession.cookie
      },
      body: JSON.stringify({ data: dump })
    })
    expect(noOverwriteRes.status).toBe(409)

    // POST /api/admin/import with overwrite: true -> 200
    const overwriteRes = await request(env, "/api/admin/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSession.cookie
      },
      body: JSON.stringify({ data: dump, overwrite: true })
    })
    expect(overwriteRes.status).toBe(200)
    const importBody = (await overwriteRes.json()) as {
      data: AdminImportResult
    }
    expect(importBody.data.success).toBe(true)
    expect(importBody.data.importedComments).toBe(dump.comments.length)
    expect(importBody.data.importedCounters).toBe(dump.counters.length)
  })
})
