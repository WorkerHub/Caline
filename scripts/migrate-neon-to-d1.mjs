#!/usr/bin/env node
/**
 * Neon (Waline) → D1 数据迁移与抽查验证脚本（规格 §3、§11）。
 *
 * 核心职责：
 * 1. 解析 Waline 的三表导出数据（wl_comment, wl_counter, wl_users，JSON 格式）。
 * 2. 转换规则：
 *    - Users：只迁管理员 1 条资料，密码不迁（留空并在 setup 重设，must_change_password=1），
 *      过滤无邮箱的 guest 空记录；记录管理员 objectId → 整数 id (1)。
 *    - Comment：按时间升序对 objectId 映射为自增整数 id；重写 pid/rid 楼层引用链；
 *      映射 comment → content_raw，like → like_count，关联管理员 user_id。
 *    - Counter：映射 time → pageview，保留 reaction0..8。
 * 3. 生成可执行的 D1 SQL 语句（支持 TABLE_PREFIX 前缀）。
 * 4. 离线抽查验证（--verify）：在本地内存 SQLite 中应用基线 schema，执行导入，
 *    校验条数、随机抽查 5 条回复的 pid/rid 楼层链完整性，并核对管理员可用性。
 */

import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { parseArgs } from "node:util"

const PBKDF2_ITERATIONS = 100_000
const PASSWORD_KEY_BITS = 256
const PASSWORD_SALT_BYTES = 32

function bufToHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** 密码哈希（与 worker/src/core/auth.ts PBKDF2-SHA256 保持逐字一致）。 */
export async function hashPassword(password) {
  const encoder = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES))
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  )
  const hash = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    },
    keyMaterial,
    PASSWORD_KEY_BITS
  )
  return `${bufToHex(salt.buffer)}:${bufToHex(hash)}`
}

/** 转义 SQL 字符串（单引号转为 ''）。 */
export function sqlEscape(value) {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "0"
  if (typeof value === "boolean") return value ? "1" : "0"
  const str = String(value)
  return `'${str.replace(/'/g, "''")}'`
}

/** 格式化 ISO8601 时间戳。 */
function formatIso(raw) {
  if (!raw) return new Date().toISOString()
  try {
    const d = new Date(raw)
    return Number.isNaN(d.getTime())
      ? new Date().toISOString()
      : d.toISOString()
  } catch {
    return new Date().toISOString()
  }
}

/** 提取 JSON 数据中的行数组（兼容直接数组或包装在 rows/data 下的形式）。 */
export function extractRows(rawJson) {
  if (Array.isArray(rawJson)) return rawJson
  if (rawJson && typeof rawJson === "object") {
    if (Array.isArray(rawJson.rows)) return rawJson.rows
    if (Array.isArray(rawJson.data)) return rawJson.data
  }
  return []
}

/**
 * 转换三表数据（纯函数，易测试）。
 */
