/**
 * 系统管理接口（规格 §5.3、§5.5A、§5.6、§6.1）。
 *
 * 全部经 `adminMiddleware`：未登录 401、非管理员 403（前端隐藏菜单只是体验，
 * 服务端这一层才是边界）。凭据字段只写不读——`GET /settings` 只给
 * `passwordSet` / `apiKeySet`。
 */
import { Hono } from "hono"
import { APP_MODE } from "../config/project"
import { generateTemporaryPassword, hashPassword } from "../core/auth"
import { revokeAllSessions } from "../core/session"
import {
  approveUser,
  countActiveAdmins,
  deletePendingUser,
  deleteUser,
  findUserByEmail,
  findUserById,
  insertAdminCreatedUser,
  isUserStatus,
  listUsers,
  type UserRow,
  type UserStatus,
  updateUserFields
} from "../db/queries/users"
import { apiError, calineError, calineSuccess, readJsonBody } from "../lib/http"
import {
  buildAdminSettings,
  readCalineSettings,
  writeCalineSettings,
  type ProfileLockSettingsPatch,
  type RegistrationSettingsPatch,
  writeProfileLockSettings,
  writeRegistrationSettings,
  writeSetupPageEnabled
} from "../lib/settings"
import {
  adminBatchDelete,
  adminBatchUpdateStatus,
  adminSearchComments,
  adminUpdateCommentFields,
  deleteCommentCascade,
  findCommentById
} from "../db/queries/comments"
import { renderAndSanitizeMarkdown } from "../core/pipeline"
import { commentTable, counterTable, usersTable } from "../lib/tables"
import type {
  AdminCommentBatchInput,
  AdminCommentBatchResult,
  AdminDeleteCommentResult,
  AdminImportInput,
  AdminImportResult,
  AdminListCommentsResult,
  AdminUpdateCommentInput,
  AdminUpdateUserInput,
  CalineDataDump,
  CalineSiteSettingsPatch,
  CommentAdminItem,
  CommentStatus,
  ExportCommentRow,
  ExportCounterRow,
  ExportUserRow
} from "@caline/shared"

import { runSetup } from "../lib/setup"
import { getTablePrefix } from "../lib/table-prefix"
import { isValidTimezone } from "../lib/timezone"
import { normalizeLanguage, renderTestEmail } from "../locales/email"
import { adminMiddleware } from "../middleware/admin"
import {
  type EmailProvider,
  type EmailSettingsPatch,
  isEmailConfigured,
  isValidEmail,
  saveEmailSettings,
  sendEmail
} from "../services/email"
import type { HonoEnv } from "../types"

export const adminRoutes = new Hono<HonoEnv>()

adminRoutes.use("*", adminMiddleware)

adminRoutes.post("/setup", async (c) => {
  try {
    const result = await runSetup(c.env)
    return c.json(result, result.success ? 200 : 409)
  } catch (err) {
    console.error(
      "Admin setup failed:",
      err instanceof Error ? err.message : err
    )
    return c.json({ error: "Setup failed" }, 500)
  }
})

adminRoutes.get("/settings", async (c) => {
  const base = await buildAdminSettings(c.env)
  const site = await readCalineSettings(c.env)
  return c.json({ ...base, site })
})

