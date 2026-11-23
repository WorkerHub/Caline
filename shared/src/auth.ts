/**
 * 账号与认证接口契约（规格 §3、§4、§6）。
 *
 * 继承模板已有基础，在 Me 中扩展 Caline 评论所需身份字段：
 * - label: 用户标签（如博主、管理员、访客徽章）
 * - avatar: 自定义头像地址（未设时回退 Gravatar）
 * - url: 个人主页/博客链接
 * - githubId: GitHub 关联 ID（留空备二期）
 */

export type UserRole = "admin" | "user"

export type UserAccountStatus = "active" | "pending" | "disabled"

export interface ProfileLocks {
  displayNameLocked: boolean
}

/** GET /api/auth/me 与登录成功响应中的用户态对象 */
export interface AuthMe {
  id: number
  email: string
  displayName: string
  role: UserRole
  status: UserAccountStatus
  emailVerified: boolean
  mustChangePassword: boolean
  language: string
  timezone: string
  totpEnabled: boolean
  emailTwoFactorEnabled: boolean
  passkeyCount: number
  profileLocks: ProfileLocks
  /** 扩展字段：身份标签（评论区展示） */
  label?: string
  /** 扩展字段：个人头像链接 */
  avatar?: string
  /** 扩展字段：个人站点链接 */
  url?: string
  /** 扩展字段：二期社交关联留空列 */
  githubId?: string | null
}

/** PATCH /api/auth/me 请求体（支持修改昵称、网站、头像、语言、时区） */
export interface UpdateAuthMeInput {
  displayName?: string
  avatar?: string
  url?: string
  language?: string
  timezone?: string
}

/** POST /api/auth/register 请求体 */
export interface RegisterInput {
  email: string
  password: string
  displayName?: string
  language?: string
}

/** POST /api/auth/register 响应 data 形状 */
export interface RegisterResult {
  requiresApproval: boolean
  requiresEmailVerification: boolean
}

/** POST /api/auth/login 请求体 */
export interface LoginInput {
  email: string
  password: string
}

export type TwoFactorMethod = "totp" | "passkey" | "email"

/** POST /api/auth/login 响应 data 形状 */
export type LoginResult =
  | { success: true; user: AuthMe }
  | { requires2fa: true; tempToken: string; methods: TwoFactorMethod[] }

/** POST /api/auth/logout 响应 data 形状 */
export interface LogoutResult {
  success: true
}

/** 弹窗模式登录成功向 opener 发送的 postMessage 事件类型 */
export const AUTH_SUCCESS_TYPE = "caline:auth-success"
