import { describe, expect, it } from "vitest"
import worker from "../src/index"
import { insertComment } from "../src/db/queries/comments"
import { countersTable } from "../src/lib/tables"
import {
  cleanOrphanImages,
  isCandidateImageKey,
  isImageOlderThanThreshold,
  ORPHAN_IMAGES_TASK_NAME
} from "../src/services/clean-orphan-images"
import { isImageReferencedInComments } from "../src/db/queries/comments"
import type { Env } from "../src/types"
import {
  activePrefix,
  initializedContext,
  makeContext,
  request
} from "./support/app"

const WAKER_KEY = "waker-signing-key-for-orphan-tests"

async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message)
  )
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

async function triggerWakerJob(
  env: Env,
  jobName: string,
  options: { secret?: string; timestamp?: number } = {}
): Promise<Response> {
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000))
  const executionId = crypto.randomUUID()
  const jobId = "job-orphan-clean"
  const body = JSON.stringify({
    protocolVersion: 2,
    executionId,
    jobId,
    jobName,
    payload: null
  })
  const signature = await hmacHex(
    options.secret ?? WAKER_KEY,
    `${timestamp}\n${executionId}\n${jobId}\n${body}`
  )
  return request(env, "/_waker/execute", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-waker-timestamp": timestamp,
      "x-waker-execution-id": executionId,
      "x-waker-job-id": jobId,
      "x-waker-signature": `v2=${signature}`
    },
    body
  })
}

describe("孤儿图清理：辅助判定函数", () => {
  it("isCandidateImageKey：仅日期路径 YYYY/MM/DD/... 为候选，排除 avatars/ 与非法路径", () => {
    expect(isCandidateImageKey("2026/11/23/uuid123.png")).toBe(true)
    expect(isCandidateImageKey("2025/01/01/test.jpg")).toBe(true)
    expect(isCandidateImageKey("2024/12/31/sub/nested.webp")).toBe(true)

    // avatars/ 前缀排除
    expect(isCandidateImageKey("avatars/42/pic.png")).toBe(false)
    expect(isCandidateImageKey("avatars/2026/11/23/pic.png")).toBe(false)

    // 非日期路径排除
    expect(isCandidateImageKey("custom/image.png")).toBe(false)
    expect(isCandidateImageKey("2026/11/uuid.png")).toBe(false)
    expect(isCandidateImageKey("2026/11/23/")).toBe(false)
    expect(isCandidateImageKey("2026-11-23/uuid.png")).toBe(false)

    // 包含 .. 排除
    expect(isCandidateImageKey("2026/11/23/../uuid.png")).toBe(false)
    expect(isCandidateImageKey("")).toBe(false)
  })

  it("isImageOlderThanThreshold：对象年龄 > 7 天才判定为候选", () => {
    const nowMs = 1700000000000
    const eightDaysAgo = new Date(nowMs - 8 * 24 * 60 * 60 * 1000)
    const sevenDaysAndOneSecAgo = new Date(
      nowMs - (7 * 24 * 60 * 60 * 1000 + 1000)
    )
    const exactlySevenDaysAgo = new Date(nowMs - 7 * 24 * 60 * 60 * 1000)
    const sixDaysAgo = new Date(nowMs - 6 * 24 * 60 * 60 * 1000)

    expect(isImageOlderThanThreshold(eightDaysAgo, nowMs)).toBe(true)
    expect(isImageOlderThanThreshold(sevenDaysAndOneSecAgo, nowMs)).toBe(true)
    expect(isImageOlderThanThreshold(exactlySevenDaysAgo, nowMs)).toBe(false)
    expect(isImageOlderThanThreshold(sixDaysAgo, nowMs)).toBe(false)
    expect(isImageOlderThanThreshold(undefined, nowMs)).toBe(false)
    expect(isImageOlderThanThreshold(new Date("invalid"), nowMs)).toBe(false)
  })
})

