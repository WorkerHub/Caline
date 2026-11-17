import { describe, expect, it } from "vitest"
import {
  findCommentById,
  insertComment,
  listCommentsByUrl
} from "../src/db/queries/comments"
import {
  getCounterByUrl,
  incrementPageview,
  upsertCounter
} from "../src/db/queries/counters"
import {
  findUserByEmail,
  insertRegisteredUser,
  updateUserFields
} from "../src/db/queries/users"
import { runLedgerMigrations } from "../src/lib/migrations-runner"
import { commentTable, counterTable, usersTable } from "../src/lib/tables"
import { SqliteD1 } from "./support/sqlite-d1"

function makeTestEnv(prefix: string) {
  const d1 = new SqliteD1()
  return {
    DB: d1 as unknown as D1Database,
    TABLE_PREFIX: prefix,
    sqlite: d1
  }
}

describe("数据模型（comment、counter 与 users 扩展列）", () => {
  it("默认前缀与自定义前缀下顺利完成建表与索引", async () => {
    for (const prefix of ["caline_", "custom_", ""]) {
      const env = makeTestEnv(prefix)
      const results = await runLedgerMigrations(env as never)
      expect(results[0]?.status).toBe("applied")

      // 验证表存在
      const tables = env.sqlite.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => (r as { name: string }).name)

      expect(tables).toContain(commentTable(prefix))
      expect(tables).toContain(counterTable(prefix))
      expect(tables).toContain(usersTable(prefix))

      // 验证索引存在
      const indexes = env.sqlite.db
        .prepare("SELECT name FROM sqlite_master WHERE type='index'")
        .all()
        .map((r) => (r as { name: string }).name)

      expect(indexes).toContain(`idx_${prefix}comment_url_status_created`)
      expect(indexes).toContain(`idx_${prefix}comment_status_created`)
      expect(indexes).toContain(`idx_${prefix}comment_rid`)
    }
  })

  it("users 扩展列（label, avatar, url, github_id）读写与更新正常", async () => {
    const env = makeTestEnv("caline_")
    await runLedgerMigrations(env as never)

    const user = await insertRegisteredUser(env.DB, "caline_", {
      email: "admin@example.com",
      passwordHash: "dummy:hash",
      language: "zh",
      approvalRequired: false,
      emailVerificationRequired: false
    })

    expect(user.label).toBe("")
    expect(user.avatar).toBe("")
    expect(user.url).toBe("")
    expect(user.github_id).toBeNull()

    await updateUserFields(env.DB, "caline_", user.id, {
      label: "站长",
      avatar: "https://example.com/avatar.png",
      url: "https://example.com",
      github_id: "gh-123456"
    })

    const updated = await findUserByEmail(
      env.DB,
      "caline_",
      "admin@example.com"
    )
    expect(updated).not.toBeNull()
    expect(updated?.label).toBe("站长")
    expect(updated?.avatar).toBe("https://example.com/avatar.png")
    expect(updated?.url).toBe("https://example.com")
    expect(updated?.github_id).toBe("gh-123456")
  })

  it("comment 表支持根评论与楼层回复（pid/rid）及置顶排序", async () => {
    const env = makeTestEnv("caline_")
    await runLedgerMigrations(env as never)

    // 1. 发根评论
    const root = await insertComment(env.DB, "caline_", {
      url: "/posts/first-post",
      nick: "Alice",
      mail: "alice@example.com",
      contentRaw: "第一条根评论",
      contentHtml: "<p>第一条根评论</p>",
      status: "approved"
    })
    expect(root.id).toBe(1)
    expect(root.pid).toBeNull()
    expect(root.rid).toBeNull()
    expect(root.sticky).toBe(0)

    // 2. 发子评论（回复根评论）
    const reply1 = await insertComment(env.DB, "caline_", {
      url: "/posts/first-post",
      nick: "Bob",
      mail: "bob@example.com",
      pid: root.id,
      rid: root.id,
      contentRaw: "回复 Alice",
      status: "approved"
    })
    expect(reply1.id).toBe(2)
    expect(reply1.pid).toBe(1)
    expect(reply1.rid).toBe(1)

    // 3. 发置顶评论
    const stickyRoot = await insertComment(env.DB, "caline_", {
      url: "/posts/first-post",
      nick: "Admin",
      contentRaw: "置顶公告",
      sticky: 1,
      status: "approved"
    })
    expect(stickyRoot.sticky).toBe(1)

    // 4. 按 URL 查列表：置顶排在最前
    const comments = await listCommentsByUrl(
      env.DB,
      "caline_",
      "/posts/first-post"
    )
    expect(comments.length).toBe(3)
    expect(comments[0]?.id).toBe(stickyRoot.id) // 置顶排第一
    expect(comments[1]?.id).toBe(root.id)
    expect(comments[2]?.id).toBe(reply1.id)

    // 5. 校验根据 id 单条读取
    const fetchedReply = await findCommentById(env.DB, "caline_", reply1.id)
    expect(fetchedReply?.nick).toBe("Bob")
    expect(fetchedReply?.pid).toBe(root.id)
  })

  it("counter 表支持页面浏览量与 reaction 计数及其原子递增", async () => {
    const env = makeTestEnv("caline_")
    await runLedgerMigrations(env as never)

    // 初始状态查不到
    const initial = await getCounterByUrl(
      env.DB,
      "caline_",
      "/articles/tech-scheme"
    )
    expect(initial).toBeNull()

    // 递增浏览量（首次创建并累加为 1）
    const c1 = await incrementPageview(
      env.DB,
      "caline_",
      "/articles/tech-scheme"
    )
    expect(c1.pageview).toBe(1)
    expect(c1.reaction0).toBe(0)

    // 再次递增浏览量
    const c2 = await incrementPageview(
      env.DB,
      "caline_",
      "/articles/tech-scheme"
    )
    expect(c2.pageview).toBe(2)

    // 更新 reaction
    const c3 = await upsertCounter(env.DB, "caline_", {
      url: "/articles/tech-scheme",
      pageview: c2.pageview,
      reaction0: 5,
      reaction1: 2
    })
    expect(c3.pageview).toBe(2)
    expect(c3.reaction0).toBe(5)
    expect(c3.reaction1).toBe(2)
    // 仅更新单个 reaction，已有 pageview 与其他 reaction 必须保留不归零
    const c4 = await upsertCounter(env.DB, "caline_", {
      url: "/articles/tech-scheme",
      reaction3: 7
    })
    expect(c4.pageview).toBe(2)
    expect(c4.reaction0).toBe(5)
    expect(c4.reaction1).toBe(2)
    expect(c4.reaction3).toBe(7)
  })
})
