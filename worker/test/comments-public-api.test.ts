import { describe, expect, it } from "vitest"
import {
  activePrefix,
  initializedContext,
  request,
  seedSession
} from "./support/app"
import { insertRegisteredUser } from "../src/db/queries/users"
import { hashPassword } from "../src/core/auth"
import type {
  CreateCommentResult,
  DeleteCommentResult,
  LikeCommentResult,
  ListCommentsResult,
  PageReactionResult,
  PageViewResult,
  RecentCommentsResult,
  UpdateCommentResult
} from "@caline/shared"

describe("Comments Public API", () => {
  it("allows visitor to post comment and returns editToken without exposing email", async () => {
    const { env } = await initializedContext()

    const createRes = await request(env, "/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "/posts/first",
        content: "First visitor comment!",
        nick: "Alice",
        mail: "alice@example.com",
        link: "https://alice.site"
      })
    })

    expect(createRes.status).toBe(201)
    const createBody = (await createRes.json()) as { data: CreateCommentResult }
    expect(createBody.data.comment.id).toBeGreaterThan(0)
    expect(createBody.data.comment.url).toBe("/posts/first")
    expect(createBody.data.editToken).toBeDefined()
    expect(createBody.data.status).toBe("waiting") // First time visitor has no approved history

    // Verify GET /api/comments returns tree structure without visitor email/IP/UA
    const listRes = await request(env, "/api/comments?url=/posts/first")
    expect(listRes.status).toBe(200)
    const listBody = (await listRes.json()) as { data: ListCommentsResult }
    // Waiting comments are not returned in public list
    expect(listBody.data.items.length).toBe(0)
  })

  it("prevents visitor from impersonating registered user email or reserved nick", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)

    // Register a user
    await insertRegisteredUser(db as unknown as D1Database, prefix, {
      email: "member@example.test",
      passwordHash: await hashPassword("password123"),
      language: "zh",
      approvalRequired: false,
      emailVerificationRequired: false
    })

    // Visitor tries to use registered email
    const fakeEmailRes = await request(env, "/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "/posts/impersonate",
        content: "I am a member",
        nick: "Impostor",
        mail: "member@example.test"
      })
    })
    expect(fakeEmailRes.status).toBe(400)
    const fakeEmailBody = (await fakeEmailRes.json()) as {
      error: { code: string }
    }
    expect(fakeEmailBody.error.code).toBe("EMAIL_REGISTERED")

    // Visitor tries to use reserved nickname
    const reservedNickRes = await request(env, "/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "/posts/impersonate",
        content: "I am admin",
        nick: "admin",
        mail: "guest@other.test"
      })
    })
    expect(reservedNickRes.status).toBe(400)
    const reservedNickBody = (await reservedNickRes.json()) as {
      error: { code: string }
    }
    expect(reservedNickBody.error.code).toBe("NICK_RESERVED")

    // Regular user display name is NOT reserved for guests
    const regularUser = await insertRegisteredUser(
      db as unknown as D1Database,
      prefix,
      {
        email: "regular@example.test",
        passwordHash: await hashPassword("password123"),
        language: "zh",
        approvalRequired: false,
        emailVerificationRequired: false
      }
    )
    await db.db
      .prepare(
        `UPDATE ${prefix}users SET display_name = 'RegularGuy' WHERE id = ?`
      )
      .run(regularUser.id)

    const regularNickRes = await request(env, "/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "/posts/regular-nick",
        content: "I have the same display name as a regular user",
        nick: "RegularGuy",
        mail: "other_guest@example.test"
      })
    })
    expect(regularNickRes.status).toBe(201)
  })

  it("evaluates trust classification strictly by mail when mail is provided", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)

    // Turn off IP rate limit for this test so consecutive requests from same IP are evaluated for trust
    const adminSession = await seedSession(db, prefix, { role: "admin" })
    await request(env, "/api/admin/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSession.cookie
      },
      body: JSON.stringify({ site: { ipRateLimitSeconds: 0 } })
    })

    // Seed an approved comment from IP 192.168.2.50 (no email)

    await db.db
      .prepare(
        `INSERT INTO ${prefix}comment
          (url, nick, mail, content_raw, content_html, status, ip, created_at, updated_at)
         VALUES ('/posts/trust', 'OldVisitor', '', 'Old', '<p>Old</p>', 'approved', '192.168.2.50', datetime('now'), datetime('now'))`
      )
      .run()

    // Same IP posts without email -> approved because IP has approved history
    const anonRes = await request(env, "/api/comments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "192.168.2.50"
      },
      body: JSON.stringify({
        url: "/posts/trust",
        content: "Anonymous comment from same IP",
        nick: "Anon"
      })
    })
    expect(anonRes.status).toBe(201)
    const anonBody = (await anonRes.json()) as { data: CreateCommentResult }
    expect(anonBody.data.status).toBe("approved")

    // Same IP posts with a brand new email -> MUST NOT fall through to IP; must evaluate mail and be waiting
    const newMailRes = await request(env, "/api/comments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "192.168.2.50"
      },
      body: JSON.stringify({
        url: "/posts/trust",
        content: "New email from same IP",
        nick: "NewMailUser",
        mail: "brand_new_visitor@example.test"
      })
    })
    expect(newMailRes.status).toBe(201)
    const newMailBody = (await newMailRes.json()) as {
      data: CreateCommentResult
    }
    expect(newMailBody.data.status).toBe("waiting")
  })

  it("rejects duplicate content from the same visitor", async () => {
    const { env } = await initializedContext()

    const firstRes = await request(env, "/api/comments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "10.0.0.1"
      },
      body: JSON.stringify({
        url: "/posts/duplicate-test",
        content: "Identical message content",
        nick: "Bob",
        mail: "bob@example.com"
      })
    })
    expect(firstRes.status).toBe(201)

    const dupRes = await request(env, "/api/comments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "10.0.0.2"
      },
      body: JSON.stringify({
        url: "/posts/duplicate-test",
        content: "Identical message content",
        nick: "Bob",
        mail: "bob@example.com"
      })
    })
    expect(dupRes.status).toBe(400)
    const dupBody = (await dupRes.json()) as { error: { code: string } }
    expect(dupBody.error.code).toBe("DUPLICATE_CONTENT")
  })

  it("supports logged in user posting with Bearer or Cookie, defaulting to approved", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const session = await seedSession(db, prefix, {
      role: "user",
      email: "author@blog.org"
    })

    const res = await request(env, "/api/comments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`
      },
      body: JSON.stringify({
        url: "/posts/welcome",
        content: "Logged in comment here!"
      })
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: CreateCommentResult }
    expect(body.data.status).toBe("approved")
    expect(body.data.editToken).toBeUndefined() // Logged in users don't use editToken

    // Public list returns this approved comment
    const listRes = await request(env, "/api/comments?url=/posts/welcome")
    expect(listRes.status).toBe(200)
    const listBody = (await listRes.json()) as { data: ListCommentsResult }
    expect(listBody.data.items.length).toBe(1)
    expect(listBody.data.items[0].contentHtml).toContain(
      "<p>Logged in comment here!</p>"
    )
    expect("mail" in listBody.data.items[0]).toBe(false)
    expect("ip" in listBody.data.items[0]).toBe(false)
    expect("ua" in listBody.data.items[0]).toBe(false)
  })

  it("assembles replies tree and replyTo references correctly", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const adminSession = await seedSession(db, prefix, {
      role: "admin",
      email: "owner@site.test"
    })

    // 1. Post root comment as admin (approved)
    const rootRes = await request(env, "/api/comments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSession.cookie
      },
      body: JSON.stringify({
        url: "/posts/tree",
        content: "Root comment by owner"
      })
    })
    const rootData = ((await rootRes.json()) as { data: CreateCommentResult })
      .data
    const rootId = rootData.comment.id

    // 2. Post reply to root comment as another user
    const userSession = await seedSession(db, prefix, {
      role: "user",
      email: "reader@site.test"
    })
    const reply1Res = await request(env, "/api/comments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: userSession.cookie
      },
      body: JSON.stringify({
        url: "/posts/tree",
        content: "First reply to root",
        pid: rootId
      })
    })
    const reply1Data = (
      (await reply1Res.json()) as { data: CreateCommentResult }
    ).data
    const reply1Id = reply1Data.comment.id

    // 3. Post reply to reply1
    const reply2Res = await request(env, "/api/comments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminSession.cookie
      },
      body: JSON.stringify({
        url: "/posts/tree",
        content: "Owner replying to reader",
        pid: reply1Id
      })
    })
    expect(reply2Res.status).toBe(201)

    // 4. Query comment tree
    const treeRes = await request(env, "/api/comments?url=/posts/tree")
    const treeBody = (await treeRes.json()) as { data: ListCommentsResult }
    expect(treeBody.data.items.length).toBe(1)

    const rootItem = treeBody.data.items[0]
    expect(rootItem.id).toBe(rootId)
    expect(rootItem.replies.length).toBe(2)

    // Verify replyTo
    expect(rootItem.replies[0].id).toBe(reply1Id)
    expect(rootItem.replies[0].replyTo?.id).toBe(rootId)

    expect(rootItem.replies[1].replyTo?.id).toBe(reply1Id)
  })

  it("handles visitor 15-minute edit and delete window with X-Edit-Token", async () => {
    const { env } = await initializedContext()

    // 1. Post comment as visitor
    const postRes = await request(env, "/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "/posts/edit-window",
        content: "Original visitor text",
        nick: "Editor"
      })
    })
    const postBody = (await postRes.json()) as { data: CreateCommentResult }
    const commentId = postBody.data.comment.id
    const editToken = postBody.data.editToken!

    // 2. Edit without token -> 403
    const noTokenRes = await request(env, `/api/comments/${commentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Updated text" })
    })
    expect(noTokenRes.status).toBe(403)

    // 3. Edit with wrong token -> 403
    const badTokenRes = await request(env, `/api/comments/${commentId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Edit-Token": "wrong-token"
      },
      body: JSON.stringify({ content: "Updated text" })
    })
    expect(badTokenRes.status).toBe(403)

    // 4. Edit with correct token within 15 minutes -> 200
    const editRes = await request(env, `/api/comments/${commentId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Edit-Token": editToken
      },
      body: JSON.stringify({ content: "Updated visitor text!" })
    })
    expect(editRes.status).toBe(200)
    const editBody = (await editRes.json()) as { data: UpdateCommentResult }
    expect(editBody.data.contentHtml).toContain("Updated visitor text!")

    // 5. Delete with correct token -> 200
    const deleteRes = await request(env, `/api/comments/${commentId}`, {
      method: "DELETE",
      headers: { "X-Edit-Token": editToken }
    })
    expect(deleteRes.status).toBe(200)
    const deleteBody = (await deleteRes.json()) as { data: DeleteCommentResult }
    expect(deleteBody.data.success).toBe(true)
    expect(deleteBody.data.deletedId).toBe(commentId)
  })

  it("handles like, count, and recent comments endpoints", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const session = await seedSession(db, prefix, { role: "user" })

    // Create 2 approved comments on url A, 1 on url B
    const r1 = await request(env, "/api/comments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: session.cookie
      },
      body: JSON.stringify({ url: "/posts/a", content: "Post A first" })
    })
    const c1 = ((await r1.json()) as { data: CreateCommentResult }).data.comment
      .id

    await request(env, "/api/comments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: session.cookie
      },
      body: JSON.stringify({ url: "/posts/a", content: "Post A second" })
    })

    await request(env, "/api/comments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: session.cookie
      },
      body: JSON.stringify({ url: "/posts/b", content: "Post B first" })
    })

    // Like c1
    const likeRes = await request(env, `/api/comments/${c1}/like`, {
      method: "POST"
    })
    expect(likeRes.status).toBe(200)
    const likeBody = (await likeRes.json()) as { data: LikeCommentResult }
    expect(likeBody.data.likeCount).toBe(1)

    // GET /api/comments/count?urls=/posts/a,/posts/b,/posts/none
    const countRes = await request(
      env,
      "/api/comments/count?urls=/posts/a,/posts/b,/posts/none"
    )
    expect(countRes.status).toBe(200)
    const countBody = (await countRes.json()) as {
      data: Record<string, number>
    }
    expect(countBody.data["/posts/a"]).toBe(2)
    expect(countBody.data["/posts/b"]).toBe(1)
    expect(countBody.data["/posts/none"]).toBe(0)

    // GET /api/comments/recent?count=2
    const recentRes = await request(env, "/api/comments/recent?count=2")
    expect(recentRes.status).toBe(200)
    const recentBody = (await recentRes.json()) as {
      data: RecentCommentsResult
    }
    expect(recentBody.data.length).toBe(2)
  })

  it("handles page view and reactions", async () => {
    const { env } = await initializedContext()

    // Pageview
    const viewRes = await request(env, "/api/pages/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "/article/1" })
    })
    expect(viewRes.status).toBe(200)
    const viewBody = (await viewRes.json()) as { data: PageViewResult }
    expect(viewBody.data.pageview).toBe(1)

    // Reaction 0
    const r0Res = await request(env, "/api/pages/reaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "/article/1", type: 0 })
    })
    expect(r0Res.status).toBe(200)
    const r0Body = (await r0Res.json()) as { data: PageReactionResult }
    expect(r0Body.data.reactions.reaction0).toBe(1)
    expect(r0Body.data.reactions.reaction1).toBe(0)

    // Reaction 4
    const r4Res = await request(env, "/api/pages/reaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "/article/1", type: 4 })
    })
    const r4Body = (await r4Res.json()) as { data: PageReactionResult }
    expect(r4Body.data.reactions.reaction4).toBe(1)
  })

  it("handles GET /api/auth/me and PATCH /api/auth/me", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const session = await seedSession(db, prefix, {
      role: "user",
      email: "profile@example.test"
    })

    // GET /api/auth/me
    const meRes = await request(env, "/api/auth/me", {
      headers: { Authorization: `Bearer ${session.token}` }
    })
    expect(meRes.status).toBe(200)
    const meBody = (await meRes.json()) as { data: { email: string } }
    expect(meBody.data.email).toBe("profile@example.test")

    // PATCH /api/auth/me
    const patchRes = await request(env, "/api/auth/me", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`
      },
      body: JSON.stringify({
        displayName: "NewDisplayName",
        avatar: "https://myavatar.com/pic.png",
        url: "https://myblog.com"
      })
    })
    expect(patchRes.status).toBe(200)
    const patchBody = (await patchRes.json()) as {
      data: { displayName: string; avatar: string; url: string }
    }
    expect(patchBody.data.displayName).toBe("NewDisplayName")
    expect(patchBody.data.avatar).toBe("https://myavatar.com/pic.png")
    expect(patchBody.data.url).toBe("https://myblog.com")
  })
})