adminRoutes.put("/settings", async (c) => {
  const body = await readJsonBody<{
    registration?: RegistrationSettingsPatch | null
    profileLocks?: ProfileLockSettingsPatch
    setup?: { pageEnabled?: boolean }
    email?: EmailSettingsPatch
    site?: CalineSiteSettingsPatch
  }>(c)
  if (!body) {
    return apiError(c, 400, "INVALID_EMAIL", "Invalid request body")
  }

  if (body.profileLocks !== undefined && body.profileLocks !== null) {
    await writeProfileLockSettings(c.env, body.profileLocks)
  }

  if (body.registration !== undefined && body.registration !== null) {
    if (APP_MODE !== "multi") {
      return apiError(
        c,
        400,
        "MODE_CONFLICT",
        "Registration settings are not available in single-user mode"
      )
    }
    const result = await writeRegistrationSettings(c.env, body.registration)
    if (!result.ok) {
      if (result.code === "EMAIL_NOT_CONFIGURED") {
        return apiError(
          c,
          409,
          "EMAIL_NOT_CONFIGURED",
          result.error ?? "Email delivery is not configured"
        )
      }
      return apiError(
        c,
        400,
        result.code ?? "MODE_CONFLICT",
        result.error ?? "Registration settings were rejected"
      )
    }
  }

  if (body.setup?.pageEnabled !== undefined) {
    await writeSetupPageEnabled(c.env, body.setup.pageEnabled)
  }

  if (body.email !== undefined) {
    const provider = body.email.provider
    if (
      provider !== undefined &&
      provider !== "none" &&
      provider !== "smtp" &&
      provider !== "resend"
    ) {
      return apiError(c, 400, "EMAIL_CONFIG_INVALID", "Unknown email provider")
    }
    const result = await saveEmailSettings(c.env, {
      ...body.email,
      provider: provider as EmailProvider | undefined
    })
    if (!result.ok) {
      return apiError(
        c,
        400,
        "EMAIL_CONFIG_INVALID",
        result.error ?? "Invalid email configuration"
      )
    }
  }

  if (body.site !== undefined) {
    await writeCalineSettings(c.env, body.site)
  }

  const base = await buildAdminSettings(c.env)
  const site = await readCalineSettings(c.env)
  return c.json({ ...base, site })
})

adminRoutes.post("/settings/test-email", async (c) => {
  const body = await readJsonBody<{ to?: string; language?: string }>(c)
  const to = typeof body?.to === "string" ? body.to.trim() : ""
  if (!to) {
    return apiError(c, 400, "INVALID_EMAIL", "Recipient address is required")
  }
  if (!(await isEmailConfigured(c.env))) {
    return apiError(
      c,
      409,
      "EMAIL_NOT_CONFIGURED",
      "Email delivery is not configured"
    )
  }

  const prefix = getTablePrefix(c.env)
  const admin = await findUserById(c.env.DB, prefix, c.get("userId"))
  const language =
    normalizeLanguage(body?.language) ??
    normalizeLanguage(admin?.language) ??
    "zh"
  const content = renderTestEmail(language)
  const result = await sendEmail(c.env, {
    to,
    subject: content.subject,
    html: content.html,
    text: content.text
  })

  if (!result.success) {
    // 原文回显：管理员要看到 provider 的真实报错才能修配置。
    return apiError(c, 502, "EMAIL_SEND_FAILED", "Test email failed", {
      detail: result.error ?? "unknown error"
    })
  }
  return c.json({ success: true })
})

adminRoutes.get("/users", async (c) => {
  // 全量用户（管理员用户列表）；`?status=` 可选，缺省返回全部。
  let status: UserStatus | undefined
  const rawStatus = c.req.query("status")
  if (rawStatus !== undefined) {
    if (!isUserStatus(rawStatus)) {
      return apiError(c, 400, "INVALID_STATUS", "Invalid status filter")
    }
    status = rawStatus
  }
  const prefix = getTablePrefix(c.env)
  const items = await listUsers(c.env.DB, prefix, status)
  return c.json({ items, data: { items } })
})

adminRoutes.post("/users/:id/approve", async (c) => {
  const id = Number(c.req.param("id"))
  if (!Number.isInteger(id)) {
    return apiError(c, 404, "USER_NOT_FOUND", "User not found")
  }
  const prefix = getTablePrefix(c.env)
  const approved = await approveUser(c.env.DB, prefix, id)
  if (!approved) {
    const user = await findUserById(c.env.DB, prefix, id)
    if (!user) return apiError(c, 404, "USER_NOT_FOUND", "User not found")
    return apiError(c, 409, "USER_NOT_PENDING", "User is not pending approval")
  }
  return c.json({ success: true })
})