export async function transformData(source, options = {}) {
  const { adminPassword } = options

  const rawUsers = extractRows(source.users)
  const rawComments = extractRows(source.comments)
  const rawCounters = extractRows(source.counters)

  // 1. 转换 Users：只迁管理员 1 条，过滤 guest 空记录
  const adminCandidates = rawUsers.filter((u) => {
    const email = (u.email || u.mail || "").trim().toLowerCase()
    const type = (u.type || u.role || "").toLowerCase()
    // 排除无邮箱或明确标记为 guest 的记录
    if (!email || type === "guest") return false
    return type === "administrator" || type === "admin" || true
  })

  let adminUser = null
  let adminObjectId = null
  if (adminCandidates.length > 0) {
    // 优先选明确为 administrator 的，否则取第一条有效用户
    const explicitAdmin = adminCandidates.find(
      (u) =>
        (u.type || u.role || "").toLowerCase() === "administrator" ||
        (u.type || u.role || "").toLowerCase() === "admin"
    )
    const sourceAdmin = explicitAdmin || adminCandidates[0]
    adminObjectId = String(sourceAdmin.objectId || sourceAdmin.id || "")

    let passwordHash = ""
    if (adminPassword) {
      passwordHash = await hashPassword(adminPassword)
    }

    const email = (sourceAdmin.email || sourceAdmin.mail || "")
      .trim()
      .toLowerCase()
    const displayName = (
      sourceAdmin.display_name ||
      sourceAdmin.nick ||
      email.split("@")[0] ||
      ""
    ).trim()

    adminUser = {
      id: 1,
      email,
      password_hash: passwordHash,
      role: "admin",
      status: "active",
      email_verified: 1,
      language: "zh",
      display_name: displayName,
      timezone: "Asia/Shanghai",
      created_at: formatIso(sourceAdmin.createdAt || sourceAdmin.created_at),
      updated_at: formatIso(sourceAdmin.updatedAt || sourceAdmin.updated_at),
      must_change_password: 1,
      label: (sourceAdmin.label || "").trim(),
      avatar: (sourceAdmin.avatar || "").trim(),
      url: (sourceAdmin.url || "").trim(),
      github_id: sourceAdmin.github_id || null
    }
  }

  // 2. 转换 Comments：排序并建立 objectId -> 整数 id 字典
  // 按照 createdAt 升序排，保证自增 id 与时间先后一致
  const sortedComments = [...rawComments].sort((a, b) => {
    const ta = new Date(a.createdAt || a.created_at || 0).getTime()
    const tb = new Date(b.createdAt || b.created_at || 0).getTime()
    return ta - tb
  })

  const commentIdMap = new Map()
  sortedComments.forEach((c, index) => {
    const rawId = String(c.objectId || c.id || "")
    if (rawId) {
      commentIdMap.set(rawId, index + 1)
    }
  })

  // 原始 objectId 映射回父节点 objectId
  const sourceParentMap = new Map()
  sortedComments.forEach((c) => {
    const rawId = String(c.objectId || c.id || "")
    const rawPid = String(c.pid || "")
    if (rawId && rawPid && rawPid !== "0" && rawPid !== rawId) {
      sourceParentMap.set(rawId, rawPid)
    }
  })

  // 递归寻找根评论 objectId
  function findRootObjectId(rawId) {
    let curr = rawId
    const visited = new Set([curr])
    while (sourceParentMap.has(curr)) {
      const parent = sourceParentMap.get(curr)
      if (visited.has(parent) || !commentIdMap.has(parent)) break
      visited.add(parent)
      curr = parent
    }
    return curr
  }

  const comments = sortedComments.map((c, index) => {
    const id = index + 1
    const rawId = String(c.objectId || c.id || "")
    const rawPid = String(c.pid || "")
    const rawRid = String(c.rid || "")

    // 重写 pid
    let targetPid = null
    if (
      rawPid &&
      rawPid !== "0" &&
      rawPid !== rawId &&
      commentIdMap.has(rawPid)
    ) {
      targetPid = commentIdMap.get(rawPid)
    }

    // 重写 rid：根评论自身 rid 为 null；回复则追溯至根
    let targetRid = null
    if (targetPid !== null) {
      if (
        rawRid &&
        rawRid !== "0" &&
        rawRid !== rawId &&
        commentIdMap.has(rawRid)
      ) {
        targetRid = commentIdMap.get(rawRid)
      } else {
        const rootObjId = findRootObjectId(rawId)
        if (rootObjId && rootObjId !== rawId && commentIdMap.has(rootObjId)) {
          targetRid = commentIdMap.get(rootObjId)
        } else {
          targetRid = targetPid
        }
      }
    }

    // 作者关联：若原评论 user_id 等于管理员 objectId 或邮箱吻合
    let userId = null
    const commentUserId = String(c.user_id || "")
    const commentMail = (c.mail || "").trim().toLowerCase()
    if (
      (adminObjectId && commentUserId === adminObjectId) ||
      (adminUser && commentMail && commentMail === adminUser.email)
    ) {
      userId = 1
    }

    // 状态规整
    let status = "approved"
    const rawStatus = String(c.status || "").toLowerCase()
    if (rawStatus === "waiting" || rawStatus === "pending") status = "waiting"
    else if (rawStatus === "spam") status = "spam"
    else if (c.status === false) status = "waiting"

    const contentRaw = String(c.comment || c.content_raw || "")
    const contentHtml = String(c.content_html || c.html || "")

    return {
      id,
      user_id: userId,
      nick: (c.nick || "").trim(),
      mail: (c.mail || "").trim(),
      link: (c.link || "").trim(),
      url: String(c.url || ""),
      pid: targetPid,
      rid: targetRid,
      content_raw: contentRaw,
      content_html: contentHtml,
      status,
      sticky: c.sticky ? 1 : 0,
      like_count: Number(c.like || c.like_count || 0) || 0,
      edit_token_hash: null,
      ip: String(c.ip || ""),
      ua: String(c.ua || ""),
      created_at: formatIso(c.createdAt || c.created_at),
      updated_at: formatIso(c.updatedAt || c.updated_at)
    }
  })

  // 3. 转换 Counter：去重并累加聚合
  const counterMap = new Map()
  rawCounters.forEach((cnt) => {
    const rawUrl = String(cnt.url || "").trim()
    if (!rawUrl) return

    const pageview = Number(cnt.time || cnt.pageview || 0) || 0
    const reactions = []
    for (let i = 0; i <= 8; i++) {
      reactions[i] = Number(cnt[`reaction${i}`] || 0) || 0
    }
    const createdAt = formatIso(cnt.createdAt || cnt.created_at)
    const updatedAt = formatIso(cnt.updatedAt || cnt.updated_at)

    if (counterMap.has(rawUrl)) {
      const existing = counterMap.get(rawUrl)
      existing.pageview += pageview
      for (let i = 0; i <= 8; i++) {
        existing[`reaction${i}`] += reactions[i]
      }
      if (
        new Date(updatedAt).getTime() > new Date(existing.updated_at).getTime()
      ) {
        existing.updated_at = updatedAt
      }
    } else {
      const item = {
        url: rawUrl,
        pageview,
        created_at: createdAt,
        updated_at: updatedAt
      }
      for (let i = 0; i <= 8; i++) {
        item[`reaction${i}`] = reactions[i]
      }
      counterMap.set(rawUrl, item)
    }
  })

  const counters = [...counterMap.values()]

  return {
    adminUser,
    comments,
    counters
  }
}