describe("孤儿图清理：评论引用检测 isImageReferencedInComments", () => {
  it("当 key 出现在 content_raw 或 content_html 中时判定为已引用", async () => {
    const { env } = await initializedContext()
    const prefix = activePrefix(env)

    const keyRaw = "2026/11/10/pic-raw.png"
    const keyHtml = "2026/11/10/pic-html.png"
    const keyUnused = "2026/11/10/pic-unused.png"

    // 1. 引用在 content_raw
    await insertComment(env.DB, prefix, {
      url: "/post/1",
      contentRaw: `这里有一张图 ![](/img/${keyRaw}) 测试`,
      contentHtml: "<p>这里有一张图 测试</p>"
    })

    // 2. 引用在 content_html
    await insertComment(env.DB, prefix, {
      url: "/post/2",
      contentRaw: "纯文字评论",
      contentHtml: `<p><img src="/img/${keyHtml}" alt="alt" /></p>`
    })

    expect(await isImageReferencedInComments(env.DB, prefix, keyRaw)).toBe(true)
    expect(await isImageReferencedInComments(env.DB, prefix, keyHtml)).toBe(
      true
    )
    expect(await isImageReferencedInComments(env.DB, prefix, keyUnused)).toBe(
      false
    )
  })

  it("支持带下划线等字符的 key 精确字面量子串匹配", async () => {
    const { env } = await initializedContext()
    const prefix = activePrefix(env)

    const keyUnder = "2026/11/10/uuid_with_underscore.png"
    const keyDash = "2026/11/10/uuid-with-underscore.png"

    await insertComment(env.DB, prefix, {
      url: "/post/dash",
      contentRaw: `图片链接：/img/${keyDash}`,
      contentHtml: `<p>/img/${keyDash}</p>`
    })

    // keyDash 在库中，keyUnder 不在
    expect(await isImageReferencedInComments(env.DB, prefix, keyDash)).toBe(
      true
    )
    expect(await isImageReferencedInComments(env.DB, prefix, keyUnder)).toBe(
      false
    )
  })
})

describe("孤儿图清理：cleanOrphanImages 核心流程", () => {
  it("默认 dry-run 模式：只统计候选数量与总大小、记日志、不删除", async () => {
    const { env, images } = await initializedContext()
    const prefix = activePrefix(env)

    const nowSec = 1732360000
    const nowMs = nowSec * 1000

    // 准备存储桶中的对象：
    // 1. 孤儿图 1（年龄 10 天，未引用）-> 候选
    const orphanKey1 = "2026/11/13/orphan-1.png"
    const orphanObj1 = await images.put(orphanKey1, "orphan-content-1", {
      uploaded: new Date(nowMs - 10 * 24 * 60 * 60 * 1000)
    } as any)

    // 2. 孤儿图 2（年龄 15 天，未引用）-> 候选
    const orphanKey2 = "2026/11/08/orphan-2.jpg"
    const orphanObj2 = await images.put(orphanKey2, "orphan-content-22", {
      uploaded: new Date(nowMs - 15 * 24 * 60 * 60 * 1000)
    } as any)

    // 3. 正常图（年龄 10 天，已在评论中引用）-> 排除
    const referencedKey = "2026/11/13/referenced.png"
    await images.put(referencedKey, "referenced-content", {
      uploaded: new Date(nowMs - 10 * 24 * 60 * 60 * 1000)
    } as any)
    await insertComment(env.DB, prefix, {
      url: "/test-page",
      contentRaw: `看图：![](/img/${referencedKey})`,
      contentHtml: `<img src="/img/${referencedKey}">`
    })

    // 4. 新上传图（年龄 2 天，未引用）-> 排除（<= 7 天）
    const recentKey = "2026/11/21/recent.png"
    await images.put(recentKey, "recent-content", {
      uploaded: new Date(nowMs - 2 * 24 * 60 * 60 * 1000)
    } as any)

    // 5. 头像图（年龄 10 天，未引用）-> 排除（avatars/ 前缀）
    const avatarKey = "avatars/101/avatar.png"
    await images.put(avatarKey, "avatar-content", {
      uploaded: new Date(nowMs - 10 * 24 * 60 * 60 * 1000)
    } as any)

    // 6. 非日期路径图（年龄 10 天，未引用）-> 排除
    const otherKey = "misc/banner.png"
    await images.put(otherKey, "other-content", {
      uploaded: new Date(nowMs - 10 * 24 * 60 * 60 * 1000)
    } as any)

    // 跑默认 dry-run 清理
    const result = await cleanOrphanImages(env, {
      trigger: "cron",
      now: nowSec
    })

    expect(result.ran).toBe(true)
    expect(result.dryRun).toBe(true)
    expect(result.scannedCount).toBe(6)
    expect(result.candidateCount).toBe(2)
    expect(result.candidateKeys).toContain(orphanKey1)
    expect(result.candidateKeys).toContain(orphanKey2)
    expect(result.candidateTotalBytes).toBe(orphanObj1.size + orphanObj2.size)
    expect(result.deletedCount).toBe(0)

    // 核心断言：dry-run 绝不删除对象
    expect(await images.get(orphanKey1)).not.toBeNull()
    expect(await images.get(orphanKey2)).not.toBeNull()
    expect(await images.get(referencedKey)).not.toBeNull()
    expect(await images.get(recentKey)).not.toBeNull()
    expect(await images.get(avatarKey)).not.toBeNull()
    expect(await images.get(otherKey)).not.toBeNull()
  })

  it("真删模式（dryRun: false）：仅删除孤儿候选图，其余保留", async () => {
    const { env, images } = await initializedContext()
    const prefix = activePrefix(env)

    const nowSec = 1732360000
    const nowMs = nowSec * 1000

    const orphanKey = "2026/11/10/orphan-del.png"
    await images.put(orphanKey, "delete-me", {
      uploaded: new Date(nowMs - 10 * 24 * 60 * 60 * 1000)
    } as any)

    const referencedKey = "2026/11/10/ref-keep.png"
    await images.put(referencedKey, "keep-me", {
      uploaded: new Date(nowMs - 10 * 24 * 60 * 60 * 1000)
    } as any)
    await insertComment(env.DB, prefix, {
      url: "/article",
      contentRaw: `引用了 /img/${referencedKey}`,
      contentHtml: `<p>/img/${referencedKey}</p>`
    })

    const recentKey = "2026/11/22/recent-keep.png"
    await images.put(recentKey, "recent", {
      uploaded: new Date(nowMs - 1 * 24 * 60 * 60 * 1000)
    } as any)

    const result = await cleanOrphanImages(env, {
      trigger: "manual" as any,
      now: nowSec,
      dryRun: false
    })

    expect(result.ran).toBe(true)
    expect(result.dryRun).toBe(false)
    expect(result.candidateCount).toBe(1)
    expect(result.deletedCount).toBe(1)
    expect(result.candidateKeys).toEqual([orphanKey])

    // 孤儿图已删除
    expect(await images.get(orphanKey)).toBeNull()
    // 正常引用的图与新上传图完好保留
    expect(await images.get(referencedKey)).not.toBeNull()
    expect(await images.get(recentKey)).not.toBeNull()
  })

  it("D1 抢占幂等：同一每日窗口内只执行一次，第二次返回 already-claimed", async () => {
    const { env } = await initializedContext()
    const nowSec = 1732360000

    const first = await cleanOrphanImages(env, { now: nowSec })
    expect(first.ran).toBe(true)

    const second = await cleanOrphanImages(env, { now: nowSec + 3600 })
    expect(second.ran).toBe(false)
    expect(second.reason).toBe("already-claimed")

    // 推进 24 小时后（超过 23 小时窗口），新一轮可正常抢占执行
    const nextDay = await cleanOrphanImages(env, { now: nowSec + 24 * 3600 })
    expect(nextDay.ran).toBe(true)
  })

  it("异常容错：存储桶未配置或数据库未初始化时不崩溃并安全返回", async () => {
    // 1. 无 IMAGES 存储桶
    const { env: noStorageEnv } = await initializedContext({
      IMAGES: undefined
    })
    const noStorageResult = await cleanOrphanImages(noStorageEnv)
    expect(noStorageResult.ran).toBe(false)
    expect(noStorageResult.reason).toBe("images_not_configured")

    // 2. 数据库未初始化（有候选图待查但无 comment 表）
    const { env: uninitEnv, images } = makeContext()
    const nowMs = Date.now()
    await images.put("2026/11/10/uninit-candidate.png", "data", {
      uploaded: new Date(nowMs - 10 * 24 * 60 * 60 * 1000)
    } as any)
    const uninitResult = await cleanOrphanImages(uninitEnv)
    expect(uninitResult.ran).toBe(false)
    expect(uninitResult.reason).toBe("db_error")
  })
})

