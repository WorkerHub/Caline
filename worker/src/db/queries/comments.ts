/**
 * 评论核心业务表（<prefix>comment）的 SQL 读写（规格 §3）。
 * 表名一律经 `lib/tables.ts` 的 `commentTable(prefix)` 拼装。
 */
import type { CommentStatus } from "@caline/shared"
import { commentTable } from "../../lib/tables"

export type { CommentStatus }

export interface CommentRow {
  id: number
  user_id: number | null
  nick: string
  mail: string
  link: string
  url: string
  pid: number | null
  rid: number | null
  content_raw: string
  content_html: string
  status: CommentStatus
  sticky: number
  like_count: number
  edit_token_hash: string | null
  ip: string
  ua: string
  created_at: string
  updated_at: string
}

export const COMMENT_COLUMNS = `id, user_id, nick, mail, link, url, pid, rid,
  content_raw, content_html, status, sticky, like_count, edit_token_hash,
  ip, ua, created_at, updated_at`

export interface CreateCommentInput {
  userId?: number | null
  nick?: string
  mail?: string
  link?: string
  url: string
  pid?: number | null
  rid?: number | null
  contentRaw: string
  contentHtml?: string
  status?: CommentStatus
  sticky?: number
  likeCount?: number
  editTokenHash?: string | null
  ip?: string
  ua?: string
  createdAt?: string
  updatedAt?: string
}

export async function insertComment(
  db: D1Database,
  prefix: string,
  input: CreateCommentInput
): Promise<CommentRow> {
  const table = commentTable(prefix)
  const now = new Date().toISOString()
  const createdAt = input.createdAt ?? now
  const updatedAt = input.updatedAt ?? now

  const result = await db
    .prepare(
      `INSERT INTO ${table}
        (user_id, nick, mail, link, url, pid, rid,
         content_raw, content_html, status, sticky, like_count,
         edit_token_hash, ip, ua, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.userId ?? null,
      input.nick ?? "",
      input.mail ?? "",
      input.link ?? "",
      input.url,
      input.pid ?? null,
      input.rid ?? null,
      input.contentRaw,
      input.contentHtml ?? "",
      input.status ?? "approved",
      input.sticky ? 1 : 0,
      input.likeCount ?? 0,
      input.editTokenHash ?? null,
      input.ip ?? "",
      input.ua ?? "",
      createdAt,
      updatedAt
    )
    .run()

  const id = Number(result.meta.last_row_id)
  const row = await findCommentById(db, prefix, id)
  if (!row) throw new Error("comment missing immediately after insert")
  return row
}

export async function findCommentById(
  db: D1Database,
  prefix: string,
  id: number
): Promise<CommentRow | null> {
  return db
    .prepare(
      `SELECT ${COMMENT_COLUMNS} FROM ${commentTable(prefix)} WHERE id = ?`
    )
    .bind(id)
    .first<CommentRow>()
}

export async function listCommentsByUrl(
  db: D1Database,
  prefix: string,
  url: string,
  status?: CommentStatus
): Promise<CommentRow[]> {
  const table = commentTable(prefix)
  const statement = db.prepare(
    `SELECT ${COMMENT_COLUMNS} FROM ${table}
     WHERE url = ? ${status ? "AND status = ?" : ""}
     ORDER BY sticky DESC, id ASC`
  )
  const rows = await (status
    ? statement.bind(url, status)
    : statement.bind(url)
  ).all<CommentRow>()
  return rows.results
}

export interface ListRootCommentsOptions {
  url: string
  page: number
  pageSize: number
  sort?: "newest" | "oldest" | "hottest"
}

export async function listRootComments(
  db: D1Database,
  prefix: string,
  options: ListRootCommentsOptions
): Promise<{ items: CommentRow[]; total: number }> {
  const table = commentTable(prefix)
  const offset = (options.page - 1) * options.pageSize

  let orderClause = "ORDER BY sticky DESC, created_at DESC, id DESC"
  if (options.sort === "oldest") {
    orderClause = "ORDER BY sticky DESC, created_at ASC, id ASC"
  } else if (options.sort === "hottest") {
    orderClause =
      "ORDER BY sticky DESC, like_count DESC, created_at DESC, id DESC"
  }

  const countRow = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM ${table}
       WHERE url = ? AND status = 'approved' AND (pid IS NULL OR pid = 0)`
    )
    .bind(options.url)
    .first<{ total: number }>()

  const total = Number(countRow?.total ?? 0)

  const items = await db
    .prepare(
      `SELECT ${COMMENT_COLUMNS} FROM ${table}
       WHERE url = ? AND status = 'approved' AND (pid IS NULL OR pid = 0)
       ${orderClause}
       LIMIT ? OFFSET ?`
    )
    .bind(options.url, options.pageSize, offset)
    .all<CommentRow>()

  return { items: items.results, total }
}

