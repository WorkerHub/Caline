import { describe, expect, it } from "vitest"
import { execSync } from "node:child_process"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
  generateSql,
  transformData,
  verifyInSqlite
} from "../../scripts/migrate-neon-to-d1.mjs"
import { verifyPassword } from "../src/core/auth"

const sampleNeonData = {
  users: [
    {
      objectId: "user_admin_01",
      email: "owner@example.com",
      nick: "博主本人",
      label: "Admin",
      avatar: "https://example.com/avatar.jpg",
      url: "https://example.com",
      password: "$P$B999fakephpasshash",
      type: "administrator",
      createdAt: "2024-01-01T08:00:00.000Z",
      updatedAt: "2024-01-01T08:00:00.000Z"
    },
    {
      objectId: "user_guest_02",
      type: "guest",
      createdAt: "2024-01-02T08:00:00.000Z"
    }
  ],
  comments: [
    {
      objectId: "cmt_root_1",
      url: "/posts/hello",
      user_id: "user_admin_01",
      nick: "博主本人",
      mail: "owner@example.com",
      comment: "# 欢迎留言\n这是置顶博主评论。",
      content_html: "<h1>欢迎留言</h1><p>这是置顶博主评论。</p>",
      sticky: true,
      like: 42,
      status: "approved",
      createdAt: "2024-01-01T09:00:00.000Z",
      updatedAt: "2024-01-01T09:00:00.000Z"
    },
    {
      objectId: "cmt_root_2",
      url: "/posts/hello",
      nick: "访客甲",
      mail: "visitor_a@example.com",
      link: "https://a.me",
      comment: "文章写得不错！",
      like: 3,
      status: "approved",
      createdAt: "2024-01-02T10:00:00.000Z",
      updatedAt: "2024-01-02T10:00:00.000Z"
    },
    {
      objectId: "cmt_reply_1",
      url: "/posts/hello",
      pid: "cmt_root_2",
      rid: "cmt_root_2",
      nick: "访客乙",
      mail: "visitor_b@example.com",
      comment: "同意一楼",
      status: "approved",
      createdAt: "2024-01-02T11:00:00.000Z",
      updatedAt: "2024-01-02T11:00:00.000Z"
    },
    {
      objectId: "cmt_reply_2",
      url: "/posts/hello",
      pid: "cmt_reply_1",
      rid: "cmt_root_2",
      nick: "博主本人",
      mail: "owner@example.com",
      comment: "感谢支持",
      status: "approved",
      createdAt: "2024-01-02T12:00:00.000Z",
      updatedAt: "2024-01-02T12:00:00.000Z"
    },
    {
      objectId: "cmt_reply_3",
      url: "/posts/hello",
      pid: "cmt_reply_2",
      // rid 缺失时能自动追溯至根节点 cmt_root_2
      nick: "访客丙",
      comment: "我也来凑热闹",
      status: "approved",
      createdAt: "2024-01-02T13:00:00.000Z",
      updatedAt: "2024-01-02T13:00:00.000Z"
    },
    {
      objectId: "cmt_orphan",
      url: "/posts/hello",
      pid: "cmt_missing_id",
      rid: "cmt_missing_id",
      nick: "孤儿评论",
      comment: "父评论已被原作者删除",
      status: "approved",
      createdAt: "2024-01-02T14:00:00.000Z",
      updatedAt: "2024-01-02T14:00:00.000Z"
    },
    {
      objectId: "cmt_spam",
      url: "/posts/hello",
      nick: "垃圾广告商",
      comment: "博彩网站...",
      status: "spam",
      createdAt: "2024-01-02T15:00:00.000Z",
      updatedAt: "2024-01-02T15:00:00.000Z"
    },
    {
      objectId: "cmt_waiting",
      url: "/posts/hello",
      nick: "新访客",
      comment: "待审核评论",
      status: "waiting",
      createdAt: "2024-01-02T16:00:00.000Z",
      updatedAt: "2024-01-02T16:00:00.000Z"
    }
  ],
  counters: [
    {
      url: "/posts/hello",
      time: 150,
      reaction0: 8,
      reaction1: 3,
      createdAt: "2024-01-01T08:00:00.000Z",
      updatedAt: "2024-01-02T16:00:00.000Z"
    },
    {
      url: "/posts/another",
      time: 88,
      reaction0: 1,
      createdAt: "2024-01-02T08:00:00.000Z",
      updatedAt: "2024-01-02T16:00:00.000Z"
    },
    // 重复 URL：聚合测试
    {
      url: "/posts/hello",
      time: 20,
      reaction0: 2,
      reaction2: 5,
      createdAt: "2024-01-01T08:00:00.000Z",
      updatedAt: "2024-01-03T10:00:00.000Z"
    }
  ]
}