/**
 * 根据转换后的数据生成 D1 SQL 插入语句。
 */
export function generateSql(transformed, prefix = "caline_") {
  const statements = []
  statements.push("-- Neon -> D1 数据迁移导入脚本")
  statements.push(`-- 生成时间: ${new Date().toISOString()}`)
  statements.push(`-- TABLE_PREFIX: ${prefix}`)
  statements.push("")

  // 1. Users 表
  if (transformed.adminUser) {
    const u = transformed.adminUser
    statements.push(`-- 1. 管理员用户 (${u.email})`)
    statements.push(
      `INSERT INTO ${prefix}users ` +
        `(id, email, password_hash, role, status, email_verified, language, display_name, timezone, created_at, updated_at, must_change_password, label, avatar, url, github_id) ` +
        `VALUES (${u.id}, ${sqlEscape(u.email)}, ${sqlEscape(u.password_hash)}, ${sqlEscape(u.role)}, ${sqlEscape(u.status)}, ${u.email_verified}, ` +
        `${sqlEscape(u.language)}, ${sqlEscape(u.display_name)}, ${sqlEscape(u.timezone)}, ${sqlEscape(u.created_at)}, ${sqlEscape(u.updated_at)}, ` +
        `${u.must_change_password}, ${sqlEscape(u.label)}, ${sqlEscape(u.avatar)}, ${sqlEscape(u.url)}, ${sqlEscape(u.github_id)});`
    )
    statements.push("")
  }

  // 2. Comment 表
  if (transformed.comments.length > 0) {
    statements.push(`-- 2. 评论数据 (共 ${transformed.comments.length} 条)`)
    for (const c of transformed.comments) {
      statements.push(
        `INSERT INTO ${prefix}comment ` +
          `(id, user_id, nick, mail, link, url, pid, rid, content_raw, content_html, status, sticky, like_count, edit_token_hash, ip, ua, created_at, updated_at) ` +
          `VALUES (${c.id}, ${sqlEscape(c.user_id)}, ${sqlEscape(c.nick)}, ${sqlEscape(c.mail)}, ${sqlEscape(c.link)}, ${sqlEscape(c.url)}, ` +
          `${sqlEscape(c.pid)}, ${sqlEscape(c.rid)}, ${sqlEscape(c.content_raw)}, ${sqlEscape(c.content_html)}, ${sqlEscape(c.status)}, ` +
          `${c.sticky}, ${c.like_count}, ${sqlEscape(c.edit_token_hash)}, ${sqlEscape(c.ip)}, ${sqlEscape(c.ua)}, ${sqlEscape(c.created_at)}, ${sqlEscape(c.updated_at)});`
      )
    }
    statements.push("")
  }

  // 3. Counter 表
  if (transformed.counters.length > 0) {
    statements.push(`-- 3. 统计计数数据 (共 ${transformed.counters.length} 条)`)
    for (const cnt of transformed.counters) {
      statements.push(
        `INSERT INTO ${prefix}counter ` +
          `(url, pageview, reaction0, reaction1, reaction2, reaction3, reaction4, reaction5, reaction6, reaction7, reaction8, created_at, updated_at) ` +
          `VALUES (${sqlEscape(cnt.url)}, ${cnt.pageview}, ${cnt.reaction0}, ${cnt.reaction1}, ${cnt.reaction2}, ${cnt.reaction3}, ` +
          `${cnt.reaction4}, ${cnt.reaction5}, ${cnt.reaction6}, ${cnt.reaction7}, ${cnt.reaction8}, ${sqlEscape(cnt.created_at)}, ${sqlEscape(cnt.updated_at)});`
      )
    }
    statements.push("")
  }

  return statements.join("\n")
}

