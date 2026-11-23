/**
 * 评论区公开业务接口（规格 §4、§5、§6）。
 *
 * 遵循原则：
 * - 访客 mail、ip、ua 绝对不在公开接口返回；
 * - 根评论分页返回，子回复平铺挂在根评论下，含 replyTo 映射；
 * - 访客发后 15 分钟内改/删评论凭 X-Edit-Token 校验；
 * - 响应统一使用统一信封 `{ data }` 与 `{ error: { code, message } }`。
 */
import { Hono } from "hono"
import { randomToken, sha256Hex } from "../core/auth"
import { enforceRateLimit } from "../core/rate-limit"
import { findSession, readSessionToken } from "../core/session"
import { formatGravatarUrl } from "../core/gravatar"
import {
  countLinks,
  decideCommentStatus,
  hasDisallowedWords,
  isDomainAllowed,
  isNickReserved,
  renderAndSanitizeMarkdown,
  sendEnotifyNotification,
  verifyTurnstile
} from "../core/pipeline"
import {
  countApprovedByMail,
  countApprovedCommentsByUrls,
  deleteCommentCascade,
  findApprovedHistory,
  findCommentById,
  findDuplicateContent,
  incrementCommentLike,
  insertComment,
  listRecentComments,
  listRepliesByRootIds,
  listRootComments,
  updateCommentContent,
  type CommentRow
} from "../db/queries/comments"
import { findUserByEmail, findUserById, listUsers } from "../db/queries/users"
import { calineError, calineSuccess, clientIp, readJsonBody } from "../lib/http"
import {
  getEnotifyKey,
  getTurnstileSecretKey,
  readCalineSettings
} from "../lib/settings"
import { getTablePrefix } from "../lib/table-prefix"
import { isValidEmail } from "../services/email"
import type {
  CommentCountsResult,
  CommentPublicItem,
  CommentPublicReplyItem,
  CreateCommentInput,
  CreateCommentResult,
  DeleteCommentResult,
  LikeCommentResult,
  ListCommentsResult,
  RecentCommentsResult,
  UpdateCommentInput,
  UpdateCommentResult
} from "@caline/shared"
import type { HonoEnv } from "../types"

export const commentsRoutes = new Hono<HonoEnv>()

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000

// ─── GET /api/comments 树形评论列表分页 ──────────────────────────────────────

