/**
 * 文章浏览量与 reaction 计数表（<prefix>counter）的 SQL 读写（规格 §3）。
 * 表名一律经 `lib/tables.ts` 的 `counterTable(prefix)` 拼装。
 */
import { counterTable } from "../../lib/tables"

export interface CounterRow {
  id: number
  url: string
  pageview: number
  reaction0: number
  reaction1: number
  reaction2: number
  reaction3: number
  reaction4: number
  reaction5: number
  reaction6: number
  reaction7: number
  reaction8: number
  created_at: string
  updated_at: string
}

export const COUNTER_COLUMNS = `id, url, pageview, reaction0, reaction1, reaction2,
  reaction3, reaction4, reaction5, reaction6, reaction7, reaction8, created_at, updated_at`

export interface UpsertCounterInput {
  url: string
  pageview?: number
  reaction0?: number
  reaction1?: number
  reaction2?: number
  reaction3?: number
  reaction4?: number
  reaction5?: number
  reaction6?: number
  reaction7?: number
  reaction8?: number
  createdAt?: string
  updatedAt?: string
}

export async function getCounterByUrl(
  db: D1Database,
  prefix: string,
  url: string
): Promise<CounterRow | null> {
  return db
    .prepare(
      `SELECT ${COUNTER_COLUMNS} FROM ${counterTable(prefix)} WHERE url = ?`
    )
    .bind(url)
    .first<CounterRow>()
}

export async function upsertCounter(
  db: D1Database,
  prefix: string,
  input: UpsertCounterInput
): Promise<CounterRow> {
  const table = counterTable(prefix)
  const now = new Date().toISOString()
  const createdAt = input.createdAt ?? now
  const updatedAt = input.updatedAt ?? now

  // 构建 ON CONFLICT 更新子句：仅更新显式传入的计数列，未提供时保留已有值防覆盖归零
  const updateClauses = ["updated_at = excluded.updated_at"]
  if (input.pageview !== undefined) {
    updateClauses.push("pageview = excluded.pageview")
  }
  for (let i = 0; i <= 8; i++) {
    const key = `reaction${i}` as keyof UpsertCounterInput
    if (input[key] !== undefined) {
      updateClauses.push(`${key} = excluded.${key}`)
    }
  }

  await db
    .prepare(
      `INSERT INTO ${table}
        (url, pageview, reaction0, reaction1, reaction2, reaction3,
         reaction4, reaction5, reaction6, reaction7, reaction8, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET
         ${updateClauses.join(", ")}`
    )
    .bind(
      input.url,
      input.pageview ?? 0,
      input.reaction0 ?? 0,
      input.reaction1 ?? 0,
      input.reaction2 ?? 0,
      input.reaction3 ?? 0,
      input.reaction4 ?? 0,
      input.reaction5 ?? 0,
      input.reaction6 ?? 0,
      input.reaction7 ?? 0,
      input.reaction8 ?? 0,
      createdAt,
      updatedAt
    )
    .run()

  const counter = await getCounterByUrl(db, prefix, input.url)
  if (!counter) throw new Error("counter missing after upsert")
  return counter
}

export async function incrementPageview(
  db: D1Database,
  prefix: string,
  url: string
): Promise<CounterRow> {
  const table = counterTable(prefix)
  const now = new Date().toISOString()

  await db
    .prepare(
      `INSERT INTO ${table}
        (url, pageview, reaction0, reaction1, reaction2, reaction3,
         reaction4, reaction5, reaction6, reaction7, reaction8, created_at, updated_at)
       VALUES (?, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)
       ON CONFLICT(url) DO UPDATE SET
         pageview = ${table}.pageview + 1,
         updated_at = excluded.updated_at`
    )
    .bind(url, now, now)
    .run()

  const counter = await getCounterByUrl(db, prefix, url)
  if (!counter) throw new Error("counter missing after incrementPageview")
  return counter
}

export async function incrementReaction(
  db: D1Database,
  prefix: string,
  url: string,
  reactionIndex: number
): Promise<CounterRow> {
  const index = Math.floor(reactionIndex)
  if (index < 0 || index > 8) {
    throw new Error(`Invalid reaction index: ${reactionIndex}`)
  }
  const field = `reaction${index}`
  const table = counterTable(prefix)
  const now = new Date().toISOString()

  await db
    .prepare(
      `INSERT INTO ${table}
        (url, pageview, reaction0, reaction1, reaction2, reaction3,
         reaction4, reaction5, reaction6, reaction7, reaction8, created_at, updated_at)
       VALUES (?, 0,
         ${index === 0 ? "1" : "0"},
         ${index === 1 ? "1" : "0"},
         ${index === 2 ? "1" : "0"},
         ${index === 3 ? "1" : "0"},
         ${index === 4 ? "1" : "0"},
         ${index === 5 ? "1" : "0"},
         ${index === 6 ? "1" : "0"},
         ${index === 7 ? "1" : "0"},
         ${index === 8 ? "1" : "0"},
         ?, ?)
       ON CONFLICT(url) DO UPDATE SET
         ${field} = ${table}.${field} + 1,
         updated_at = excluded.updated_at`
    )
    .bind(url, now, now)
    .run()

  const counter = await getCounterByUrl(db, prefix, url)
  if (!counter) throw new Error("counter missing after incrementReaction")
  return counter
}