export async function listRepliesByRootIds(
  db: D1Database,
  prefix: string,
  rootIds: number[]
): Promise<CommentRow[]> {
  if (rootIds.length === 0) return []
  const table = commentTable(prefix)
  const placeholders = rootIds.map(() => "?").join(", ")

  const rows = await db
    .prepare(
      `SELECT ${COMMENT_COLUMNS} FROM ${table}
       WHERE rid IN (${placeholders}) AND status = 'approved'
       ORDER BY id ASC`
    )
    .bind(...rootIds)
    .all<CommentRow>()

  return rows.results
}

export async function findApprovedHistory(
  db: D1Database,
  prefix: string,
  key: { mail?: string; ip?: string }
): Promise<boolean> {
  const table = commentTable(prefix)
  const mail = key.mail?.trim().toLowerCase()
  const ip = key.ip?.trim()

  if (mail && mail.length > 0) {
    const row = await db
      .prepare(
        `SELECT 1 AS ok FROM ${table} WHERE status = 'approved' AND LOWER(mail) = ? LIMIT 1`
      )
      .bind(mail)
      .first<{ ok: number }>()
    return Boolean(row)
  }

  if (ip && ip.length > 0) {
    const row = await db
      .prepare(
        `SELECT 1 AS ok FROM ${table} WHERE status = 'approved' AND ip = ? LIMIT 1`
      )
      .bind(ip)
      .first<{ ok: number }>()
    return Boolean(row)
  }

  return false
}

export async function findDuplicateContent(
  db: D1Database,
  prefix: string,
  input: { mail?: string; ip?: string; contentRaw: string }
): Promise<boolean> {
  const table = commentTable(prefix)
  const mail = input.mail?.trim().toLowerCase()
  const ip = input.ip?.trim()
  const content = input.contentRaw.trim()

  if (mail && mail.length > 0) {
    const row = await db
      .prepare(
        `SELECT 1 AS ok FROM ${table} WHERE content_raw = ? AND LOWER(mail) = ? LIMIT 1`
      )
      .bind(content, mail)
      .first<{ ok: number }>()
    if (row) return true
  }

  if (ip && ip.length > 0) {
    const row = await db
      .prepare(
        `SELECT 1 AS ok FROM ${table} WHERE content_raw = ? AND ip = ? LIMIT 1`
      )
      .bind(content, ip)
      .first<{ ok: number }>()
    if (row) return true
  }

  return false
}