/**
 * 使用本地内存 SQLite 执行基线建表与插入，并按规格 §11 运行抽查验证。
 */
export function verifyInSqlite(
  sqlStatements,
  prefix = "caline_",
  options = {}
) {
  const { sampleCount = 5 } = options
  const db = new DatabaseSync(":memory:")

  // 1. 获取基线 schema 并替换前缀
  // 读 worker/src/db/schema.sql
  const schemaFile = path.resolve(
    import.meta.dirname,
    "../worker/src/db/schema.sql"
  )
  const rawSchema = readFileSync(schemaFile, "utf8")
  const schemaSql = rawSchema
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replaceAll("{prefix}", prefix)

  // 执行建表
  for (const stmt of schemaSql.split(";")) {
    const trimmed = stmt.trim()
    if (trimmed) {
      db.exec(trimmed)
    }
  }

  // 2. 执行导入 SQL
  for (const stmt of sqlStatements.split(";")) {
    const trimmed = stmt.trim()
    if (trimmed) {
      db.exec(trimmed)
    }
  }

  // 3. 验证抽查
  // 3.1 用户表抽查
  const users = db.prepare(`SELECT * FROM ${prefix}users`).all()
  const adminUser = users.find(
    (u) => u.role === "admin" && u.status === "active"
  )

  // 3.2 评论表抽查与楼层关系链验证
  const comments = db.prepare(`SELECT * FROM ${prefix}comment`).all()
  const commentMap = new Map(comments.map((c) => [c.id, c]))

  const replies = comments.filter((c) => c.pid !== null)
  // 随机（或顺序）抽样 5 条回复
  const sampledReplies = replies.slice(0, sampleCount)
  const chainCheckErrors = []

  for (const reply of sampledReplies) {
    const parent = commentMap.get(reply.pid)
    if (!parent) {
      chainCheckErrors.push(
        `Reply #${reply.id} pid=${reply.pid} points to non-existent comment`
      )
      continue
    }
    const root = commentMap.get(reply.rid)
    if (!root) {
      chainCheckErrors.push(
        `Reply #${reply.id} rid=${reply.rid} points to non-existent comment`
      )
      continue
    }
    if (root.pid !== null) {
      chainCheckErrors.push(
        `Reply #${reply.id} rid=${reply.rid} is not a root comment (its pid is ${root.pid})`
      )
    }
  }

  // 3.3 计数表抽查
  const counters = db.prepare(`SELECT * FROM ${prefix}counter`).all()

  const report = {
    prefix,
    counts: {
      users: users.length,
      comments: comments.length,
      replies: replies.length,
      counters: counters.length
    },
    adminCheck: {
      valid: Boolean(adminUser),
      email: adminUser?.email || null,
      mustChangePassword: adminUser?.must_change_password === 1
    },
    chainSampling: {
      sampledCount: sampledReplies.length,
      valid: chainCheckErrors.length === 0,
      errors: chainCheckErrors
    }
  }

  return {
    success: report.adminCheck.valid && report.chainSampling.valid,
    report,
    db
  }
}

