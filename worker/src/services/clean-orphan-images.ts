/**
 * 孤儿图定时清理服务（按基座现行定时机制 / waker 口径）。
 *
 * 规格约束：
 * - 范围：仅 IMAGES 存储桶中日期路径（YYYY/MM/DD/…）的上传图；avatars/ 前缀排除；
 * - 判定：对象 key 未出现在任何现存评论的 content_raw/content_html 中，且对象年龄 > 7 天 → 删除候选；
 * - 默认 dry-run 模式：只统计候选数量与总大小、记日志，不删；真删开启走单独关口确认，不在本单内自动开启；
 * - 复用 D1 抢占幂等防双跑（按每日窗口）。
 */
import { consumeCounter, ensureCountersTable } from "../core/counters"
import { isImageReferencedInComments } from "../db/queries/comments"
import { getTablePrefix } from "../lib/table-prefix"
import type { Env } from "../types"
import type { ScheduledTrigger } from "./scheduled-task"

export const ORPHAN_IMAGES_TASK_NAME = "clean-orphan-images"

/** 每日抢占窗口（秒）：23 小时防时钟抖动与双跑 */
export const ORPHAN_CLEANUP_CLAIM_WINDOW_SECONDS = 23 * 60 * 60

/** 孤儿图判定最小年龄（毫秒）：7 天（7 * 24 * 60 * 60 * 1000） */
export const ORPHAN_IMAGE_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** 日期路径正则：YYYY/MM/DD/... */
export const DATE_PATH_IMAGE_REGEX = /^\d{4}\/\d{2}\/\d{2}\/.+/

export interface CleanOrphanImagesOptions {
  trigger?: ScheduledTrigger
  now?: number
  dryRun?: boolean
  claimWindowSeconds?: number
  minAgeMs?: number
}

export interface CleanOrphanImagesResult {
  ran: boolean
  reason?: "already-claimed" | "images_not_configured" | "db_error"
  dryRun: boolean
  scannedCount: number
  candidateCount: number
  candidateTotalBytes: number
  candidateKeys: string[]
  deletedCount: number
}

/**
 * 判断对象 key 是否属于候选清理范围：
 * 属于日期路径 YYYY/MM/DD/... 且排除 avatars/ 前缀与包含非法相对路径 ".."。
 */
export function isCandidateImageKey(key: string): boolean {
  if (typeof key !== "string" || !key) return false
  if (key.startsWith("avatars/")) return false
  if (key.includes("..")) return false
  return DATE_PATH_IMAGE_REGEX.test(key)
}

/**
 * 判断对象年龄是否大于阈值（默认 7 天）。
 */
export function isImageOlderThanThreshold(
  uploadedAt: Date | undefined | null,
  nowMs: number,
  thresholdMs: number = ORPHAN_IMAGE_MIN_AGE_MS
): boolean {
  if (
    !uploadedAt ||
    !(uploadedAt instanceof Date) ||
    Number.isNaN(uploadedAt.getTime())
  ) {
    return false
  }
  return nowMs - uploadedAt.getTime() > thresholdMs
}

/**
 * 孤儿图清理核心方法。
 */
