/**
 * 个人设置接口（规格 §6.1「设置」页的后端）：资料与偏好、改密、通行密钥列表/删除。
 *
 * 会话由 `index.ts` 的全局中间件统一校验（`/api/*` 里除公开表之外都要会话），
 * 所以这里不重复挂 `authMiddleware`。凭据类绑定动作不放这里：
 * - TOTP 绑定/关闭、通行密钥注册 → `routes/twofa-manage.ts`（`/api/auth/2fa/*`）；
 * - 删除通行密钥属「我的东西」，留在本文件，但仍要求重新输入密码。
 *
 * 与前端（C 单）对齐的契约：
 * - `GET/PUT /api/me`，`PUT` 为正式契约，`PATCH` 保留同义别名；
 * - `PUT /api/me/password {currentPassword,newPassword}`（`POST` 同义别名）；
 * - `GET /api/me/passkeys → {items:[{id,createdAt,lastUsedAt,transports}]}`；
 * - `DELETE /api/me/passkeys/:id {password}`。
 */
import { Hono } from "hono"
import type { Context } from "hono"
import type { CommentMeItem, ListMeCommentsResult } from "@caline/shared"
import { hashPassword } from "../core/auth"
import { revokeAllSessions } from "../core/session"
import { listUserComments } from "../db/queries/comments"
import { deletePasskey, listPasskeyViews } from "../db/queries/passkeys"
import { findUserById, updateUserFields } from "../db/queries/users"
import { currentUserId, requirePassword } from "../lib/account"
import { apiError, calineError, calineSuccess, readJsonBody } from "../lib/http"
import { readProfileLockSettings } from "../lib/settings"
import { getTablePrefix } from "../lib/table-prefix"
import { isValidTimezone } from "../lib/timezone"
import { buildUserView } from "../lib/user-view"
import { normalizeLanguage } from "../locales/email"
import { validateImage } from "./upload"
import type { HonoEnv } from "../types"

export const meRoutes = new Hono<HonoEnv>()

type Ctx = Context<HonoEnv>

meRoutes.get("/", async (c) => {
  const prefix = getTablePrefix(c.env)
  const user = await findUserById(c.env.DB, prefix, currentUserId(c))
  if (!user) return apiError(c, 404, "USER_NOT_FOUND", "User not found")
  return c.json(await buildUserView(c.env, user))
})

/**
 * GET /api/me/comments（规格 §4 账号区端点）：
 * - 须登录（由全局中间件拦截未登录请求并返回 401）；
 * - 只返回当前登录用户本人（user_id = 会话用户）的评论，含全部 status（approved/waiting/spam），按创建时间倒序分页；
 * - 严格不接受任何指定他人 user_id 的参数（若传他人 user_id 则 400 拒绝）；
 * - 返回字段不含 ip/ua/mail/nick 等访客或敏感字段。
 */
meRoutes.get("/comments", async (c) => {
  const queryUserId = c.req.query("user_id") ?? c.req.query("userId")
  const sessionUserId = currentUserId(c)
  if (queryUserId !== undefined && Number(queryUserId) !== sessionUserId) {
    return calineError(
      c,
      400,
      "INVALID_PARAM",
      "Specifying other user_id is not allowed"
    )
  }

  const rawPage = Number(c.req.query("page"))
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1
  const rawPageSize = Number(c.req.query("pageSize"))
  const pageSize =
    Number.isInteger(rawPageSize) && rawPageSize > 0 && rawPageSize <= 100
      ? rawPageSize
      : 10

  const prefix = getTablePrefix(c.env)
  const { items: rows, total } = await listUserComments(c.env.DB, prefix, {
    userId: sessionUserId,
    page,
    pageSize
  })

  const items: CommentMeItem[] = rows.map((r) => ({
    id: r.id,
    url: r.url,
    contentRaw: r.content_raw,
    contentHtml: r.content_html,
    status: r.status,
    likeCount: r.like_count,
    pid: r.pid,
    rid: r.rid,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    content_raw: r.content_raw,
    content_html: r.content_html,
    like_count: r.like_count,
    created_at: r.created_at,
    updated_at: r.updated_at
  }))

  const result: ListMeCommentsResult = {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  }

  return calineSuccess(c, result)
})