describe("Neon -> D1 迁移与抽查验证脚本", () => {
  it("正确转换 Users 数据：排除 guest、密码不迁置空、must_change_password=1", async () => {
    const transformed = await transformData(sampleNeonData, {
      prefix: "caline_"
    })
    const user = transformed.adminUser

    expect(user).not.toBeNull()
    expect(user?.email).toBe("owner@example.com")
    expect(user?.display_name).toBe("博主本人")
    expect(user?.role).toBe("admin")
    expect(user?.status).toBe("active")
    expect(user?.email_verified).toBe(1)
    expect(user?.must_change_password).toBe(1)
    // 默认密码不迁入
    expect(user?.password_hash).toBe("")
    expect(user?.label).toBe("Admin")
  })

  it("支持 CLI --admin-password 设置新密码哈希", async () => {
    const transformed = await transformData(sampleNeonData, {
      adminPassword: "MyNewPassword123!"
    })
    const user = transformed.adminUser
    expect(user?.password_hash).not.toBe("")

    // 验证与 worker/src/core/auth.ts verifyPassword 兼容
    const isValid = await verifyPassword(
      "MyNewPassword123!",
      user!.password_hash
    )
    expect(isValid).toBe(true)

    const isWrong = await verifyPassword("WrongPassword", user!.password_hash)
    expect(isWrong).toBe(false)
  })

  it("正确转换 Comment 数据：重写 objectId、楼层 pid/rid 链、作者 user_id 与字段映射", async () => {
    const transformed = await transformData(sampleNeonData, {
      prefix: "caline_"
    })
    const comments = transformed.comments

    expect(comments.length).toBe(sampleNeonData.comments.length)

    // cmt_root_1 是第一条（按时间排序）
    const c1 = comments[0]!
    expect(c1.id).toBe(1)
    expect(c1.user_id).toBe(1) // 关联到管理员
    expect(c1.sticky).toBe(1)
    expect(c1.like_count).toBe(42)
    expect(c1.content_raw).toContain("欢迎留言")
    expect(c1.content_html).toContain("<h1>欢迎留言</h1>")
    expect(c1.pid).toBeNull()
    expect(c1.rid).toBeNull()

    // cmt_root_2 是第二条根评论
    const c2 = comments[1]!
    expect(c2.id).toBe(2)
    expect(c2.pid).toBeNull()
    expect(c2.rid).toBeNull()

    // cmt_reply_1 回复 cmt_root_2
    const c3 = comments[2]!
    expect(c3.id).toBe(3)
    expect(c3.pid).toBe(2)
    expect(c3.rid).toBe(2)

    // cmt_reply_2 回复 cmt_reply_1
    const c4 = comments[3]!
    expect(c4.id).toBe(4)
    expect(c4.pid).toBe(3)
    expect(c4.rid).toBe(2) // 根依然是 c2
    expect(c4.user_id).toBe(1) // 邮箱命中管理员

    // cmt_reply_3 回复 cmt_reply_2，原始 rid 为空，自动追溯到根 c2
    const c5 = comments[4]!
    expect(c5.id).toBe(5)
    expect(c5.pid).toBe(4)
    expect(c5.rid).toBe(2)

    // cmt_orphan 指向不存在的 parent，重置为 NULL
    const c6 = comments[5]!
    expect(c6.pid).toBeNull()
    expect(c6.rid).toBeNull()

    // 状态规整
    const c7 = comments[6]!
    expect(c7.status).toBe("spam")
    const c8 = comments[7]!
    expect(c8.status).toBe("waiting")
  })

  it("正确转换 Counter 数据：time 映射为 pageview 并对重复 URL 聚合", async () => {
    const transformed = await transformData(sampleNeonData, {
      prefix: "caline_"
    })
    const counters = transformed.counters

    // 原始 3 条，其中 /posts/hello 重复，应合并为 2 条
    expect(counters.length).toBe(2)

    const hello = counters.find((c) => c.url === "/posts/hello")!
    expect(hello).toBeDefined()
    // time 150 + 20 = 170
    expect(hello.pageview).toBe(170)
    // reaction0 8 + 2 = 10
    expect(hello.reaction0).toBe(10)
    expect(hello.reaction1).toBe(3)
    expect(hello.reaction2).toBe(5)
  })

  it("generateSql 生成符合 D1/SQLite 标准的 INSERT 语句并支持三态前缀", async () => {
    for (const prefix of ["caline_", "custom_", ""]) {
      const transformed = await transformData(sampleNeonData, { prefix })
      const sql = generateSql(transformed, prefix)

      expect(sql).toContain(`INSERT INTO ${prefix}users`)
      expect(sql).toContain(`INSERT INTO ${prefix}comment`)
      expect(sql).toContain(`INSERT INTO ${prefix}counter`)

      // 验证在内存 SQLite 下执行与抽查完全通过
      const verifyResult = verifyInSqlite(sql, prefix, { sampleCount: 5 })
      expect(verifyResult.success).toBe(true)
      expect(verifyResult.report.adminCheck.valid).toBe(true)
      expect(verifyResult.report.chainSampling.valid).toBe(true)
      expect(verifyResult.report.counts.users).toBe(1)
      expect(verifyResult.report.counts.comments).toBe(
        sampleNeonData.comments.length
      )
      expect(verifyResult.report.counts.counters).toBe(2)
    }
  })

  it("CLI 端到端测试：写入 JSON 文件并执行 migrate-neon-to-d1.mjs --verify", () => {
    const tmpDir = path.resolve(import.meta.dirname, "../.tmp-migration-test")
    rmSync(tmpDir, { recursive: true, force: true })
    execSync(`mkdir -p ${tmpDir}`)

    const commentsFile = path.join(tmpDir, "wl_comment.json")
    const countersFile = path.join(tmpDir, "wl_counter.json")
    const usersFile = path.join(tmpDir, "wl_users.json")
    const outFile = path.join(tmpDir, "out.sql")

    writeFileSync(commentsFile, JSON.stringify(sampleNeonData.comments))
    writeFileSync(countersFile, JSON.stringify(sampleNeonData.counters))
    writeFileSync(usersFile, JSON.stringify(sampleNeonData.users))

    const scriptPath = path.resolve(
      import.meta.dirname,
      "../../scripts/migrate-neon-to-d1.mjs"
    )
    const cmd = `node ${scriptPath} --dir ${tmpDir} --prefix caline_ --out ${outFile} --verify`
    const output = execSync(cmd, { encoding: "utf8" })

    expect(output).toContain("迁移抽查验证报告")
    expect(output).toContain("迁移验证通过")

    const sqlContent = readFileSync(outFile, "utf8")
    expect(sqlContent).toContain("INSERT INTO caline_users")
    expect(sqlContent).toContain("INSERT INTO caline_comment")
    expect(sqlContent).toContain("INSERT INTO caline_counter")

    rmSync(tmpDir, { recursive: true, force: true })
  })
})