export async function cleanOrphanImages(
  env: Env,
  options?: CleanOrphanImagesOptions
): Promise<CleanOrphanImagesResult> {
  const now = options?.now ?? Math.floor(Date.now() / 1000)
  const nowMs = now * 1000
  const trigger = options?.trigger ?? "cron"
  const dryRun = options?.dryRun ?? true
  const minAgeMs = options?.minAgeMs ?? ORPHAN_IMAGE_MIN_AGE_MS

  const emptyResult = (
    ran: boolean,
    reason?: CleanOrphanImagesResult["reason"]
  ): CleanOrphanImagesResult => ({
    ran,
    reason,
    dryRun,
    scannedCount: 0,
    candidateCount: 0,
    candidateTotalBytes: 0,
    candidateKeys: [],
    deletedCount: 0
  })

  // 1. D1 计数表抢占幂等防双跑（按每日窗口）
  const prefix = getTablePrefix(env)
  try {
    await ensureCountersTable(env.DB, prefix)
  } catch (err) {
    console.warn(
      `scheduled: ${ORPHAN_IMAGES_TASK_NAME} 确保计数表失败，安全中止:`,
      err instanceof Error ? err.message : String(err)
    )
    return emptyResult(false, "db_error")
  }

  const claimWindow =
    options?.claimWindowSeconds ?? ORPHAN_CLEANUP_CLAIM_WINDOW_SECONDS

  const claim = await consumeCounter(
    env.DB,
    prefix,
    {
      action: "scheduled_tick",
      account: ORPHAN_IMAGES_TASK_NAME,
      windowSeconds: claimWindow
    },
    now
  )

  if (claim.count > 1) {
    console.info(
      `scheduled: ${ORPHAN_IMAGES_TASK_NAME} 本轮已被另一入口执行（trigger=${trigger}）`
    )
    return emptyResult(false, "already-claimed")
  }

  // 2. 检查 IMAGES 存储桶配置
  if (!env.IMAGES) {
    console.info(
      `scheduled: ${ORPHAN_IMAGES_TASK_NAME} IMAGES 存储桶未配置，跳过清理（trigger=${trigger}）`
    )
    return emptyResult(false, "images_not_configured")
  }

  // 3. 扫描 IMAGES 桶中日期路径且年龄 > 7 天的对象
  let scannedCount = 0
  const candidateObjects: Array<{ key: string; size: number }> = []

  try {
    let cursor: string | undefined
    do {
      const listResult = await env.IMAGES.list({ cursor, limit: 1000 })
      for (const obj of listResult.objects) {
        scannedCount++
        if (!isCandidateImageKey(obj.key)) {
          continue
        }
        if (!isImageOlderThanThreshold(obj.uploaded, nowMs, minAgeMs)) {
          continue
        }
        candidateObjects.push({ key: obj.key, size: obj.size })
      }
      cursor = listResult.truncated ? listResult.cursor : undefined
    } while (cursor)
  } catch (err) {
    console.error(
      `scheduled: ${ORPHAN_IMAGES_TASK_NAME} 扫描存储桶失败:`,
      err instanceof Error ? err.message : String(err)
    )
    return emptyResult(false, "images_not_configured")
  }

  // 4. 判定现存评论是否引用（content_raw / content_html）
  const orphanCandidates: Array<{ key: string; size: number }> = []
  try {
    for (const candidate of candidateObjects) {
      const referenced = await isImageReferencedInComments(
        env.DB,
        prefix,
        candidate.key
      )
      if (!referenced) {
        orphanCandidates.push(candidate)
      }
    }
  } catch (err) {
    console.warn(
      `scheduled: ${ORPHAN_IMAGES_TASK_NAME} 检查评论引用异常（可能表未初始化），安全中止:`,
      err instanceof Error ? err.message : String(err)
    )
    return emptyResult(false, "db_error")
  }

  const candidateCount = orphanCandidates.length
  const candidateTotalBytes = orphanCandidates.reduce(
    (acc, item) => acc + item.size,
    0
  )
  const candidateKeys = orphanCandidates.map((item) => item.key)

  // 5. 执行或 dry-run 统计
  let deletedCount = 0
  if (dryRun) {
    console.info(
      `scheduled: ${ORPHAN_IMAGES_TASK_NAME} dry-run 统计完成（trigger=${trigger}）：扫描 ${scannedCount} 个对象，命中 ${candidateCount} 个孤儿图候选（共 ${candidateTotalBytes} 字节），不执行删除`
    )
  } else {
    if (candidateKeys.length > 0) {
      for (let i = 0; i < candidateKeys.length; i += 1000) {
        const batch = candidateKeys.slice(i, i + 1000)
        await env.IMAGES.delete(batch)
      }
    }
    deletedCount = candidateKeys.length
    console.info(
      `scheduled: ${ORPHAN_IMAGES_TASK_NAME} 清理执行完成（trigger=${trigger}）：扫描 ${scannedCount} 个对象，删除 ${deletedCount} 个孤儿图（共 ${candidateTotalBytes} 字节）`
    )
  }

  return {
    ran: true,
    dryRun,
    scannedCount,
    candidateCount,
    candidateTotalBytes,
    candidateKeys,
    deletedCount
  }
}