/** 资料与偏好：只更新请求体里出现的字段；非法值整单拒绝。 */
async function updateProfile(c: Ctx): Promise<Response> {
  const body = await readJsonBody<{
    displayName?: unknown
    avatar?: unknown
    url?: unknown
    language?: unknown
    timezone?: unknown
  }>(c)
  if (!body) return apiError(c, 400, "INVALID_REQUEST", "Invalid request body")

  const prefix = getTablePrefix(c.env)
  const userId = currentUserId(c)
  const locks = await readProfileLockSettings(c.env)
  const patch: Parameters<typeof updateUserFields>[3] = {}

  if (body.displayName !== undefined && locks.displayNameLocked) {
    return apiError(c, 403, "DISPLAY_NAME_LOCKED", "Display name is locked")
  }

  if (body.displayName !== undefined) {
    if (typeof body.displayName !== "string") {
      return apiError(c, 400, "INVALID_DISPLAY_NAME", "Invalid display name")
    }
    patch.display_name = body.displayName.trim().slice(0, 80)
  }

  if (body.avatar !== undefined) {
    if (typeof body.avatar !== "string") {
      return apiError(c, 400, "INVALID_AVATAR", "Invalid avatar url")
    }
    patch.avatar = body.avatar.trim()
  }

  if (body.url !== undefined) {
    if (typeof body.url !== "string") {
      return apiError(c, 400, "INVALID_URL", "Invalid website url")
    }
    patch.url = body.url.trim()
  }

  if (body.language !== undefined) {
    const language = normalizeLanguage(body.language)
    if (!language) {
      return apiError(c, 400, "INVALID_LANGUAGE", "Unsupported language")
    }
    patch.language = language
  }

  if (body.timezone !== undefined) {
    if (typeof body.timezone !== "string" || !isValidTimezone(body.timezone)) {
      return apiError(c, 400, "INVALID_TIMEZONE", "Invalid timezone")
    }
    patch.timezone = body.timezone
  }

  await updateUserFields(c.env.DB, prefix, userId, patch)
  const user = await findUserById(c.env.DB, prefix, userId)
  if (!user) return apiError(c, 404, "USER_NOT_FOUND", "User not found")
  return c.json(await buildUserView(c.env, user))
}

meRoutes.put("/", updateProfile)
meRoutes.patch("/", updateProfile)

// ─── 改密 ────────────────────────────────────────────────────────────────────

async function changePassword(c: Ctx): Promise<Response> {
  const body = await readJsonBody<{
    currentPassword?: unknown
    newPassword?: unknown
  }>(c)
  const denied = await requirePassword(c, body?.currentPassword)
  if (denied) return denied

  const newPassword =
    typeof body?.newPassword === "string" ? body.newPassword : ""
  if (newPassword.length < 8) {
    return apiError(
      c,
      400,
      "WEAK_PASSWORD",
      "Password must be at least 8 characters"
    )
  }

  const prefix = getTablePrefix(c.env)
  const userId = currentUserId(c)
  await updateUserFields(c.env.DB, prefix, userId, {
    password_hash: await hashPassword(newPassword),
    must_change_password: 0
  })
  // 改密后其它会话立即失效，当前会话保留（规格 §5.6.2）。
  await revokeAllSessions(c.env.DB, prefix, userId, c.get("sessionId"))
  return c.json({ success: true })
}

meRoutes.put("/password", changePassword)
meRoutes.post("/password", changePassword)

// ─── 通行密钥（列表 / 删除） ─────────────────────────────────────────────────

meRoutes.get("/passkeys", async (c) => {
  const prefix = getTablePrefix(c.env)
  return c.json({
    items: await listPasskeyViews(c.env.DB, prefix, currentUserId(c))
  })
})