commentsRoutes.get("/", async (c) => {
  const url = c.req.query("url")?.trim()
  if (!url) {
    return calineError(c, 400, "INVALID_URL", "Target url is required")
  }

  const rawPage = Number(c.req.query("page"))
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1
  const rawPageSize = Number(c.req.query("pageSize"))
  const pageSize =
    Number.isInteger(rawPageSize) && rawPageSize > 0 && rawPageSize <= 100
      ? rawPageSize
      : 10

  const rawSort = c.req.query("sort")
  const sort =
    rawSort === "oldest" || rawSort === "hottest" ? rawSort : "newest"

  const prefix = getTablePrefix(c.env)
  const settings = await readCalineSettings(c.env)

  // 1. 查询当页顶级根评论
  const { items: rootRows, total } = await listRootComments(c.env.DB, prefix, {
    url,
    page,
    pageSize,
    sort
  })

  const totalPages = Math.ceil(total / pageSize)
  if (rootRows.length === 0) {
    const emptyResult: ListCommentsResult = {
      items: [],
      total: 0,
      page,
      pageSize,
      totalPages: 0
    }
    return calineSuccess(c, emptyResult)
  }

  // 2. 查出当页所有根评论的所有子回复
  const rootIds = rootRows.map((r) => r.id)
  const replyRows = await listRepliesByRootIds(c.env.DB, prefix, rootIds)

  // 3. 收集所有相关 user_id 与被回复评论映射
  const allRows = [...rootRows, ...replyRows]
  const userIds = [
    ...new Set(
      allRows
        .map((r) => r.user_id)
        .filter((id): id is number => typeof id === "number" && id > 0)
    )
  ]
  const userMap = new Map<
    number,
    {
      displayName: string
      avatar: string
      url: string
      label: string
      email: string
      role: string
    }
  >()
  for (const uid of userIds) {
    const u = await findUserById(c.env.DB, prefix, uid)
    if (u) {
      userMap.set(uid, {
        displayName: u.display_name,
        avatar: u.avatar,
        url: u.url,
        label: u.label,
        email: u.email,
        role: u.role
      })
    }
  }

  // 4. 计算等级与头像工具函数
  const calculateLevel = (approvedCount: number): number | undefined => {
    if (!settings.levelThresholds || settings.levelThresholds.length === 0) {
      return undefined
    }
    let lvl = 0
    for (let i = 0; i < settings.levelThresholds.length; i++) {
      if (approvedCount >= settings.levelThresholds[i]) {
        lvl = i + 1
      }
    }
    return lvl > 0 ? lvl : undefined
  }

  const resolveAvatar = (row: CommentRow): string => {
    if (row.user_id && userMap.has(row.user_id)) {
      const u = userMap.get(row.user_id)!
      if (u.avatar && u.avatar.trim().length > 0) return u.avatar.trim()
      return formatGravatarUrl(u.email, u.displayName, settings.gravatarMirror)
    }
    return formatGravatarUrl(row.mail, row.nick, settings.gravatarMirror)
  }

  const resolveBadge = (row: CommentRow): "admin" | undefined => {
    if (row.user_id && userMap.has(row.user_id)) {
      const u = userMap.get(row.user_id)!
      if (u.role === "admin") {
        return "admin"
      }
    }
    return undefined
  }

  // 预查所有出现过的访客 mail 的 approvedCount
  const mailLevelMap = new Map<string, number | undefined>()
  for (const row of allRows) {
    const normalizedMail = row.mail?.trim().toLowerCase()
    if (normalizedMail && !mailLevelMap.has(normalizedMail)) {
      const count = await countApprovedByMail(c.env.DB, prefix, normalizedMail)
      mailLevelMap.set(normalizedMail, calculateLevel(count))
    }
  }

  // 构建用于 replyTo 的全量字典
  const commentSummaryMap = new Map<
    number,
    { id: number; nick: string; userId: number | null }
  >()
  for (const r of allRows) {
    commentSummaryMap.set(r.id, {
      id: r.id,
      nick: r.nick,
      userId: r.user_id
    })
  }

  // 5. 回复按 rid 归类挂载
  const repliesByRoot = new Map<number, CommentPublicReplyItem[]>()
  for (const reply of replyRows) {
    const rid = reply.rid ?? 0
    if (!repliesByRoot.has(rid)) {
      repliesByRoot.set(rid, [])
    }
    const replyTo =
      reply.pid && commentSummaryMap.has(reply.pid)
        ? commentSummaryMap.get(reply.pid)!
        : null

    const normalizedMail = reply.mail?.trim().toLowerCase()
    const level = normalizedMail ? mailLevelMap.get(normalizedMail) : undefined
    const replyBadge = resolveBadge(reply)

    repliesByRoot.get(rid)!.push({
      id: reply.id,
      userId: reply.user_id,
      nick: reply.nick,
      avatar: resolveAvatar(reply),
      link: reply.link,
      url: reply.url,
      pid: reply.pid ?? rid,
      rid: rid,
      replyTo,
      contentHtml: reply.content_html,
      likeCount: reply.like_count,
      createdAt: reply.created_at,
      updatedAt: reply.updated_at,
      ...(replyBadge ? { badge: replyBadge } : {}),
      level
    })
  }

  // 6. 组装根评论公共列表
  const publicItems: CommentPublicItem[] = rootRows.map((root) => {
    const normalizedMail = root.mail?.trim().toLowerCase()
    const level = normalizedMail ? mailLevelMap.get(normalizedMail) : undefined
    const badge = resolveBadge(root)

    return {
      id: root.id,
      userId: root.user_id,
      nick: root.nick,
      avatar: resolveAvatar(root),
      link: root.link,
      url: root.url,
      contentHtml: root.content_html,
      sticky: root.sticky === 1,
      likeCount: root.like_count,
      createdAt: root.created_at,
      updatedAt: root.updated_at,
      ...(badge ? { badge } : {}),
      level,
      replies: repliesByRoot.get(root.id) || []
    }
  })

  const result: ListCommentsResult = {
    items: publicItems,
    total,
    page,
    pageSize,
    totalPages
  }

  return calineSuccess(c, result)
})