adminRoutes.post("/users/:id/reject", async (c) => {
  const id = Number(c.req.param("id"))
  if (!Number.isInteger(id)) {
    return apiError(c, 404, "USER_NOT_FOUND", "User not found")
  }
  const prefix = getTablePrefix(c.env)
  const rejected = await deletePendingUser(c.env.DB, prefix, id)
  if (!rejected) {
    const user = await findUserById(c.env.DB, prefix, id)
    if (!user) return apiError(c, 404, "USER_NOT_FOUND", "User not found")
    return apiError(c, 409, "USER_NOT_PENDING", "User is not pending approval")
  }
  return c.json({ success: true })
})

adminRoutes.post("/users", async (c) => {
  const body = await readJsonBody<{
    email?: unknown
    role?: unknown
    displayName?: unknown
    language?: unknown
    timezone?: unknown
  }>(c)
  if (!body) return apiError(c, 400, "INVALID_REQUEST", "Invalid request body")

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
  if (!isValidEmail(email)) {
    return apiError(c, 400, "INVALID_EMAIL", "Invalid email address")
  }

  const role = body.role
  if (role !== "admin" && role !== "user") {
    return apiError(c, 400, "INVALID_ROLE", "Role must be admin or user")
  }

  const prefix = getTablePrefix(c.env)
  if (await findUserByEmail(c.env.DB, prefix, email)) {
    return apiError(c, 409, "EMAIL_TAKEN", "Email is already registered")
  }

  let displayName = ""
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== "string") {
      return apiError(c, 400, "INVALID_DISPLAY_NAME", "Invalid display name")
    }
    displayName = body.displayName.trim().slice(0, 80)
  }

  let language = "zh"
  if (body.language !== undefined) {
    const normalized = normalizeLanguage(body.language)
    if (!normalized) {
      return apiError(c, 400, "INVALID_LANGUAGE", "Unsupported language")
    }
    language = normalized
  }

  let timezone = "Asia/Shanghai"
  if (body.timezone !== undefined) {
    if (typeof body.timezone !== "string" || !isValidTimezone(body.timezone)) {
      return apiError(c, 400, "INVALID_TIMEZONE", "Invalid timezone")
    }
    timezone = body.timezone
  }

  const temporaryPassword = generateTemporaryPassword()
  const passwordHash = await hashPassword(temporaryPassword)

  let user: UserRow
  try {
    user = await insertAdminCreatedUser(c.env.DB, prefix, {
      email,
      passwordHash,
      role,
      displayName,
      language,
      timezone
    })
  } catch (err) {
    if (err instanceof Error && /UNIQUE/i.test(err.message)) {
      // 预检与写入之间被并发抢先：users 上只剩 email 一个唯一约束。
      return apiError(c, 409, "EMAIL_TAKEN", "Email is already registered")
    }
    throw err
  }

  return c.json({
    id: user.id,
    email: user.email,
    role: user.role,
    status: "active",
    temporaryPassword
  })
})

// ─── 用户管理操作列（规格 §5.6.2 用户管理操作列）───────────────────────────────
// 五个端点均挂在 adminMiddleware 之后：非管理员 403。

adminRoutes.post("/users/:id/reset-password", async (c) => {
  const id = Number(c.req.param("id"))
  if (!Number.isInteger(id)) {
    return apiError(c, 404, "USER_NOT_FOUND", "User not found")
  }
  const prefix = getTablePrefix(c.env)
  const user = await findUserById(c.env.DB, prefix, id)
  if (!user) return apiError(c, 404, "USER_NOT_FOUND", "User not found")

  // 复用管理员建号的一次性密码机制：只回一次、置首登强制改密、全部会话失效。
  const temporaryPassword = generateTemporaryPassword()
  await updateUserFields(c.env.DB, prefix, id, {
    password_hash: await hashPassword(temporaryPassword),
    must_change_password: 1
  })
  await revokeAllSessions(c.env.DB, prefix, id)
  return c.json({
    id: user.id,
    email: user.email,
    temporaryPassword
  })
})