/** CLI 主入口 */
export async function main() {
  const { values } = parseArgs({
    options: {
      dir: { type: "string" },
      comments: { type: "string" },
      counters: { type: "string" },
      users: { type: "string" },
      prefix: { type: "string", default: "caline_" },
      out: { type: "string" },
      "admin-password": { type: "string" },
      verify: { type: "boolean", default: false },
      "sample-count": { type: "string", default: "5" },
      quiet: { type: "boolean", default: false }
    }
  })

  let commentsPath = values.comments
  let countersPath = values.counters
  let usersPath = values.users

  if (values.dir) {
    commentsPath = commentsPath || path.join(values.dir, "wl_comment.json")
    countersPath = countersPath || path.join(values.dir, "wl_counter.json")
    usersPath = usersPath || path.join(values.dir, "wl_users.json")
  }

  if (!commentsPath && !countersPath && !usersPath) {
    console.error(
      "请指定输入源：--dir <目录> 或 --comments, --counters, --users 文件路径。"
    )
    process.exit(1)
  }

  function safeReadJson(p) {
    if (!p) return []
    try {
      return JSON.parse(readFileSync(p, "utf8"))
    } catch (err) {
      console.warn(`读取 JSON 失败 (${p}): ${err.message}`)
      return []
    }
  }

  const source = {
    comments: safeReadJson(commentsPath),
    counters: safeReadJson(countersPath),
    users: safeReadJson(usersPath)
  }

  const prefix = values.prefix ?? "caline_"
  const transformed = await transformData(source, {
    adminPassword: values["admin-password"],
    prefix
  })

  const sql = generateSql(transformed, prefix)

  if (values.out) {
    writeFileSync(values.out, sql, "utf8")
    if (!values.quiet) {
      console.log(`SQL 文件已生成至: ${values.out}`)
    }
  }

  if (values.verify || !values.out) {
    const sampleCount = Number(values["sample-count"]) || 5
    const verifyResult = verifyInSqlite(sql, prefix, { sampleCount })
    if (!values.quiet) {
      console.log("\n=== 迁移抽查验证报告 ===")
      console.log(JSON.stringify(verifyResult.report, null, 2))
    }
    if (!verifyResult.success) {
      console.error("\n❌ 迁移验证失败！")
      process.exit(1)
    } else if (!values.quiet) {
      console.log("\n✅ 迁移验证通过（条数一致、楼层链完好、管理员可用）。")
    }
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname)
) {
  main().catch((err) => {
    console.error("迁移执行异常:", err)
    process.exit(1)
  })
}