// ─── POST /api/comments 发表/回复评论 ─────────────────────────────────────────

commentsRoutes.post("/", async (c) => {
  const body = await readJsonBody<CreateCommentInput>(c)
  if (!body) {
    return calineError(c, 400, "INVALID_REQUEST", "Invalid request body")
  }

  const url = typeof body.url === "string" ? body.url.trim() : ""
  if (!url) {
    return calineError(c, 400, "INVALID_URL", "Target url is required")
  }

  const content = typeof body.content === "string" ? body.content.trim() : ""
  if (!content) {
    return calineError(c, 400, "INVALID_CONTENT", "Comment content is required")
  }

  const prefix = getTablePrefix(c.env)
  const settings = await readCalineSettings(c.env)
  const ip = clientIp(c)

  // 1. 全局开关校验（规格 §6）
  if (settings.guestMode === "closed") {
    return calineError(c, 403, "COMMENT_CLOSED", "Comment posting is closed")
  }

  // 2. 鉴权态判定（支持 Bearer 与 Cookie）
  const token = readSessionToken(c)
  const session = token ? await findSession(c.env.DB, prefix, token) : null
  const isLoggedIn = Boolean(session)

  if (settings.guestMode === "login_only" && !isLoggedIn) {
    return calineError(
      c,
      403,
      "LOGIN_REQUIRED",
      "Sign in required to post comments"
    )
  }

  // 3. 安全域名校验（Origin/Referer 白名单）
  const originOrReferer = c.req.header("origin") || c.req.header("referer")
  if (!isDomainAllowed(originOrReferer, settings.safeDomains)) {
    return calineError(
      c,
      403,
      "DOMAIN_NOT_ALLOWED",
      "Origin or referer is not in allowed safe domains"
    )
  }

  // 4. IP 黑名单校验
  if (settings.ipBlacklist.includes(ip)) {
    return calineError(c, 403, "IP_BLACKLISTED", "Your IP address is blocked")
  }

  // 5. 身份字段与防冒充（规格 §6）
  let userId: number | null = null
  let nick = ""
  let mail = ""
  let link = ""

  if (session) {
    userId = session.userId
    const user = await findUserById(c.env.DB, prefix, session.userId)
    if (user) {
      nick = user.display_name || user.email.split("@")[0]
      mail = user.email
      link = user.url || ""
    }
  } else {
    // 访客发表：nick 必填
    nick = typeof body.nick === "string" ? body.nick.trim() : ""
    if (!nick) {
      return calineError(
        c,
        400,
        "INVALID_NICK",
        "Nickname is required for guest"
      )
    }

    mail = typeof body.mail === "string" ? body.mail.trim().toLowerCase() : ""
    if (mail && !isValidEmail(mail)) {
      return calineError(c, 400, "INVALID_EMAIL", "Invalid email format")
    }

    link = typeof body.link === "string" ? body.link.trim() : ""

    // 访客防冒充：邮箱若属于已注册用户 → 提示登录
    if (mail) {
      const existingUser = await findUserByEmail(c.env.DB, prefix, mail)
      if (existingUser) {
        return calineError(
          c,
          400,
          "EMAIL_REGISTERED",
          "This email is registered. Please sign in before posting."
        )
      }
    }

    // 访客防冒充：昵称命中保留词或管理员昵称 → 拒绝
    const adminUsers = await listUsers(c.env.DB, prefix)
    const adminNicks = adminUsers
      .filter((u) => u.role === "admin")
      .map((u) => u.displayName || u.email.split("@")[0])
      .filter(Boolean)
    if (isNickReserved(nick, settings.reservedNicks, adminNicks)) {
      return calineError(
        c,
        400,
        "NICK_RESERVED",
        "Nickname is reserved by site administrators"
      )
    }

    // Turnstile 校验（开启时必过）
    if (settings.turnstileEnabled) {
      const turnstileSecret = await getTurnstileSecretKey(c.env)
      if (!turnstileSecret) {
        return calineError(
          c,
          500,
          "TURNSTILE_NOT_CONFIGURED",
          "Turnstile verification key is not configured"
        )
      }
      if (!body.turnstileToken) {
        return calineError(
          c,
          403,
          "TURNSTILE_REQUIRED",
          "Turnstile verification token is required"
        )
      }
      const verified = await verifyTurnstile(
        turnstileSecret,
        body.turnstileToken,
        ip
      )
      if (!verified) {
        return calineError(
          c,
          403,
          "TURNSTILE_FAILED",
          "Turnstile verification failed"
        )
      }
    }

    // IP 限频（默认 60 秒 1 条）
    if (settings.ipRateLimitSeconds > 0) {
      const limitRule = {
        action: "comment_post",
        ip,
        windowSeconds: settings.ipRateLimitSeconds,
        max: 1
      }
      const limit = await enforceRateLimit(c.env.DB, prefix, limitRule)
      if (!limit.allowed) {
        return calineError(
          c,
          429,
          "RATE_LIMITED",
          "Too many comments. Please wait before posting again.",
          { retryAfter: limit.retryAfter }
        )
      }
    }

    // 访客重复内容检测
    const duplicate = await findDuplicateContent(c.env.DB, prefix, {
      mail,
      ip,
      contentRaw: content
    })
    if (duplicate) {
      return calineError(
        c,
        400,
        "DUPLICATE_CONTENT",
        "Duplicate comment content is not allowed"
      )
    }
  }

  // 6. 字数校验
  if (content.length > settings.maxContentLength) {
    return calineError(
      c,
      400,
      "INVALID_CONTENT_LENGTH",
      `Comment length exceeds maximum of ${settings.maxContentLength} characters`
    )
  }

  // 7. 内容渲染与清洗（unified 链）
  const baseUrl = new URL(c.req.url).origin
  const contentHtml = await renderAndSanitizeMarkdown(content, baseUrl)

  // 8. 敏感词与链接数规则
  const isSpam = hasDisallowedWords(
    `${content} ${nick}`,
    settings.disallowedWords
  )
  const linksCount = countLinks(content, contentHtml)

  // 9. 信任分级判定 status
  let hasApprovedHistory = false
  if (!isLoggedIn) {
    hasApprovedHistory = await findApprovedHistory(c.env.DB, prefix, {
      mail,
      ip
    })
  }
  const status = decideCommentStatus({
    isSpam,
    auditSwitch: settings.auditSwitch,
    isLoggedIn,
    linksCount,
    hasApprovedHistory
  })

  // 10. 父子结构归属判定
  let pid: number | null = null
  let rid: number | null = null
  if (body.pid && Number.isInteger(Number(body.pid))) {
    const parent = await findCommentById(c.env.DB, prefix, Number(body.pid))
    if (!parent) {
      return calineError(c, 404, "PARENT_NOT_FOUND", "Parent comment not found")
    }
    pid = parent.id
    // 如果父级已有 rid，则本回复挂同根；否则父级即为根评论
    rid = parent.rid ?? parent.id
  }

  // 11. 访客生成发后编辑令牌（15分钟编辑窗）
  let editToken: string | undefined
  let editTokenHash: string | null = null
  if (!isLoggedIn) {
    editToken = randomToken(32)
    editTokenHash = await sha256Hex(editToken)
  }

  // 12. 入库
  const commentRow = await insertComment(c.env.DB, prefix, {
    userId,
    nick,
    mail,
    link,
    url,
    pid,
    rid,
    contentRaw: content,
    contentHtml,
    status,
    sticky: 0,
    likeCount: 0,
    editTokenHash,
    ip,
    ua: c.req.header("user-agent") ?? ""
  })

  // 13. 异步触发 eNotify 管理员提醒（waitUntil）
  if (settings.enotifyEnabled) {
    const enotifyKey = await getEnotifyKey(c.env)
    if (enotifyKey) {
      c.executionCtx.waitUntil(
        sendEnotifyNotification(enotifyKey, {
          title: `新评论通知 [${status}]`,
          content: `${nick} 在 ${url} 发表了评论: ${content.slice(0, 100)}`
        })
      )
    }
  }

  const result: CreateCommentResult = {
    comment: {
      id: commentRow.id,
      url: commentRow.url,
      status: commentRow.status,
      contentHtml: commentRow.content_html,
      createdAt: commentRow.created_at
    },
    status: commentRow.status,
    editToken
  }

  return calineSuccess(c, result, 201)
})

