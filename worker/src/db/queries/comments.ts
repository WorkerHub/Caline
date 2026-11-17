/**
 * 评论核心业务表（<prefix>comment）的 SQL 读写（规格 §3）。
 * 表名一律经 `lib/tables.ts` 的 `commentTable(prefix)` 拼装。
 */
import { commentTable } from "../../lib/tables"

export type CommentStatus = "approved" | "waiting" | "spam"

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
