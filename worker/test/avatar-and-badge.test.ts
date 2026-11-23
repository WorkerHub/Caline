import { describe, expect, it } from "vitest"
import {
  activePrefix,
  initializedContext,
  request,
  seedSession
} from "./support/app"
import { insertComment } from "../src/db/queries/comments"
import { findUserById, updateUserFields } from "../src/db/queries/users"
import { formatGravatarUrl } from "../src/core/gravatar"
import type { ListCommentsResult, RecentCommentsResult } from "@caline/shared"

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52
])

const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x01, 0x00, 0x60
])

const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56,
  0x50, 0x38, 0x20
])

const GIF_BYTES = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0xff, 0xff, 0xff
])

describe("Badge & Avatar Contracts and Behavior", () => {
  describe("§1 Badge 下发规则", () => {
    it("管理员标记：公开评论接口（根评论、回复、最近评论）在评论作者为管理员时返回 badge: 'admin'", async () => {
      const ctx = await initializedContext()
      const prefix = activePrefix(ctx.env)

      const adminSession = await seedSession(ctx.db, prefix, {
        role: "admin",
        email: "admin_user@example.test"
      })
      await updateUserFields(ctx.env.DB, prefix, adminSession.userId, {
        display_name: "AdminNick"
      })

      // 管理员发表根评论
      const rootComment = await insertComment(ctx.env.DB, prefix, {
        userId: adminSession.userId,
        nick: "AdminNick",
        mail: "admin_user@example.test",
        link: "https://admin.example.test",
        url: "/posts/badge-test",
        pid: null,
        rid: null,
        contentRaw: "Admin root comment",
        contentHtml: "<p>Admin root comment</p>",
        status: "approved",
        sticky: 0,
        likeCount: 0,
        editTokenHash: null,
        ip: "127.0.0.1",
        ua: "vitest"
      })

      // 管理员发表回复评论
      await insertComment(ctx.env.DB, prefix, {
        userId: adminSession.userId,
        nick: "AdminNick",
        mail: "admin_user@example.test",
        link: "https://admin.example.test",
        url: "/posts/badge-test",
        pid: rootComment.id,
        rid: rootComment.id,
        contentRaw: "Admin reply comment",
        contentHtml: "<p>Admin reply comment</p>",
        status: "approved",
        sticky: 0,
        likeCount: 0,
        editTokenHash: null,
        ip: "127.0.0.1",
        ua: "vitest"
      })

      // 1. GET /api/comments
      const listRes = await request(
        ctx.env,
        "/api/comments?url=/posts/badge-test"
      )
      expect(listRes.status).toBe(200)
      const listBody = (await listRes.json()) as { data: ListCommentsResult }
      expect(listBody.data.items.length).toBe(1)
      const rootItem = listBody.data.items[0]
      expect(rootItem.badge).toBe("admin")
      expect(rootItem.replies.length).toBe(1)
      expect(rootItem.replies[0].badge).toBe("admin")

      // 2. GET /api/comments/recent
      const recentRes = await request(ctx.env, "/api/comments/recent?count=5")
      expect(recentRes.status).toBe(200)
      const recentBody = (await recentRes.json()) as {
        data: RecentCommentsResult
      }
      const adminRecent = recentBody.data.find((r) => r.id === rootComment.id)
      expect(adminRecent).toBeDefined()
      expect(adminRecent?.badge).toBe("admin")
    })

    it("普通用户不标记：公开评论接口不返回 badge 字段", async () => {
      const ctx = await initializedContext()
      const prefix = activePrefix(ctx.env)

      const userSession = await seedSession(ctx.db, prefix, {
        role: "user",
        email: "regular_user@example.test"
      })

      const comment = await insertComment(ctx.env.DB, prefix, {
        userId: userSession.userId,
        nick: "RegularNick",
        mail: "regular_user@example.test",
        link: "",
        url: "/posts/normal-test",
        pid: null,
        rid: null,
        contentRaw: "Normal user comment",
        contentHtml: "<p>Normal user comment</p>",
        status: "approved",
        sticky: 0,
        likeCount: 0,
        editTokenHash: null,
        ip: "127.0.0.1",
        ua: "vitest"
      })

      // GET /api/comments
      const listRes = await request(
        ctx.env,
        "/api/comments?url=/posts/normal-test"
      )
      const listBody = (await listRes.json()) as { data: ListCommentsResult }
      expect(listBody.data.items.length).toBe(1)
      const item = listBody.data.items[0]
      expect("badge" in item).toBe(false)
      expect(item.badge).toBeUndefined()

      // GET /api/comments/recent
      const recentRes = await request(ctx.env, "/api/comments/recent?count=5")
      const recentBody = (await recentRes.json()) as {
        data: RecentCommentsResult
      }
      const normalRecent = recentBody.data.find((r) => r.id === comment.id)
      expect(normalRecent).toBeDefined()
      expect("badge" in normalRecent!).toBe(false)
      expect(normalRecent?.badge).toBeUndefined()
    })

    it("访客不标记：访客评论无 user_id，永不标记 badge", async () => {
      const ctx = await initializedContext()
      const prefix = activePrefix(ctx.env)

      const guestComment = await insertComment(ctx.env.DB, prefix, {
        userId: null,
        nick: "GuestNick",
        mail: "guest@example.test",
        link: "",
        url: "/posts/guest-test",
        pid: null,
        rid: null,
        contentRaw: "Guest comment",
        contentHtml: "<p>Guest comment</p>",
        status: "approved",
        sticky: 0,
        likeCount: 0,
        editTokenHash: null,
        ip: "127.0.0.1",
        ua: "vitest"
      })

      const listRes = await request(
        ctx.env,
        "/api/comments?url=/posts/guest-test"
      )
      const listBody = (await listRes.json()) as { data: ListCommentsResult }
      expect(listBody.data.items.length).toBe(1)
      const item = listBody.data.items[0]
      expect("badge" in item).toBe(false)
      expect(item.badge).toBeUndefined()

      const recentRes = await request(ctx.env, "/api/comments/recent?count=5")
      const recentBody = (await recentRes.json()) as {
        data: RecentCommentsResult
      }
      const guestRecent = recentBody.data.find((r) => r.id === guestComment.id)
      expect(guestRecent).toBeDefined()
      expect("badge" in guestRecent!).toBe(false)
      expect(guestRecent?.badge).toBeUndefined()
    })

    it("管理员以访客身份发表不标记：以实际绑定的发表身份为准", async () => {
      const ctx = await initializedContext()
      const prefix = activePrefix(ctx.env)

      await seedSession(ctx.db, prefix, {
        role: "admin",
        email: "admin_master@example.test"
      })

      // 管理员以访客身份（无 userId，未带登录态）发表评论
      const guestAdminComment = await insertComment(ctx.env.DB, prefix, {
        userId: null,
        nick: "AdminNick",
        mail: "admin_master@example.test",
        link: "",
        url: "/posts/admin-as-guest",
        pid: null,
        rid: null,
        contentRaw: "Posting as anonymous guest",
        contentHtml: "<p>Posting as anonymous guest</p>",
        status: "approved",
        sticky: 0,
        likeCount: 0,
        editTokenHash: null,
        ip: "127.0.0.1",
        ua: "vitest"
      })

      const listRes = await request(
        ctx.env,
        "/api/comments?url=/posts/admin-as-guest"
      )
      const listBody = (await listRes.json()) as { data: ListCommentsResult }
      expect(listBody.data.items.length).toBe(1)
      const item = listBody.data.items[0]
      expect("badge" in item).toBe(false)
      expect(item.badge).toBeUndefined()

      const recentRes = await request(ctx.env, "/api/comments/recent?count=5")
      const recentBody = (await recentRes.json()) as {
        data: RecentCommentsResult
      }
      const recentItem = recentBody.data.find(
        (r) => r.id === guestAdminComment.id
      )
      expect(recentItem).toBeDefined()
      expect("badge" in recentItem!).toBe(false)
      expect(recentItem?.badge).toBeUndefined()
    })
  })

  describe("§2 头像接口与校验", () => {
    it("未登录访问 POST /api/me/avatar 返回 401", async () => {
      const ctx = await initializedContext()
      const formData = new FormData()
      formData.append(
        "file",
        new Blob([PNG_BYTES], { type: "image/png" }),
        "avatar.png"
      )

      const res = await request(ctx.env, "/api/me/avatar", {
        method: "POST",
        body: formData
      })
      expect(res.status).toBe(401)
    })

    it("上传成功：登录态上传 PNG 头像，更新 users.avatar 且写入 IMAGES", async () => {
      const ctx = await initializedContext()
      const prefix = activePrefix(ctx.env)
      const session = await seedSession(ctx.db, prefix, { role: "user" })

      const formData = new FormData()
      formData.append(
        "file",
        new Blob([PNG_BYTES], { type: "image/png" }),
        "my-avatar.png"
      )

      const res = await request(ctx.env, "/api/me/avatar", {
        method: "POST",
        headers: { Cookie: session.cookie },
        body: formData
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: { url: string; avatar: string }
      }
      expect(body.data).toBeDefined()
      expect(body.data.url).toMatch(
        new RegExp(`^/img/avatars/${session.userId}/[a-f0-9]+\\.png$`)
      )
      expect(body.data.avatar).toBe(body.data.url)

      // 校验 R2 对象确实写入
      const key = body.data.url.replace(/^\/img\//, "")
      const stored = await ctx.images.get(key)
      expect(stored).not.toBeNull()
      expect(stored?.httpMetadata?.contentType).toBe("image/png")

      // 校验 DB users.avatar 已更新
      const user = await findUserById(ctx.env.DB, prefix, session.userId)
      expect(user?.avatar).toBe(body.data.url)
    })

    it("类型校验：支持 jpeg 与 webp 单图上传", async () => {
      const ctx = await initializedContext()
      const prefix = activePrefix(ctx.env)
      const session = await seedSession(ctx.db, prefix, { role: "user" })

      // JPEG
      const fdJpeg = new FormData()
      fdJpeg.append(
        "file",
        new Blob([JPEG_BYTES], { type: "image/jpeg" }),
        "photo.jpg"
      )
      const resJpeg = await request(ctx.env, "/api/me/avatar", {
        method: "POST",
        headers: { Cookie: session.cookie },
        body: fdJpeg
      })
      expect(resJpeg.status).toBe(200)
      const bodyJpeg = (await resJpeg.json()) as { data: { url: string } }
      expect(bodyJpeg.data.url).toMatch(/\.jpg$/)

      // WebP
      const fdWebp = new FormData()
      fdWebp.append(
        "avatar",
        new Blob([WEBP_BYTES], { type: "image/webp" }),
        "photo.webp"
      )
      const resWebp = await request(ctx.env, "/api/me/avatar", {
        method: "POST",
        headers: { Cookie: session.cookie },
        body: fdWebp
      })
      expect(resWebp.status).toBe(200)
      const bodyWebp = (await resWebp.json()) as { data: { url: string } }
      expect(bodyWebp.data.url).toMatch(/\.webp$/)
    })

    it("svg 拒绝：明确禁止 svg 头像上传", async () => {
      const ctx = await initializedContext()
      const prefix = activePrefix(ctx.env)
      const session = await seedSession(ctx.db, prefix, { role: "user" })

      const fdSvg = new FormData()
      fdSvg.append(
        "file",
        new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], {
          type: "image/svg+xml"
        }),
        "avatar.svg"
      )
      const res = await request(ctx.env, "/api/me/avatar", {
        method: "POST",
        headers: { Cookie: session.cookie },
        body: fdSvg
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe("INVALID_FILE_TYPE")
    })

    it("超 2MB 拒绝：超过 2MB 的文件被拒绝", async () => {
      const ctx = await initializedContext()
      const prefix = activePrefix(ctx.env)
      const session = await seedSession(ctx.db, prefix, { role: "user" })

      const bigBytes = new Uint8Array(2 * 1024 * 1024 + 10)
      bigBytes.set(PNG_BYTES, 0)
      const fdBig = new FormData()
      fdBig.append(
        "file",
        new Blob([bigBytes], { type: "image/png" }),
        "large.png"
      )

      const res = await request(ctx.env, "/api/me/avatar", {
        method: "POST",
        headers: { Cookie: session.cookie },
        body: fdBig
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe("FILE_TOO_LARGE")
    })

    it("非图片拒绝：纯文本文件、虚假拓展名及 gif 均被拒绝", async () => {
      const ctx = await initializedContext()
      const prefix = activePrefix(ctx.env)
      const session = await seedSession(ctx.db, prefix, { role: "user" })

      // 纯文本伪装成 png
      const fdFake = new FormData()
      fdFake.append(
        "file",
        new Blob(["not really a png"], { type: "image/png" }),
        "fake.png"
      )
      const resFake = await request(ctx.env, "/api/me/avatar", {
        method: "POST",
        headers: { Cookie: session.cookie },
        body: fdFake
      })
      expect(resFake.status).toBe(400)
      expect(((await resFake.json()) as any).error.code).toBe(
        "INVALID_FILE_TYPE"
      )

      // GIF 头像应被拒绝（头像限 png/jpeg/webp）
      const fdGif = new FormData()
      fdGif.append(
        "file",
        new Blob([GIF_BYTES], { type: "image/gif" }),
        "avatar.gif"
      )
      const resGif = await request(ctx.env, "/api/me/avatar", {
        method: "POST",
        headers: { Cookie: session.cookie },
        body: fdGif
      })
      expect(resGif.status).toBe(400)
      expect(((await resGif.json()) as any).error.code).toBe(
        "INVALID_FILE_TYPE"
      )
    })

    it("替换删旧：重新上传头像时删除旧的 R2 对象，避免堆积", async () => {
      const ctx = await initializedContext()
      const prefix = activePrefix(ctx.env)
      const session = await seedSession(ctx.db, prefix, { role: "user" })

      // 第一次上传
      const fd1 = new FormData()
      fd1.append(
        "file",
        new Blob([PNG_BYTES], { type: "image/png" }),
        "avatar1.png"
      )
      const res1 = await request(ctx.env, "/api/me/avatar", {
        method: "POST",
        headers: { Cookie: session.cookie },
        body: fd1
      })
      expect(res1.status).toBe(200)
      const body1 = (await res1.json()) as { data: { url: string } }
      const key1 = body1.data.url.replace(/^\/img\//, "")

      expect(await ctx.images.get(key1)).not.toBeNull()

      // 第二次上传（替换）
      const fd2 = new FormData()
      fd2.append(
        "file",
        new Blob([WEBP_BYTES], { type: "image/webp" }),
        "avatar2.webp"
      )
      const res2 = await request(ctx.env, "/api/me/avatar", {
        method: "POST",
        headers: { Cookie: session.cookie },
        body: fd2
      })
      expect(res2.status).toBe(200)
      const body2 = (await res2.json()) as { data: { url: string } }
      const key2 = body2.data.url.replace(/^\/img\//, "")

      expect(key1).not.toBe(key2)
      // 旧头像 R2 对象已删除
      expect(await ctx.images.get(key1)).toBeNull()
      // 新头像 R2 对象存在
      expect(await ctx.images.get(key2)).not.toBeNull()

      // 前缀下只有 1 个对象
      const list = await ctx.images.list({
        prefix: `avatars/${session.userId}/`
      })
      expect(list.objects.length).toBe(1)
      expect(list.objects[0].key).toBe(key2)
    })
  })

  describe("§2 读时解析与同步", () => {
    it("读时解析：评论与 GET /api/auth/me 优先返回自定义头像", async () => {
      const ctx = await initializedContext()
      const prefix = activePrefix(ctx.env)

      const session = await seedSession(ctx.db, prefix, {
        role: "user",
        email: "custom_avatar@example.test"
      })
      const customAvatar = "/img/avatars/42/test-custom-pic.png"
      await updateUserFields(ctx.env.DB, prefix, session.userId, {
        avatar: customAvatar,
        display_name: "CustomAvatarUser"
      })

      // 插入一条该用户的评论
      await insertComment(ctx.env.DB, prefix, {
        userId: session.userId,
        nick: "CustomAvatarUser",
        mail: "custom_avatar@example.test",
        link: "",
        url: "/posts/avatar-read",
        pid: null,
        rid: null,
        contentRaw: "Content",
        contentHtml: "<p>Content</p>",
        status: "approved",
        sticky: 0,
        likeCount: 0,
        editTokenHash: null,
        ip: "127.0.0.1",
        ua: "vitest"
      })

      // 1. GET /api/comments 读时解析为 customAvatar
      const listRes = await request(
        ctx.env,
        "/api/comments?url=/posts/avatar-read"
      )
      const listBody = (await listRes.json()) as { data: ListCommentsResult }
      expect(listBody.data.items[0].avatar).toBe(customAvatar)

      // 2. GET /api/comments/recent 读时解析为 customAvatar
      const recentRes = await request(ctx.env, "/api/comments/recent?count=5")
      const recentBody = (await recentRes.json()) as {
        data: RecentCommentsResult
      }
      const recentItem = recentBody.data.find(
        (r) => r.url === "/posts/avatar-read"
      )
      expect(recentItem?.avatar).toBe(customAvatar)

      // 3. GET /api/auth/me 返回 customAvatar
      const meRes = await request(ctx.env, "/api/auth/me", {
        headers: { Cookie: session.cookie }
      })
      const meBody = (await meRes.json()) as { data: { avatar: string } }
      expect(meBody.data.avatar).toBe(customAvatar)
    })

    it("历史评论同步：换头像后其历史评论头像在读时同步更新", async () => {
      const ctx = await initializedContext()
      const prefix = activePrefix(ctx.env)

      const session = await seedSession(ctx.db, prefix, {
        role: "user",
        email: "sync_user@example.test"
      })

      // 用户发表历史评论（此时未设置自定义头像）
      const comment = await insertComment(ctx.env.DB, prefix, {
        userId: session.userId,
        nick: "SyncNick",
        mail: "sync_user@example.test",
        link: "",
        url: "/posts/sync-test",
        pid: null,
        rid: null,
        contentRaw: "Historical comment",
        contentHtml: "<p>Historical comment</p>",
        status: "approved",
        sticky: 0,
        likeCount: 0,
        editTokenHash: null,
        ip: "127.0.0.1",
        ua: "vitest"
      })

      // 查询历史评论应为 cravatar
      const listRes1 = await request(
        ctx.env,
        "/api/comments?url=/posts/sync-test"
      )
      const listBody1 = (await listRes1.json()) as { data: ListCommentsResult }
      expect(listBody1.data.items[0].avatar).toContain("cravatar.cn/avatar/")

      // 用户通过 POST /api/me/avatar 换头像
      const formData = new FormData()
      formData.append(
        "file",
        new Blob([PNG_BYTES], { type: "image/png" }),
        "new-avatar.png"
      )
      const uploadRes = await request(ctx.env, "/api/me/avatar", {
        method: "POST",
        headers: { Cookie: session.cookie },
        body: formData
      })
      expect(uploadRes.status).toBe(200)
      const newAvatarUrl = ((await uploadRes.json()) as any).data.url

      // 再次查询历史评论，头像立即同步为新头像，无需重写评论表
      const listRes2 = await request(
        ctx.env,
        "/api/comments?url=/posts/sync-test"
      )
      const listBody2 = (await listRes2.json()) as { data: ListCommentsResult }
      expect(listBody2.data.items[0].avatar).toBe(newAvatarUrl)

      const recentRes = await request(ctx.env, "/api/comments/recent?count=5")
      const recentBody = (await recentRes.json()) as {
        data: RecentCommentsResult
      }
      const recentItem = recentBody.data.find((r) => r.id === comment.id)
      expect(recentItem?.avatar).toBe(newAvatarUrl)
    })

    it("未设置自定义头像的用户维持 cravatar 口径完全不变，访客亦维持 cravatar", async () => {
      const ctx = await initializedContext()
      const prefix = activePrefix(ctx.env)

      const session = await seedSession(ctx.db, prefix, {
        role: "user",
        email: "cravatar_fallback@example.test"
      })
      await updateUserFields(ctx.env.DB, prefix, session.userId, {
        display_name: "FallbackNick"
      })

      const expectedUserCravatar = formatGravatarUrl(
        "cravatar_fallback@example.test",
        "FallbackNick"
      )

      // 1. GET /api/auth/me 返回 cravatar
      const meRes = await request(ctx.env, "/api/auth/me", {
        headers: { Cookie: session.cookie }
      })
      const meBody = (await meRes.json()) as { data: { avatar: string } }
      expect(meBody.data.avatar).toBe(expectedUserCravatar)

      // 2. 评论展示返回 cravatar
      await insertComment(ctx.env.DB, prefix, {
        userId: session.userId,
        nick: "FallbackNick",
        mail: "cravatar_fallback@example.test",
        link: "",
        url: "/posts/cravatar-test",
        pid: null,
        rid: null,
        contentRaw: "Content",
        contentHtml: "<p>Content</p>",
        status: "approved",
        sticky: 0,
        likeCount: 0,
        editTokenHash: null,
        ip: "127.0.0.1",
        ua: "vitest"
      })

      const listRes = await request(
        ctx.env,
        "/api/comments?url=/posts/cravatar-test"
      )
      const listBody = (await listRes.json()) as { data: ListCommentsResult }
      expect(listBody.data.items[0].avatar).toBe(expectedUserCravatar)

      // 3. 访客评论维持 cravatar
      const guestExpected = formatGravatarUrl(
        "guest_cravatar@example.test",
        "Visitor"
      )
      await insertComment(ctx.env.DB, prefix, {
        userId: null,
        nick: "Visitor",
        mail: "guest_cravatar@example.test",
        link: "",
        url: "/posts/cravatar-test",
        pid: null,
        rid: null,
        contentRaw: "Guest content",
        contentHtml: "<p>Guest content</p>",
        status: "approved",
        sticky: 0,
        likeCount: 0,
        editTokenHash: null,
        ip: "127.0.0.1",
        ua: "vitest"
      })

      const listResGuest = await request(
        ctx.env,
        "/api/comments?url=/posts/cravatar-test"
      )
      const listBodyGuest = (await listResGuest.json()) as {
        data: ListCommentsResult
      }
      const guestItem = listBodyGuest.data.items.find(
        (i) => i.nick === "Visitor"
      )
      expect(guestItem?.avatar).toBe(guestExpected)
    })
  })
})
