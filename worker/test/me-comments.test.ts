import { describe, expect, it } from "vitest"
import {
  activePrefix,
  initializedContext,
  request,
  seedSession
} from "./support/app"
import { insertComment } from "../src/db/queries/comments"
import type {
  DeleteCommentResult,
  ListMeCommentsResult,
  UpdateCommentResult
} from "@caline/shared"

describe("GET /api/me/comments（成员本人评论列表）与改删权限", () => {
  it("未登录访问返回 401", async () => {
    const { env } = await initializedContext()
    const res = await request(env, "/api/me/comments")
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe("Unauthorized")
  })

  it("成员只能查到本人评论、查不到他人评论与访客评论，且包含 approved/waiting/spam 全状态", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)

    const userA = await seedSession(db, prefix, {
      email: "user_a@example.com",
      role: "user"
    })
    const userB = await seedSession(db, prefix, {
      email: "user_b@example.com",
      role: "user"
    })

    // User A comments: 3 different statuses
    await insertComment(db, prefix, {
      userId: userA.userId,
      url: "/posts/1",
      contentRaw: "User A Approved",
      contentHtml: "<p>User A Approved</p>",
      status: "approved",
      createdAt: "2026-11-18T10:00:00.000Z"
    })
    await insertComment(db, prefix, {
      userId: userA.userId,
      url: "/posts/1",
      contentRaw: "User A Waiting",
      contentHtml: "<p>User A Waiting</p>",
      status: "waiting",
      createdAt: "2026-11-18T11:00:00.000Z"
    })
    await insertComment(db, prefix, {
      userId: userA.userId,
      url: "/posts/2",
      contentRaw: "User A Spam",
      contentHtml: "<p>User A Spam</p>",
      status: "spam",
      createdAt: "2026-11-18T12:00:00.000Z"
    })

    // User B comment
    await insertComment(db, prefix, {
      userId: userB.userId,
      url: "/posts/1",
      contentRaw: "User B Comment",
      contentHtml: "<p>User B Comment</p>",
      status: "approved",
      createdAt: "2026-11-18T13:00:00.000Z"
    })

    // Guest comment (userId null)
    await insertComment(db, prefix, {
      userId: null,
      nick: "Guest",
      mail: "guest@example.com",
      url: "/posts/1",
      contentRaw: "Guest Comment",
      contentHtml: "<p>Guest Comment</p>",
      status: "approved",
      createdAt: "2026-11-18T14:00:00.000Z"
    })

    // User A queries /api/me/comments
    const resA = await request(env, "/api/me/comments", {
      headers: { Cookie: userA.cookie }
    })
    expect(resA.status).toBe(200)
    const bodyA = (await resA.json()) as { data: ListMeCommentsResult }
    expect(bodyA.data.total).toBe(3)
    expect(bodyA.data.items.length).toBe(3)

    const statuses = bodyA.data.items.map((i) => i.status)
    expect(statuses).toContain("approved")
    expect(statuses).toContain("waiting")
    expect(statuses).toContain("spam")

    // Verify User A cannot see User B's or guest's comments
    const rawContents = bodyA.data.items.map((i) => i.contentRaw)
    expect(rawContents).not.toContain("User B Comment")
    expect(rawContents).not.toContain("Guest Comment")

    // User B queries /api/me/comments
    const resB = await request(env, "/api/me/comments", {
      headers: { Cookie: userB.cookie }
    })
    expect(resB.status).toBe(200)
    const bodyB = (await resB.json()) as { data: ListMeCommentsResult }
    expect(bodyB.data.total).toBe(1)
    expect(bodyB.data.items[0].contentRaw).toBe("User B Comment")
  })

  it("按创建时间倒序排序与分页正确", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const user = await seedSession(db, prefix, {
      email: "pager@example.com",
      role: "user"
    })

    await insertComment(db, prefix, {
      userId: user.userId,
      url: "/p/1",
      contentRaw: "First (oldest)",
      createdAt: "2026-11-01T00:00:00.000Z"
    })
    await insertComment(db, prefix, {
      userId: user.userId,
      url: "/p/2",
      contentRaw: "Second",
      createdAt: "2026-11-02T00:00:00.000Z"
    })
    await insertComment(db, prefix, {
      userId: user.userId,
      url: "/p/3",
      contentRaw: "Third (newest)",
      createdAt: "2026-11-03T00:00:00.000Z"
    })

    // Page 1, pageSize 2 -> should return Third, Second
    const page1Res = await request(env, "/api/me/comments?page=1&pageSize=2", {
      headers: { Cookie: user.cookie }
    })
    expect(page1Res.status).toBe(200)
    const page1 = ((await page1Res.json()) as { data: ListMeCommentsResult })
      .data
    expect(page1.total).toBe(3)
    expect(page1.totalPages).toBe(2)
    expect(page1.page).toBe(1)
    expect(page1.pageSize).toBe(2)
    expect(page1.items.length).toBe(2)
    expect(page1.items[0].contentRaw).toBe("Third (newest)")
    expect(page1.items[1].contentRaw).toBe("Second")

    // Page 2, pageSize 2 -> should return First (oldest)
    const page2Res = await request(env, "/api/me/comments?page=2&pageSize=2", {
      headers: { Cookie: user.cookie }
    })
    expect(page2Res.status).toBe(200)
    const page2 = ((await page2Res.json()) as { data: ListMeCommentsResult })
      .data
    expect(page2.items.length).toBe(1)
    expect(page2.items[0].contentRaw).toBe("First (oldest)")
  })

  it("不接受任何指定他人 user_id 的参数", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const userA = await seedSession(db, prefix, {
      email: "alice@example.com",
      role: "user"
    })
    const userB = await seedSession(db, prefix, {
      email: "bob@example.com",
      role: "user"
    })

    // Trying user_id=other -> 400
    const res1 = await request(
      env,
      `/api/me/comments?user_id=${userB.userId}`,
      {
        headers: { Cookie: userA.cookie }
      }
    )
    expect(res1.status).toBe(400)
    const body1 = (await res1.json()) as { error: { code: string } }
    expect(body1.error.code).toBe("INVALID_PARAM")

    // Trying userId=other -> 400
    const res2 = await request(env, `/api/me/comments?userId=${userB.userId}`, {
      headers: { Cookie: userA.cookie }
    })
    expect(res2.status).toBe(400)
    const body2 = (await res2.json()) as { error: { code: string } }
    expect(body2.error.code).toBe("INVALID_PARAM")

    // Passing own user_id -> 200
    const res3 = await request(
      env,
      `/api/me/comments?user_id=${userA.userId}`,
      {
        headers: { Cookie: userA.cookie }
      }
    )
    expect(res3.status).toBe(200)
  })

  it("返回字段脱敏：包含前端列表所需字段，严格不含 ip / ua / mail", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const user = await seedSession(db, prefix, {
      email: "leak_check@example.com",
      role: "user"
    })

    await insertComment(db, prefix, {
      userId: user.userId,
      url: "/article/test",
      contentRaw: "Raw text content",
      contentHtml: "<p>Raw text content</p>",
      status: "approved",
      ip: "203.0.113.195",
      ua: "SecretBrowser/1.0",
      mail: "leak_check@example.com",
      likeCount: 5,
      pid: null,
      rid: null
    })

    const res = await request(env, "/api/me/comments", {
      headers: { Cookie: user.cookie }
    })
    expect(res.status).toBe(200)
    const body = ((await res.json()) as { data: ListMeCommentsResult }).data
    expect(body.items.length).toBe(1)
    const item = body.items[0]

    // Required fields present
    expect(item.id).toBeTypeOf("number")
    expect(item.url).toBe("/article/test")
    expect(item.contentRaw).toBe("Raw text content")
    expect(item.contentHtml).toBe("<p>Raw text content</p>")
    expect(item.status).toBe("approved")
    expect(item.likeCount).toBe(5)
    expect(item.createdAt).toBeTypeOf("string")
    expect(item.updatedAt).toBeTypeOf("string")

    // Snake_case aliases present for compatibility
    expect(item.content_raw).toBe("Raw text content")
    expect(item.content_html).toBe("<p>Raw text content</p>")
    expect(item.like_count).toBe(5)
    expect(item.created_at).toBeTypeOf("string")
    expect(item.updated_at).toBeTypeOf("string")

    // Sensitive / visitor fields strictly excluded
    expect("ip" in item).toBe(false)
    expect("ua" in item).toBe(false)
    expect("mail" in item).toBe(false)
    expect("edit_token_hash" in item).toBe(false)
  })

  it("改删权限：复用既有 PATCH/DELETE /api/comments/:id，登录态本人可改删，不可越权改删他人", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const userA = await seedSession(db, prefix, {
      email: "editor_a@example.com",
      role: "user"
    })
    const userB = await seedSession(db, prefix, {
      email: "editor_b@example.com",
      role: "user"
    })

    const commentA = await insertComment(db, prefix, {
      userId: userA.userId,
      url: "/posts/edit",
      contentRaw: "User A original content",
      contentHtml: "<p>User A original content</p>"
    })

    const commentB = await insertComment(db, prefix, {
      userId: userB.userId,
      url: "/posts/edit",
      contentRaw: "User B original content",
      contentHtml: "<p>User B original content</p>"
    })

    // User A attempts to PATCH User B's comment -> 403 Forbidden
    const patchOtherRes = await request(env, `/api/comments/${commentB.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: userA.cookie
      },
      body: JSON.stringify({ content: "Malicious update" })
    })
    expect(patchOtherRes.status).toBe(403)

    // User A attempts to DELETE User B's comment -> 403 Forbidden
    const deleteOtherRes = await request(env, `/api/comments/${commentB.id}`, {
      method: "DELETE",
      headers: { Cookie: userA.cookie }
    })
    expect(deleteOtherRes.status).toBe(403)

    // User A PATCH own comment -> 200 OK
    const patchOwnRes = await request(env, `/api/comments/${commentA.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: userA.cookie
      },
      body: JSON.stringify({ content: "User A updated content" })
    })
    expect(patchOwnRes.status).toBe(200)
    const patchBody = (await patchOwnRes.json()) as {
      data: UpdateCommentResult
    }
    expect(patchBody.data.contentHtml).toContain("User A updated content")

    // User A DELETE own comment -> 200 OK
    const deleteOwnRes = await request(env, `/api/comments/${commentA.id}`, {
      method: "DELETE",
      headers: { Cookie: userA.cookie }
    })
    expect(deleteOwnRes.status).toBe(200)
    const deleteBody = (await deleteOwnRes.json()) as {
      data: DeleteCommentResult
    }
    expect(deleteBody.data.success).toBe(true)
    expect(deleteBody.data.deletedId).toBe(commentA.id)
  })

  it("/api/admin/* 权限口径未动：普通成员无权访问 /api/admin/comments", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const user = await seedSession(db, prefix, { role: "user" })

    const res = await request(env, "/api/admin/comments", {
      headers: { Cookie: user.cookie }
    })
    expect(res.status).toBe(403)
  })
})