// ─── PATCH /api/comments/:id 修改自己的评论 ───────────────────────────────────

commentsRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"))
  if (!Number.isInteger(id)) {
    return calineError(c, 404, "COMMENT_NOT_FOUND", "Comment not found")
  }

  const body = await readJsonBody<UpdateCommentInput>(c)
  const content = typeof body?.content === "string" ? body.content.trim() : ""
  if (!content) {
    return calineError(
      c,
      400,
      "INVALID_CONTENT",
      "Comment content cannot be empty"
    )
  }

  const prefix = getTablePrefix(c.env)
  const comment = await findCommentById(c.env.DB, prefix, id)
  if (!comment) {
    return calineError(c, 404, "COMMENT_NOT_FOUND", "Comment not found")
  }

  const settings = await readCalineSettings(c.env)
  if (content.length > settings.maxContentLength) {
    return calineError(
      c,
      400,
      "INVALID_CONTENT_LENGTH",
      `Comment length exceeds maximum of ${settings.maxContentLength} characters`
    )
  }

  // 鉴权判定：登录态本人/管理员，或访客凭 X-Edit-Token 且在 15 分钟窗内
  const token = readSessionToken(c)
  const session = token ? await findSession(c.env.DB, prefix, token) : null

  let authorized = false
  if (session) {
    if (session.userId === comment.user_id || session.role === "admin") {
      authorized = true
    }
  }

  if (!authorized) {
    const editToken = c.req.header("x-edit-token")?.trim()
    if (!editToken || !comment.edit_token_hash) {
      return calineError(
        c,
        403,
        "EDIT_FORBIDDEN",
        "Permission denied or edit token missing"
      )
    }

    const tokenHash = await sha256Hex(editToken)
    if (tokenHash !== comment.edit_token_hash) {
      return calineError(c, 403, "INVALID_EDIT_TOKEN", "Invalid edit token")
    }

    const createdTime = new Date(comment.created_at).getTime()
    if (Date.now() - createdTime > FIFTEEN_MINUTES_MS) {
      return calineError(
        c,
        403,
        "EDIT_WINDOW_EXPIRED",
        "The 15-minute edit window has expired. Please contact the administrator."
      )
    }
    authorized = true
  }

  // 重新渲染+清洗 Markdown
  const baseUrl = new URL(c.req.url).origin
  const contentHtml = await renderAndSanitizeMarkdown(content, baseUrl)
  const updated = await updateCommentContent(
    c.env.DB,
    prefix,
    id,
    content,
    contentHtml
  )
  if (!updated) {
    return calineError(c, 500, "UPDATE_FAILED", "Failed to update comment")
  }

  const result: UpdateCommentResult = {
    id: updated.id,
    contentHtml: updated.content_html,
    updatedAt: updated.updated_at,
    status: updated.status
  }

  return calineSuccess(c, result)
})