adminRoutes.post("/users/:id/disable", async (c) => {
  const id = Number(c.req.param("id"))
  if (!Number.isInteger(id)) {
    return apiError(c, 404, "USER_NOT_FOUND", "User not found")
  }
  // 对自己执行停用：优先级最高的 403。
  if (id === c.get("userId")) {
    return apiError(
      c,
      403,
      "SELF_ACTION_FORBIDDEN",
      "Cannot disable your own account"
    )
  }
  const prefix = getTablePrefix(c.env)
  const user = await findUserById(c.env.DB, prefix, id)
  if (!user) return apiError(c, 404, "USER_NOT_FOUND", "User not found")

  // 重复停用：幂等 200。
  if (user.status === "disabled") return c.json({ success: true })

  // 停用一个「能登录的管理员」时，若他是最后一个，拒绝。
  if (user.role === "admin" && user.status === "active") {
    if ((await countActiveAdmins(c.env.DB, prefix)) <= 1) {
      return apiError(c, 409, "LAST_ADMIN", "Cannot disable the last admin")
    }
  }

  await updateUserFields(c.env.DB, prefix, id, { status: "disabled" })
  await revokeAllSessions(c.env.DB, prefix, id)
  return c.json({ success: true })
})

adminRoutes.post("/users/:id/enable", async (c) => {
  const id = Number(c.req.param("id"))
  if (!Number.isInteger(id)) {
    return apiError(c, 404, "USER_NOT_FOUND", "User not found")
  }
  const prefix = getTablePrefix(c.env)
  const user = await findUserById(c.env.DB, prefix, id)
  if (!user) return apiError(c, 404, "USER_NOT_FOUND", "User not found")

  // 重复启用：幂等 200。
  if (user.status === "active") return c.json({ success: true })

  await updateUserFields(c.env.DB, prefix, id, { status: "active" })
  return c.json({ success: true })
})

adminRoutes.post("/users/:id/role", async (c) => {
  const id = Number(c.req.param("id"))
  if (!Number.isInteger(id)) {
    return apiError(c, 404, "USER_NOT_FOUND", "User not found")
  }
  const body = await readJsonBody<{ role?: unknown }>(c)
  if (!body) return apiError(c, 400, "INVALID_REQUEST", "Invalid request body")
  const role = body.role
  if (role !== "admin" && role !== "user") {
    return apiError(c, 400, "INVALID_ROLE", "Role must be admin or user")
  }

  const prefix = getTablePrefix(c.env)
  const user = await findUserById(c.env.DB, prefix, id)
  if (!user) return apiError(c, 404, "USER_NOT_FOUND", "User not found")

  // 角色未变化：幂等 200。
  if (user.role === role) return c.json({ success: true })

  // 降级护栏：把「能登录的管理员」降成普通用户时，若他是最后一个，拒绝。
  if (user.role === "admin" && role === "user" && user.status === "active") {
    if ((await countActiveAdmins(c.env.DB, prefix)) <= 1) {
      return apiError(c, 409, "LAST_ADMIN", "Cannot demote the last admin")
    }
  }

  await updateUserFields(c.env.DB, prefix, id, { role })
  return c.json({ success: true })
})

adminRoutes.post("/users/:id/delete", async (c) => {
  const id = Number(c.req.param("id"))
  if (!Number.isInteger(id)) {
    return apiError(c, 404, "USER_NOT_FOUND", "User not found")
  }
  // 对自己执行删除：优先级最高的 403。
  if (id === c.get("userId")) {
    return apiError(
      c,
      403,
      "SELF_ACTION_FORBIDDEN",
      "Cannot delete your own account"
    )
  }
  const prefix = getTablePrefix(c.env)
  const user = await findUserById(c.env.DB, prefix, id)
  if (!user) return apiError(c, 404, "USER_NOT_FOUND", "User not found")

  // 删除一个「能登录的管理员」时，若他是最后一个，拒绝。
  if (user.role === "admin" && user.status === "active") {
    if ((await countActiveAdmins(c.env.DB, prefix)) <= 1) {
      return apiError(c, 409, "LAST_ADMIN", "Cannot delete the last admin")
    }
  }

  await deleteUser(c.env.DB, prefix, id)
  return c.json({ success: true })
})