describe("定时任务调度集成：waker 与原生 scheduled()", () => {
  it("waker 回调支持通过 jobName='clean-orphan-images' 触发孤儿图清理", async () => {
    const { env, images } = await initializedContext({
      WAKER_SIGNING_KEY: WAKER_KEY
    })

    const orphanKey = "2026/11/10/waker-orphan.png"
    await images.put(orphanKey, "waker-content", {
      uploaded: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    } as any)

    const res = await triggerWakerJob(env, ORPHAN_IMAGES_TASK_NAME)
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)
    expect(body.ran).toBe(true)
    expect(body.dryRun).toBe(true)
    expect(body.candidateCount).toBe(1)
    expect(body.candidateKeys).toContain(orphanKey)

    // 重复调用受 D1 抢占保护
    const repeatRes = await triggerWakerJob(env, ORPHAN_IMAGES_TASK_NAME)
    expect(repeatRes.status).toBe(200)
    const repeatBody = (await repeatRes.json()) as any
    expect(repeatBody.ok).toBe(true)
    expect(repeatBody.ran).toBe(false)
    expect(repeatBody.reason).toBe("already-claimed")
  })

  it("原生 scheduled() 执行时会触发孤儿图清理并记录抢占计数", async () => {
    const { env, db } = await initializedContext()
    await worker.scheduled({} as never, env, {} as never)

    const row = db.db
      .prepare(
        `SELECT count FROM ${countersTable(activePrefix(env))} WHERE action = 'scheduled_tick' AND account = ?`
      )
      .get(ORPHAN_IMAGES_TASK_NAME) as { count: number } | undefined

    expect(row?.count).toBe(1)
  })
})