// ─── DELETE /api/comments/:id 删除自己的评论 ──────────────────────────────────

commentsRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"))
  if (!Number.isInteger(id)) {
    return calineError(c, 404, "COMMENT_NOT_FOUND", "Comment not found")
  }

  const prefix = getTablePrefix(c.env)
  const comment = await findCommentById(c.env.DB, prefix, id)
  if (!comment) {
    return calineError(c, 404, "COMMENT_NOT_FOUND", "Comment not found")
  }

  const token = readSessionToken(c)
  const session = token ? await findSession(c.env.DB, prefix, token) : null

  let authorized = false
  if (session) {
    if (session.userId === comment.user_id || session.role === "admin") {
      authorized = true
    }
  }

  if (!authorized) {
    const editToken = c.req.header("x-edit-token")?.trim()
    if (!editToken || !comment.edit_token_hash) {
      return calineError(
        c,
        403,
        "DELETE_FORBIDDEN",
        "Permission denied or edit token missing"
      )
    }

    const tokenHash = await sha256Hex(editToken)
    if (tokenHash !== comment.edit_token_hash) {
      return calineError(c, 403, "INVALID_EDIT_TOKEN", "Invalid edit token")
    }

    const createdTime = new Date(comment.created_at).getTime()
    if (Date.now() - createdTime > FIFTEEN_MINUTES_MS) {
      return calineError(
        c,
        403,
        "EDIT_WINDOW_EXPIRED",
        "The 15-minute deletion window has expired. Please contact the administrator."
      )
    }
    authorized = true
  }

  await deleteCommentCascade(c.env.DB, prefix, id)

  const result: DeleteCommentResult = {
    success: true,
    deletedId: id
  }
  return calineSuccess(c, result)
})