adminRoutes.delete("/users/:id", async (c) => {
  const id = Number(c.req.param("id"))
  if (!Number.isInteger(id)) {
    return apiError(c, 404, "USER_NOT_FOUND", "User not found")
  }
  if (id === c.get("userId")) {
    return apiError(
      c,
      403,
      "SELF_ACTION_FORBIDDEN",
      "Cannot delete your own account"
    )
  }
  const prefix = getTablePrefix(c.env)
  const user = await findUserById(c.env.DB, prefix, id)
  if (!user) return apiError(c, 404, "USER_NOT_FOUND", "User not found")

  if (user.role === "admin" && user.status === "active") {
    if ((await countActiveAdmins(c.env.DB, prefix)) <= 1) {
      return apiError(c, 409, "LAST_ADMIN", "Cannot delete the last admin")
    }
  }

  await deleteUser(c.env.DB, prefix, id)
  return c.json({ success: true })
})

adminRoutes.patch("/users/:id", async (c) => {
  const id = Number(c.req.param("id"))
  if (!Number.isInteger(id)) {
    return calineError(c, 404, "USER_NOT_FOUND", "User not found")
  }

  const body = await readJsonBody<AdminUpdateUserInput>(c)
  if (!body) {
    return calineError(c, 400, "INVALID_REQUEST", "Invalid request body")
  }

  const prefix = getTablePrefix(c.env)
  const user = await findUserById(c.env.DB, prefix, id)
  if (!user) {
    return calineError(c, 404, "USER_NOT_FOUND", "User not found")
  }

  const patch: Parameters<typeof updateUserFields>[3] = {}

  if (body.role !== undefined) {
    if (body.role !== "admin" && body.role !== "user") {
      return calineError(c, 400, "INVALID_ROLE", "Role must be admin or user")
    }
    // 降级护栏
    if (
      user.role === "admin" &&
      body.role === "user" &&
      user.status === "active"
    ) {
      if ((await countActiveAdmins(c.env.DB, prefix)) <= 1) {
        return calineError(c, 409, "LAST_ADMIN", "Cannot demote the last admin")
      }
    }
    patch.role = body.role
  }

  if (body.status !== undefined) {
    if (
      body.status !== "active" &&
      body.status !== "pending" &&
      body.status !== "disabled"
    ) {
      return calineError(c, 400, "INVALID_STATUS", "Invalid status")
    }
    if (body.status === "disabled") {
      if (id === c.get("userId")) {
        return calineError(
          c,
          403,
          "SELF_ACTION_FORBIDDEN",
          "Cannot disable your own account"
        )
      }
      if (user.role === "admin" && user.status === "active") {
        if ((await countActiveAdmins(c.env.DB, prefix)) <= 1) {
          return calineError(
            c,
            409,
            "LAST_ADMIN",
            "Cannot disable the last admin"
          )
        }
      }
      await revokeAllSessions(c.env.DB, prefix, id)
    }
    patch.status = body.status
  }

  if (body.label !== undefined) {
    patch.label =
      typeof body.label === "string" ? body.label.trim().slice(0, 50) : ""
  }

  await updateUserFields(c.env.DB, prefix, id, patch)
  return calineSuccess(c, { success: true })
})

// ─── 评论治理（规格 §4、§5、§6）──────────────────────────────────────────────────

adminRoutes.get("/comments", async (c) => {
  const status = c.req.query("status")
  const q = c.req.query("q")
  const rawPage = Number(c.req.query("page"))
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1
  const rawPageSize = Number(c.req.query("pageSize"))
  const pageSize =
    Number.isInteger(rawPageSize) && rawPageSize > 0 && rawPageSize <= 100
      ? rawPageSize
      : 10

  const prefix = getTablePrefix(c.env)
  const { items: rows, total } = await adminSearchComments(c.env.DB, prefix, {
    status,
    q,
    page,
    pageSize
  })

  const items: CommentAdminItem[] = rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    nick: r.nick,
    mail: r.mail,
    link: r.link,
    url: r.url,
    pid: r.pid,
    rid: r.rid,
    contentRaw: r.content_raw,
    contentHtml: r.content_html,
    status: r.status,
    sticky: r.sticky === 1,
    likeCount: r.like_count,
    ip: r.ip,
    ua: r.ua,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }))

  const result: AdminListCommentsResult = {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  }

  return calineSuccess(c, result)
})

