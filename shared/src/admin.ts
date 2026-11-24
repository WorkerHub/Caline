/**
 * 后台管理接口契约（规格 §4、§5、§6、§8、§11）。
 * 必须具有 administrator 权限。
 */

import type { UserAccountStatus, UserRole } from "./auth"
import type { CommentStatus } from "./comments"

/** 后台评论列表项（含访客真实邮箱、IP 与 UA） */
export interface CommentAdminItem {
  id: number
  userId: number | null
  nick: string
  mail: string
  link: string
  url: string
  pid: number | null
  rid: number | null
  contentRaw: string
  contentHtml: string
  status: CommentStatus
  sticky: boolean
  likeCount: number
  ip: string
  ua: string
  createdAt: string
  updatedAt: string
}

/** GET /api/admin/comments 查询参数 */
export interface AdminListCommentsQuery {
  status?: "all" | CommentStatus
  q?: string
  page?: number
  pageSize?: number
}

/** GET /api/admin/comments 响应 data 形状 */
export interface AdminListCommentsResult {
  items: CommentAdminItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/** PATCH /api/admin/comments/:id 请求体（改 status / sticky / 正文） */
export interface AdminUpdateCommentInput {
  status?: CommentStatus
  sticky?: boolean
  content?: string
}

/** DELETE /api/admin/comments/:id 响应 data 形状（含级联删除统计） */
export interface AdminDeleteCommentResult {
  success: true
  deletedId: number
  /** 删除的总条数（被删评论自身 + 被连坐删除的回复子树） */
  deletedCount: number
  /** 被删除的所有评论 ID 列表 */
  deletedIds: number[]
}

/** POST /api/admin/comments/batch 请求体（批量改 status / 删除） */
export interface AdminCommentBatchInput {
  ids: number[]
  action: "approve" | "spam" | "waiting" | "delete"
}

/** POST /api/admin/comments/batch 响应 data 形状 */
export interface AdminCommentBatchResult {
  success: true
  affectedCount: number
}

/** GET /api/admin/users 用户项 */
export interface AdminUserItem {
  id: number
  email: string
  displayName: string
  role: UserRole
  status: UserAccountStatus
  emailVerified: boolean
  createdAt: string
  label?: string
  avatar?: string
  url?: string
}

/** PATCH /api/admin/users/:id 请求体（修改角色与标签） */
export interface AdminUpdateUserInput {
  role?: UserRole
  label?: string
  status?: UserAccountStatus
}

/** 访客发表总开关（三态） */
export type GuestCommentMode = "open" | "login_only" | "closed"

/** Caline 站点级核心设置（规格 §5、§6、§8） */
export interface CalineSiteSettings {
  /** 审核总开关：开启时全部 waiting、优先于信任分级 */
  auditSwitch: boolean
  /** 访客总开关：开放访客 / 仅登录 / 全站关闭发表 */
  guestMode: GuestCommentMode
  /** 保留昵称列表（管理员昵称 + 自定义保留词） */
  reservedNicks: string[]
  /** 违禁词列表（命中直接标 spam） */
  disallowedWords: string[]
  /** IP 黑名单（命中直接 403） */
  ipBlacklist: string[]
  /** 正文最大字数（默认 1000） */
  maxContentLength: number
  /** IP 限频间隔（秒，默认 60，0 为关闭） */
  ipRateLimitSeconds: number
  /** 等级阈值列表（按 mail 累计 approved 数分级，为空表示关闭） */
  levelThresholds: number[]
  /** Gravatar 镜像基地址（如 https://cravatar.cn/avatar/） */
  gravatarMirror: string
  /** 安全域名列表（Origin/Referer 白名单） */
  safeDomains: string[]
  /** Turnstile 验证码开关 */
  turnstileEnabled: boolean
  /** Turnstile Site Key（前端展示用） */
  turnstileSiteKey: string
  /** Turnstile Secret Key 是否已配置（脱敏布尔值） */
  turnstileSecretKeySet: boolean
  /** eNotify 管理员通知开关 */
  enotifyEnabled: boolean
  /** eNotify Key 是否已配置（脱敏布尔值） */
  enotifyKeySet: boolean
  /** 孤儿图片定期清理开关（默认 false：关为 dry-run 只统计，开为真删） */
  orphanCleanupEnabled: boolean
}

/** PUT /api/admin/settings 请求中 site 字段的更新入参 */
export interface CalineSiteSettingsPatch {
  auditSwitch?: boolean
  guestMode?: GuestCommentMode
  reservedNicks?: string[]
  disallowedWords?: string[]
  ipBlacklist?: string[]
  maxContentLength?: number
  ipRateLimitSeconds?: number
  levelThresholds?: number[]
  gravatarMirror?: string
  safeDomains?: string[]
  turnstileEnabled?: boolean
  turnstileSiteKey?: string
  /** 写入新 Turnstile Secret Key；留空表示不改动已存密钥 */
  turnstileSecretKey?: string
  enotifyEnabled?: boolean
  /** 写入新 eNotify Key；留空表示不改动已存密钥 */
  enotifyKey?: string
  orphanCleanupEnabled?: boolean
}

/** 三表 JSON 导出格式中的单行数据（规格 §11，严格脱敏 password_hash 等机密） */
export interface ExportCommentRow {
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

export interface ExportCounterRow {
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

export interface ExportUserRow {
  id: number
  email: string
  role: string
  status: string
  email_verified: number
  language: string
  display_name: string
  timezone: string
  created_at: string
  updated_at: string
  label: string
  avatar: string
  url: string
  github_id: string | null
}

/** GET /api/admin/export 返回的三表 JSON 整体结构 */
export interface CalineDataDump {
  version: string
  exportedAt: string
  comments: ExportCommentRow[]
  counters: ExportCounterRow[]
  users: ExportUserRow[]
}

/** POST /api/admin/import 请求体 */
export interface AdminImportInput {
  data: CalineDataDump
  /** 覆盖导入二次确认：若数据库已有数据，必须显式设为 true */
  overwrite?: boolean
}

/** POST /api/admin/import 响应 data 形状 */
export interface AdminImportResult {
  success: true
  importedComments: number
  importedCounters: number
  importedUsers: number
}