// ─── POST /api/comments/:id/like 点赞 ─────────────────────────────────────────

commentsRoutes.post("/:id/like", async (c) => {
  const id = Number(c.req.param("id"))
  if (!Number.isInteger(id)) {
    return calineError(c, 404, "COMMENT_NOT_FOUND", "Comment not found")
  }

  const prefix = getTablePrefix(c.env)
  const newLikeCount = await incrementCommentLike(c.env.DB, prefix, id)
  if (newLikeCount === null) {
    return calineError(c, 404, "COMMENT_NOT_FOUND", "Comment not found")
  }

  const result: LikeCommentResult = {
    id,
    likeCount: newLikeCount
  }
  return calineSuccess(c, result)
})

// ─── GET /api/comments/count 多页面评论数 ─────────────────────────────────────

commentsRoutes.get("/count", async (c) => {
  const rawUrls = c.req.query("urls") || ""
  const urls = rawUrls
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean)

  const prefix = getTablePrefix(c.env)
  const counts: CommentCountsResult = await countApprovedCommentsByUrls(
    c.env.DB,
    prefix,
    urls
  )

  return calineSuccess(c, counts)
})

// ─── GET /api/comments/recent 最近评论 ────────────────────────────────────────

commentsRoutes.get("/recent", async (c) => {
  const rawCount = Number(c.req.query("count"))
  const count = Number.isInteger(rawCount) && rawCount > 0 ? rawCount : 5

  const prefix = getTablePrefix(c.env)
  const settings = await readCalineSettings(c.env)
  const rows = await listRecentComments(c.env.DB, prefix, count)

  const userIds = [
    ...new Set(
      rows
        .map((r) => r.user_id)
        .filter((id): id is number => typeof id === "number" && id > 0)
    )
  ]
  const userMap = new Map<
    number,
    {
      displayName: string
      avatar: string
      email: string
      role: string
    }
  >()
  for (const uid of userIds) {
    const u = await findUserById(c.env.DB, prefix, uid)
    if (u) {
      userMap.set(uid, {
        displayName: u.display_name,
        avatar: u.avatar,
        email: u.email,
        role: u.role
      })
    }
  }

  const resolveAvatar = (row: CommentRow): string => {
    if (row.user_id && userMap.has(row.user_id)) {
      const u = userMap.get(row.user_id)!
      if (u.avatar && u.avatar.trim().length > 0) return u.avatar.trim()
      return formatGravatarUrl(u.email, u.displayName, settings.gravatarMirror)
    }
    return formatGravatarUrl(row.mail, row.nick, settings.gravatarMirror)
  }

  const resolveBadge = (row: CommentRow): "admin" | undefined => {
    if (row.user_id && userMap.has(row.user_id)) {
      const u = userMap.get(row.user_id)!
      if (u.role === "admin") {
        return "admin"
      }
    }
    return undefined
  }

  // 组装脱敏展示数据（mail、ip、ua 绝对不出现）
  const result: RecentCommentsResult = rows.map((row) => {
    const badge = resolveBadge(row)
    return {
      id: row.id,
      url: row.url,
      nick: row.nick,
      avatar: resolveAvatar(row),
      link: row.link,
      contentHtml: row.content_html,
      createdAt: row.created_at,
      ...(badge ? { badge } : {})
    }
  })

  return calineSuccess(c, result)
})