adminRoutes.patch("/comments/:id", async (c) => {
  const id = Number(c.req.param("id"))
  if (!Number.isInteger(id)) {
    return calineError(c, 404, "COMMENT_NOT_FOUND", "Comment not found")
  }

  const body = await readJsonBody<AdminUpdateCommentInput>(c)
  if (!body) {
    return calineError(c, 400, "INVALID_REQUEST", "Invalid request body")
  }

  const prefix = getTablePrefix(c.env)
  const existing = await findCommentById(c.env.DB, prefix, id)
  if (!existing) {
    return calineError(c, 404, "COMMENT_NOT_FOUND", "Comment not found")
  }

  let contentHtml: string | undefined
  if (body.content !== undefined) {
    contentHtml = await renderAndSanitizeMarkdown(body.content)
  }

  const updated = await adminUpdateCommentFields(c.env.DB, prefix, id, {
    status: body.status,
    sticky: body.sticky !== undefined ? (body.sticky ? 1 : 0) : undefined,
    contentRaw: body.content,
    contentHtml
  })

  return calineSuccess(c, updated)
})

adminRoutes.delete("/comments/:id", async (c) => {
  const id = Number(c.req.param("id"))
  if (!Number.isInteger(id)) {
    return calineError(c, 404, "COMMENT_NOT_FOUND", "Comment not found")
  }

  const prefix = getTablePrefix(c.env)
  const existing = await findCommentById(c.env.DB, prefix, id)
  if (!existing) {
    return calineError(c, 404, "COMMENT_NOT_FOUND", "Comment not found")
  }

  const deletedIds = await deleteCommentCascade(c.env.DB, prefix, id)

  const result: AdminDeleteCommentResult = {
    success: true,
    deletedId: id,
    deletedCount: deletedIds.length,
    deletedIds
  }

  return calineSuccess(c, result)
})

adminRoutes.post("/comments/batch", async (c) => {
  const body = await readJsonBody<AdminCommentBatchInput>(c)
  if (!body || !Array.isArray(body.ids) || !body.action) {
    return calineError(c, 400, "INVALID_REQUEST", "Invalid batch input")
  }

  const prefix = getTablePrefix(c.env)
  let affectedCount = 0

  if (body.action === "delete") {
    affectedCount = await adminBatchDelete(c.env.DB, prefix, body.ids)
  } else {
    const statusMap: Record<string, CommentStatus> = {
      approve: "approved",
      spam: "spam",
      waiting: "waiting"
    }
    const targetStatus = statusMap[body.action]
    if (!targetStatus) {
      return calineError(c, 400, "INVALID_ACTION", "Invalid batch action")
    }
    affectedCount = await adminBatchUpdateStatus(
      c.env.DB,
      prefix,
      body.ids,
      targetStatus
    )
  }

  const result: AdminCommentBatchResult = {
    success: true,
    affectedCount
  }

  return calineSuccess(c, result)
})

// ─── 数据备份导出与导入（规格 §11）──────────────────────────────────────────────

adminRoutes.get("/export", async (c) => {
  const prefix = getTablePrefix(c.env)

  const commentsRows = await c.env.DB.prepare(
    `SELECT * FROM ${commentTable(prefix)} ORDER BY id ASC`
  ).all<ExportCommentRow>()

  const countersRows = await c.env.DB.prepare(
    `SELECT * FROM ${counterTable(prefix)} ORDER BY id ASC`
  ).all<ExportCounterRow>()

  const usersRows = await c.env.DB.prepare(
    `SELECT id, email, role, status, email_verified, language,
              display_name, timezone, created_at, updated_at,
              label, avatar, url, github_id
         FROM ${usersTable(prefix)}
        ORDER BY id ASC`
  ).all<ExportUserRow>()

  const dump: CalineDataDump = {
    version: "1.0.0",
    exportedAt: new Date().toISOString(),
    comments: commentsRows.results,
    counters: countersRows.results,
    users: usersRows.results
  }

  return calineSuccess(c, dump)
})