export async function incrementCommentLike(
  db: D1Database,
  prefix: string,
  id: number
): Promise<number | null> {
  const table = commentTable(prefix)
  const result = await db
    .prepare(`UPDATE ${table} SET like_count = like_count + 1 WHERE id = ?`)
    .bind(id)
    .run()

  if (result.meta.changes === 0) return null

  const row = await db
    .prepare(`SELECT like_count FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<{ like_count: number }>()

  return row ? Number(row.like_count) : null
}

export async function updateCommentContent(
  db: D1Database,
  prefix: string,
  id: number,
  contentRaw: string,
  contentHtml: string,
  now = new Date().toISOString()
): Promise<CommentRow | null> {
  const table = commentTable(prefix)
  await db
    .prepare(
      `UPDATE ${table}
       SET content_raw = ?, content_html = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(contentRaw, contentHtml, now, id)
    .run()

  return findCommentById(db, prefix, id)
}

export async function countApprovedCommentsByUrls(
  db: D1Database,
  prefix: string,
  urls: string[]
): Promise<Record<string, number>> {
  const result: Record<string, number> = {}
  for (const u of urls) {
    result[u] = 0
  }
  if (urls.length === 0) return result

  const table = commentTable(prefix)
  const placeholders = urls.map(() => "?").join(", ")
  const rows = await db
    .prepare(
      `SELECT url, COUNT(*) AS count FROM ${table}
       WHERE status = 'approved' AND url IN (${placeholders})
       GROUP BY url`
    )
    .bind(...urls)
    .all<{ url: string; count: number }>()

  for (const row of rows.results) {
    result[row.url] = Number(row.count)
  }
  return result
}

export async function listRecentComments(
  db: D1Database,
  prefix: string,
  count = 5
): Promise<CommentRow[]> {
  const table = commentTable(prefix)
  const limit = Math.min(Math.max(1, count), 20)
  const rows = await db
    .prepare(
      `SELECT ${COMMENT_COLUMNS} FROM ${table}
       WHERE status = 'approved'
       ORDER BY id DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<CommentRow>()

  return rows.results
}

export async function countApprovedByMail(
  db: D1Database,
  prefix: string,
  mail: string
): Promise<number> {
  const normalized = mail.trim().toLowerCase()
  if (!normalized) return 0
  const table = commentTable(prefix)
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM ${table}
       WHERE status = 'approved' AND LOWER(mail) = ?`
    )
    .bind(normalized)
    .first<{ total: number }>()
  return Number(row?.total ?? 0)
}

export async function deleteCommentCascade(
  db: D1Database,
  prefix: string,
  id: number
): Promise<number[]> {
  const table = commentTable(prefix)
  const target = await findCommentById(db, prefix, id)
  if (!target) return []

  // 递归查找以 id 为根或指向该评论的所有回复子树（含所有后代）
  const rows = await db
    .prepare(
      `WITH RECURSIVE sub AS (
         SELECT id FROM ${table} WHERE id = ? OR rid = ?
         UNION ALL
         SELECT c.id FROM ${table} c JOIN sub ON c.pid = sub.id
       )
       SELECT DISTINCT id FROM sub`
    )
    .bind(id, id)
    .all<{ id: number }>()

  const deletedIds = rows.results.map((r) => Number(r.id))
  if (deletedIds.length === 0) return []

  const placeholders = deletedIds.map(() => "?").join(", ")
  await db
    .prepare(`DELETE FROM ${table} WHERE id IN (${placeholders})`)
    .bind(...deletedIds)
    .run()

  return deletedIds
}

export interface AdminSearchCommentsOptions {
  status?: string
  q?: string
  page: number
  pageSize: number
}

export async function adminSearchComments(
  db: D1Database,
  prefix: string,
  options: AdminSearchCommentsOptions
): Promise<{ items: CommentRow[]; total: number }> {
  const table = commentTable(prefix)
  const conditions: string[] = []
  const params: Array<string | number> = []

  if (options.status && options.status !== "all") {
    conditions.push("status = ?")
    params.push(options.status)
  }

  if (options.q && options.q.trim().length > 0) {
    const searchPattern = `%${options.q.trim()}%`
    conditions.push(
      "(nick LIKE ? OR mail LIKE ? OR content_raw LIKE ? OR url LIKE ?)"
    )
    params.push(searchPattern, searchPattern, searchPattern, searchPattern)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM ${table} ${whereClause}`)
    .bind(...params)
    .first<{ total: number }>()

  const total = Number(countRow?.total ?? 0)
  const offset = (options.page - 1) * options.pageSize

  const items = await db
    .prepare(
      `SELECT ${COMMENT_COLUMNS} FROM ${table}
       ${whereClause}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...params, options.pageSize, offset)
    .all<CommentRow>()

  return { items: items.results, total }
}

export interface ListUserCommentsOptions {
  userId: number
  page: number
  pageSize: number
}

/** 查用户本人评论列表（含全部 status，按 created_at 倒序分页） */
export async function listUserComments(
  db: D1Database,
  prefix: string,
  options: ListUserCommentsOptions
): Promise<{ items: CommentRow[]; total: number }> {
  const table = commentTable(prefix)
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE user_id = ?`)
    .bind(options.userId)
    .first<{ total: number }>()

  const total = Number(countRow?.total ?? 0)
  const offset = (options.page - 1) * options.pageSize

  const items = await db
    .prepare(
      `SELECT ${COMMENT_COLUMNS} FROM ${table}
       WHERE user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .bind(options.userId, options.pageSize, offset)
    .all<CommentRow>()

  return { items: items.results, total }
}

export async function adminUpdateCommentFields(
  db: D1Database,
  prefix: string,
  id: number,
  patch: {
    status?: CommentStatus
    sticky?: number
    contentRaw?: string
    contentHtml?: string
  }
): Promise<CommentRow | null> {
  const table = commentTable(prefix)
  const assignments: string[] = []
  const values: Array<string | number> = []

  if (patch.status !== undefined) {
    assignments.push("status = ?")
    values.push(patch.status)
  }
  if (patch.sticky !== undefined) {
    assignments.push("sticky = ?")
    values.push(patch.sticky ? 1 : 0)
  }
  if (patch.contentRaw !== undefined) {
    assignments.push("content_raw = ?")
    values.push(patch.contentRaw)
  }
  if (patch.contentHtml !== undefined) {
    assignments.push("content_html = ?")
    values.push(patch.contentHtml)
  }

  if (assignments.length === 0) return findCommentById(db, prefix, id)

  assignments.push("updated_at = ?")
  values.push(new Date().toISOString())

  await db
    .prepare(`UPDATE ${table} SET ${assignments.join(", ")} WHERE id = ?`)
    .bind(...values, id)
    .run()

  return findCommentById(db, prefix, id)
}

export async function adminBatchUpdateStatus(
  db: D1Database,
  prefix: string,
  ids: number[],
  status: CommentStatus
): Promise<number> {
  if (ids.length === 0) return 0
  const table = commentTable(prefix)
  const placeholders = ids.map(() => "?").join(", ")
  const now = new Date().toISOString()

  const result = await db
    .prepare(
      `UPDATE ${table} SET status = ?, updated_at = ? WHERE id IN (${placeholders})`
    )
    .bind(status, now, ...ids)
    .run()

  return result.meta.changes
}

export async function adminBatchDelete(
  db: D1Database,
  prefix: string,
  ids: number[]
): Promise<number> {
  let count = 0
  for (const id of ids) {
    const deleted = await deleteCommentCascade(db, prefix, id)
    count += deleted.length
  }
  return count
}