meRoutes.delete("/passkeys/:id", async (c) => {
  const body = await readJsonBody<{ password?: unknown }>(c)
  const denied = await requirePassword(c, body?.password)
  if (denied) return denied

  const id = Number(c.req.param("id"))
  if (!Number.isInteger(id)) {
    return apiError(c, 404, "PASSKEY_NOT_FOUND", "Passkey not found")
  }
  const prefix = getTablePrefix(c.env)
  const removed = await deletePasskey(c.env.DB, prefix, currentUserId(c), id)
  if (!removed) {
    return apiError(c, 404, "PASSKEY_NOT_FOUND", "Passkey not found")
  }
  return c.json({ success: true })
})

// ─── 头像上传（POST /api/me/avatar） ─────────────────────────────────────────

meRoutes.post("/avatar", async (c) => {
  const userId = currentUserId(c)
  const prefix = getTablePrefix(c.env)
  const user = await findUserById(c.env.DB, prefix, userId)
  if (!user) return apiError(c, 404, "USER_NOT_FOUND", "User not found")

  let formData: FormData
  try {
    formData = await c.req.formData()
  } catch {
    return calineError(c, 400, "INVALID_REQUEST", "Invalid form data")
  }

  const file = formData.get("file") ?? formData.get("avatar")
  if (!file || typeof file === "string" || !(file instanceof File)) {
    return calineError(c, 400, "FILE_REQUIRED", "Avatar file is required")
  }

  if (file.size === 0) {
    return calineError(c, 400, "FILE_REQUIRED", "Avatar file cannot be empty")
  }

  const MAX_AVATAR_SIZE = 2 * 1024 * 1024 // 2MB
  if (file.size > MAX_AVATAR_SIZE) {
    return calineError(c, 400, "FILE_TOO_LARGE", "File size exceeds 2MB limit")
  }

  const headerBuffer = await file.slice(0, 16).arrayBuffer()
  const headerBytes = new Uint8Array(headerBuffer)
  const validated = validateImage(file.type, headerBytes)
  if (!validated || validated.type === "gif") {
    return calineError(
      c,
      400,
      "INVALID_FILE_TYPE",
      "Unsupported file type. Only png, jpeg, and webp are allowed"
    )
  }

  if (!c.env.IMAGES) {
    return calineError(
      c,
      500,
      "STORAGE_NOT_CONFIGURED",
      "Object storage is not configured"
    )
  }

  const randomPart = crypto.randomUUID().replace(/-/g, "")
  const newKey = `avatars/${userId}/${randomPart}.${validated.ext}`
  const fileBuffer = await file.arrayBuffer()
  await c.env.IMAGES.put(newKey, fileBuffer, {
    httpMetadata: {
      contentType: validated.mimeType
    }
  })

  // 替换头像时删除该用户旧头像 R2 对象，避免堆积
  try {
    const oldAvatar = user.avatar?.trim()
    if (oldAvatar) {
      let oldKey: string | null = null
      if (oldAvatar.startsWith("/img/")) {
        oldKey = oldAvatar.slice("/img/".length)
      } else {
        try {
          const u = new URL(oldAvatar, "http://localhost")
          if (u.pathname.startsWith("/img/")) {
            oldKey = u.pathname.slice("/img/".length)
          }
        } catch {
          // ignore
        }
      }
      if (oldKey?.startsWith(`avatars/${userId}/`) && oldKey !== newKey) {
        await c.env.IMAGES.delete(oldKey)
      }
    }

    if (typeof c.env.IMAGES.list === "function") {
      const listed = await c.env.IMAGES.list({
        prefix: `avatars/${userId}/`
      })
      const staleKeys = listed.objects
        .map((o) => o.key)
        .filter((k) => k !== newKey)
      if (staleKeys.length > 0) {
        await c.env.IMAGES.delete(staleKeys)
      }
    }
  } catch (err) {
    console.error("Failed to clean up old avatar objects:", err)
  }

  const avatarUrl = `/img/${newKey}`
  await updateUserFields(c.env.DB, prefix, userId, {
    avatar: avatarUrl
  })

  return calineSuccess(c, {
    url: avatarUrl,
    avatar: avatarUrl
  })
})
