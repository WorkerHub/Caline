/**
 * 定时任务调度中心（规格 §5.5A、§8）：
 * 两个入口（原生 Cron 与 waker 回调）共用这一份实现。
 *
 * 注册任务：
 * 1. `noop-log-tick`：示例写日志任务，1 小时窗口 D1 抢占；
 * 2. `clean-orphan-images`：孤儿图清理任务，23 小时窗口 D1 抢占，默认 dry-run。
 */
import { consumeCounter, ensureCountersTable } from "../core/counters"
import { getTablePrefix } from "../lib/table-prefix"
import type { Env } from "../types"
import {
  cleanOrphanImages,
  ORPHAN_IMAGES_TASK_NAME,
  type CleanOrphanImagesResult
} from "./clean-orphan-images"

export {
  cleanOrphanImages,
  ORPHAN_IMAGES_TASK_NAME,
  type CleanOrphanImagesResult
}

/** 示例任务名：waker 侧注册也用这个 key。 */
export const SCHEDULED_TASK_NAME = "noop-log-tick"

/** 注册的任务名列表。 */
export const REGISTERED_SCHEDULED_JOBS = [
  SCHEDULED_TASK_NAME,
  ORPHAN_IMAGES_TASK_NAME
] as const

export type RegisteredJobName = (typeof REGISTERED_SCHEDULED_JOBS)[number]

/** 抢占窗口（秒）：一小时内只有第一个入口真正执行。 */
const CLAIM_WINDOW_SECONDS = 60 * 60

export type ScheduledTrigger = "cron" | "waker"

export interface ScheduledTaskOutcome {
  ran: boolean
  /** 没跑的原因，便于回调响应与日志排查。 */
  reason?: "already-claimed" | "images_not_configured" | "db_error"
  dryRun?: boolean
  scannedCount?: number
  candidateCount?: number
  candidateTotalBytes?: number
  candidateKeys?: string[]
  deletedCount?: number
  details?: unknown
}

/**
 * 执行 no-op 示例任务（幂等）：先用计数表抢占本轮，抢到才执行。
 */
export async function runNoopTask(
  env: Env,
  options: { trigger: ScheduledTrigger; now?: number }
): Promise<ScheduledTaskOutcome> {
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const prefix = getTablePrefix(env)
  await ensureCountersTable(env.DB, prefix)

  const claim = await consumeCounter(
    env.DB,
    prefix,
    {
      action: "scheduled_tick",
      account: SCHEDULED_TASK_NAME,
      windowSeconds: CLAIM_WINDOW_SECONDS
    },
    now
  )

  if (claim.count > 1) {
    console.info(
      `scheduled: ${SCHEDULED_TASK_NAME} 本轮已被另一入口执行（trigger=${options.trigger}）`
    )
    return { ran: false, reason: "already-claimed" }
  }

  console.info(
    `scheduled: ${SCHEDULED_TASK_NAME} 执行（trigger=${options.trigger}, at=${new Date(
      now * 1000
    ).toISOString()}）`
  )
  return { ran: true }
}

/**
 * 跑一轮定时任务（幂等）：
 * - 若指定 jobName 则派发执行指定任务；
 * - 若未指定 jobName（如原生 Cron 触发），则依次执行全部已注册的定时任务。
 */
export async function runScheduledTask(
  env: Env,
  options: {
    trigger: ScheduledTrigger
    jobName?: string
    now?: number
    dryRun?: boolean
  }
): Promise<ScheduledTaskOutcome> {
  const jobName = options.jobName
  if (jobName === ORPHAN_IMAGES_TASK_NAME) {
    return cleanOrphanImages(env, {
      trigger: options.trigger,
      now: options.now,
      dryRun: options.dryRun
    })
  }
  if (jobName === SCHEDULED_TASK_NAME) {
    return runNoopTask(env, options)
  }

  // 原生 Cron 触发：按序执行已注册任务
  const noopOutcome = await runNoopTask(env, options)
  const orphanOutcome = await cleanOrphanImages(env, {
    trigger: options.trigger,
    now: options.now,
    dryRun: options.dryRun
  })

  return {
    ran: noopOutcome.ran || orphanOutcome.ran,
    reason:
      !noopOutcome.ran && !orphanOutcome.ran ? "already-claimed" : undefined,
    details: {
      [SCHEDULED_TASK_NAME]: noopOutcome,
      [ORPHAN_IMAGES_TASK_NAME]: orphanOutcome
    }
  }
}
