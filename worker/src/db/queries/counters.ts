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

  await db
    .prepare(
      `INSERT INTO ${table}
        (url, pageview, reaction0, reaction1, reaction2, reaction3,
         reaction4, reaction5, reaction6, reaction7, reaction8, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET
         pageview = excluded.pageview,
         reaction0 = excluded.reaction0,
         reaction1 = excluded.reaction1,
         reaction2 = excluded.reaction2,
         reaction3 = excluded.reaction3,
         reaction4 = excluded.reaction4,
         reaction5 = excluded.reaction5,
         reaction6 = excluded.reaction6,
         reaction7 = excluded.reaction7,
         reaction8 = excluded.reaction8,
         updated_at = excluded.updated_at`
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