adminRoutes.post("/import", async (c) => {
  const body = await readJsonBody<AdminImportInput>(c)
  if (!body?.data || typeof body.data !== "object") {
    return calineError(c, 400, "INVALID_REQUEST", "Invalid import dump data")
  }

  const prefix = getTablePrefix(c.env)
  const dump = body.data

  const existingComments = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM ${commentTable(prefix)}`
  ).first<{ total: number }>()
  const existingCounters = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM ${counterTable(prefix)}`
  ).first<{ total: number }>()

  const hasData =
    Number(existingComments?.total ?? 0) > 0 ||
    Number(existingCounters?.total ?? 0) > 0

  if (hasData && body.overwrite !== true) {
    return calineError(
      c,
      409,
      "CONFIRM_OVERWRITE",
      "Existing comments or counters detected. Set overwrite: true to confirm replacement."
    )
  }

  // 覆盖导入：清空当前评论与计数表
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM ${commentTable(prefix)}`),
    c.env.DB.prepare(`DELETE FROM ${counterTable(prefix)}`)
  ])

  let importedComments = 0
  if (Array.isArray(dump.comments) && dump.comments.length > 0) {
    const stmts: D1PreparedStatement[] = []
    for (const item of dump.comments) {
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO ${commentTable(prefix)}
            (id, user_id, nick, mail, link, url, pid, rid,
             content_raw, content_html, status, sticky, like_count,
             edit_token_hash, ip, ua, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          item.id,
          item.user_id ?? null,
          item.nick ?? "",
          item.mail ?? "",
          item.link ?? "",
          item.url,
          item.pid ?? null,
          item.rid ?? null,
          item.content_raw ?? "",
          item.content_html ?? "",
          item.status ?? "approved",
          item.sticky ?? 0,
          item.like_count ?? 0,
          item.edit_token_hash ?? null,
          item.ip ?? "",
          item.ua ?? "",
          item.created_at ?? new Date().toISOString(),
          item.updated_at ?? new Date().toISOString()
        )
      )
    }
    await c.env.DB.batch(stmts)
    importedComments = dump.comments.length
  }

  let importedCounters = 0
  if (Array.isArray(dump.counters) && dump.counters.length > 0) {
    const stmts: D1PreparedStatement[] = []
    for (const item of dump.counters) {
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO ${counterTable(prefix)}
            (id, url, pageview, reaction0, reaction1, reaction2, reaction3,
             reaction4, reaction5, reaction6, reaction7, reaction8, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          item.id,
          item.url,
          item.pageview ?? 0,
          item.reaction0 ?? 0,
          item.reaction1 ?? 0,
          item.reaction2 ?? 0,
          item.reaction3 ?? 0,
          item.reaction4 ?? 0,
          item.reaction5 ?? 0,
          item.reaction6 ?? 0,
          item.reaction7 ?? 0,
          item.reaction8 ?? 0,
          item.created_at ?? new Date().toISOString(),
          item.updated_at ?? new Date().toISOString()
        )
      )
    }
    await c.env.DB.batch(stmts)
    importedCounters = dump.counters.length
  }

  let importedUsers = 0
  if (Array.isArray(dump.users) && dump.users.length > 0) {
    for (const u of dump.users) {
      const existing = await findUserById(c.env.DB, prefix, u.id)
      if (existing) {
        await updateUserFields(c.env.DB, prefix, u.id, {
          label: u.label,
          avatar: u.avatar,
          url: u.url,
          display_name: u.display_name || existing.display_name
        })
        importedUsers++
      }
    }
  }

  const result: AdminImportResult = {
    success: true,
    importedComments,
    importedCounters,
    importedUsers
  }

  return calineSuccess(c, result)
})
