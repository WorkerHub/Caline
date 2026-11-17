/**
 * 站点设置的读写与对外组装（规格 §5.5 / §5.5A / §5.6 / §6.1）。
 *
 * 键名沿用 setup 单播种的那一套（`lib/setup.ts` 的 DEFAULT_SETTINGS），本文件只负责
 * 业务语义与两个对外形状：公开引导端点（`/api/public`）与管理面设置文档
 * （`GET/PUT /api/admin/settings`）。凭据类字段一律只输出 `passwordSet` / `apiKeySet`。
 */
import {
  APP_MODE,
  PROJECT_NAME,
  PROJECT_REPOSITORY_URL,
  PROJECT_TAGLINE
} from "../config/project"
import { isSigningSecretConfigured } from "../core/auth"
import { getSetting, isSetupPageEnabled, setSetting } from "./setup"
import { getTablePrefix } from "./table-prefix"
import { isEmailConfigured, readEmailSettings } from "../services/email"
import type { EmailSettingsView } from "../services/email"
import type {
  CalineSiteSettings,
  CalineSiteSettingsPatch,
  GuestCommentMode
} from "@caline/shared"
import type { Env } from "../types"

/** 构建信息未注入时的兜底版本号：必须非空、且仍是 `git describe` 的形态。 */
export const UNKNOWN_VERSION = "v1.0.0-0-unknown"

export interface RegistrationSettings {
  enabled: boolean
  approvalRequired: boolean
  emailVerificationRequired: boolean
}

async function getFlag(
  env: Env,
  key: string,
  fallback: boolean
): Promise<boolean> {
  const value = await getSetting(env.DB, getTablePrefix(env), key)
  if (value === null) return fallback
  return value === "true"
}

async function setFlag(env: Env, key: string, value: boolean): Promise<void> {
  await setSetting(env.DB, getTablePrefix(env), key, value ? "true" : "false")
}

export async function readRegistrationSettings(
  env: Env
): Promise<RegistrationSettings> {
  return {
    enabled: await getFlag(env, "registration_enabled", true),
    approvalRequired: await getFlag(
      env,
      "registration_approval_required",
      true
    ),
    emailVerificationRequired: await getFlag(
      env,
      "registration_email_verification_enabled",
      false
    )
  }
}

/**
 * 「注册需邮箱验证」是否**真的能执行**：开关开着、邮件已配置、签名钥也在。
 * 注册与登录都按这个有效值判定，所以 provider 事后被清空也不会把已注册未验证的
 * 用户锁死（规格 §5.6 第 4 条）。开关本身保持原值不动。
 */
export async function emailVerificationEnforced(env: Env): Promise<boolean> {
  const registration = await readRegistrationSettings(env)
  if (!registration.emailVerificationRequired) return false
  if (!isSigningSecretConfigured(env.SIGNING_SECRET)) return false
  return isEmailConfigured(env)
}

export interface RegistrationSettingsPatch {
  enabled?: boolean
  approvalRequired?: boolean
  emailVerificationRequired?: boolean
}

export interface SettingsWriteResult {
  ok: boolean
  error?: string
  code?: "EMAIL_NOT_CONFIGURED" | "MODE_CONFLICT"
}

/** 写注册相关开关；单人档不写（调用方先拦），邮件未配置时不许开启验证。 */
export async function writeRegistrationSettings(
  env: Env,
  patch: RegistrationSettingsPatch
): Promise<SettingsWriteResult> {
  if (APP_MODE !== "multi") {
    return {
      ok: false,
      code: "MODE_CONFLICT",
      error: "Registration is not available in single-user mode"
    }
  }
  if (
    patch.emailVerificationRequired === true &&
    !(await isEmailConfigured(env))
  ) {
    return {
      ok: false,
      code: "EMAIL_NOT_CONFIGURED",
      error:
        "Email delivery is not configured; the verification requirement cannot be enabled"
    }
  }

  if (patch.enabled !== undefined) {
    await setFlag(env, "registration_enabled", patch.enabled)
  }
  if (patch.approvalRequired !== undefined) {
    await setFlag(env, "registration_approval_required", patch.approvalRequired)
  }
  if (patch.emailVerificationRequired !== undefined) {
    await setFlag(
      env,
      "registration_email_verification_enabled",
      patch.emailVerificationRequired
    )
  }
  return { ok: true }
}

/** 个人资料修改锁（昵称，默认关闭）。 */
export interface ProfileLockSettings {
  displayNameLocked: boolean
}

export interface ProfileLockSettingsPatch {
  displayNameLocked?: boolean
}

export async function readProfileLockSettings(
  env: Env
): Promise<ProfileLockSettings> {
  return {
    displayNameLocked: await getFlag(env, "profile_display_name_locked", false)
  }
}

/** 写个人资料锁开关；缺省字段不动。两种应用模式均可用（与注册无关）。 */
export async function writeProfileLockSettings(
  env: Env,
  patch: ProfileLockSettingsPatch
): Promise<void> {
  if (patch.displayNameLocked !== undefined) {
    await setFlag(env, "profile_display_name_locked", patch.displayNameLocked)
  }
}

/** 公开引导端点：只放公开、非敏感事实，一个请求够前端首屏用。 */
export interface PublicBootstrap {
  name: string
  tagline: string
  repositoryUrl: string
  version: string
  appMode: typeof APP_MODE
  registrationEnabled: boolean
  emailConfigured: boolean
}

export async function buildPublicBootstrap(env: Env): Promise<PublicBootstrap> {
  const registration = await readRegistrationSettings(env)
  return {
    name: PROJECT_NAME,
    tagline: PROJECT_TAGLINE,
    repositoryUrl: PROJECT_REPOSITORY_URL,
    version: (env.APP_VERSION ?? "").trim() || UNKNOWN_VERSION,
    appMode: APP_MODE,
    registrationEnabled: APP_MODE === "multi" && registration.enabled,
    emailConfigured: await isEmailConfigured(env)
  }
}

/** 管理面设置文档：结构化、凭据脱敏；单人档不暴露注册段。 */
export interface AdminSettings {
  appMode: typeof APP_MODE
  tablePrefix: string
  registration: RegistrationSettings | null
  profileLocks: ProfileLockSettings
  setup: { pageEnabled: boolean }
  email: EmailSettingsView
}

export async function buildAdminSettings(env: Env): Promise<AdminSettings> {
  const prefix = getTablePrefix(env)
  return {
    appMode: APP_MODE,
    tablePrefix: prefix,
    registration:
      APP_MODE === "multi" ? await readRegistrationSettings(env) : null,
    profileLocks: await readProfileLockSettings(env),
    setup: { pageEnabled: await isSetupPageEnabled(env.DB, prefix) },
    email: await readEmailSettings(env)
  }
}

/** setup 页面开关（初始化完成后写关，管理员可重开）。 */
export async function writeSetupPageEnabled(
  env: Env,
  enabled: boolean
): Promise<void> {
  await setSetting(
    env.DB,
    getTablePrefix(env),
    "setup_page_enabled",
    enabled ? "1" : "0"
  )
}

// ─── 评论系统核心配置（规格 §5、§6、§8）──────────────────────────────────────

export const DEFAULT_CALINE_SETTINGS: Omit<
  CalineSiteSettings,
  "turnstileSecretKeySet" | "enotifyKeySet"
> = {
  auditSwitch: false,
  guestMode: "open",
  reservedNicks: ["admin", "administrator"],
  disallowedWords: [],
  ipBlacklist: [],
  maxContentLength: 1000,
  ipRateLimitSeconds: 60,
  levelThresholds: [],
  gravatarMirror: "https://cravatar.cn/avatar/",
  safeDomains: [],
  turnstileEnabled: false,
  turnstileSiteKey: "",
  enotifyEnabled: false
}

export async function getTurnstileSecretKey(env: Env): Promise<string | null> {
  const custom = await getSetting(
    env.DB,
    getTablePrefix(env),
    "caline_turnstile_secret_key"
  )
  if (custom && custom.trim().length > 0) return custom.trim()
  const fromEnv = (
    (env as unknown as Record<string, string>).TURNSTILE_SECRET_KEY ?? ""
  ).trim()
  return fromEnv.length > 0 ? fromEnv : null
}

export async function getEnotifyKey(env: Env): Promise<string | null> {
  const custom = await getSetting(
    env.DB,
    getTablePrefix(env),
    "caline_enotify_key"
  )
  if (custom && custom.trim().length > 0) return custom.trim()
  const fromEnv = (
    (env as unknown as Record<string, string>).ENOTIFY_KEY ?? ""
  ).trim()
  return fromEnv.length > 0 ? fromEnv : null
}

export async function readCalineSettings(
  env: Env
): Promise<CalineSiteSettings> {
  const raw = await getSetting(
    env.DB,
    getTablePrefix(env),
    "caline_site_settings"
  )
  let parsed: Partial<typeof DEFAULT_CALINE_SETTINGS> = {}
  if (raw) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = {}
    }
  }

  const turnstileSecret = await getTurnstileSecretKey(env)
  const enotifyKey = await getEnotifyKey(env)

  return {
    auditSwitch: parsed.auditSwitch ?? DEFAULT_CALINE_SETTINGS.auditSwitch,
    guestMode:
      (parsed.guestMode as GuestCommentMode) ??
      DEFAULT_CALINE_SETTINGS.guestMode,
    reservedNicks: Array.isArray(parsed.reservedNicks)
      ? parsed.reservedNicks
      : DEFAULT_CALINE_SETTINGS.reservedNicks,
    disallowedWords: Array.isArray(parsed.disallowedWords)
      ? parsed.disallowedWords
      : DEFAULT_CALINE_SETTINGS.disallowedWords,
    ipBlacklist: Array.isArray(parsed.ipBlacklist)
      ? parsed.ipBlacklist
      : DEFAULT_CALINE_SETTINGS.ipBlacklist,
    maxContentLength:
      typeof parsed.maxContentLength === "number" && parsed.maxContentLength > 0
        ? parsed.maxContentLength
        : DEFAULT_CALINE_SETTINGS.maxContentLength,
    ipRateLimitSeconds:
      typeof parsed.ipRateLimitSeconds === "number"
        ? parsed.ipRateLimitSeconds
        : DEFAULT_CALINE_SETTINGS.ipRateLimitSeconds,
    levelThresholds: Array.isArray(parsed.levelThresholds)
      ? parsed.levelThresholds
      : DEFAULT_CALINE_SETTINGS.levelThresholds,
    gravatarMirror:
      typeof parsed.gravatarMirror === "string" &&
      parsed.gravatarMirror.trim().length > 0
        ? parsed.gravatarMirror.trim()
        : DEFAULT_CALINE_SETTINGS.gravatarMirror,
    safeDomains: Array.isArray(parsed.safeDomains)
      ? parsed.safeDomains
      : DEFAULT_CALINE_SETTINGS.safeDomains,
    turnstileEnabled:
      parsed.turnstileEnabled ?? DEFAULT_CALINE_SETTINGS.turnstileEnabled,
    turnstileSiteKey:
      parsed.turnstileSiteKey ?? DEFAULT_CALINE_SETTINGS.turnstileSiteKey,
    turnstileSecretKeySet: Boolean(turnstileSecret),
    enotifyEnabled:
      parsed.enotifyEnabled ?? DEFAULT_CALINE_SETTINGS.enotifyEnabled,
    enotifyKeySet: Boolean(enotifyKey)
  }
}

export async function writeCalineSettings(
  env: Env,
  patch: CalineSiteSettingsPatch
): Promise<CalineSiteSettings> {
  const current = await readCalineSettings(env)
  const prefix = getTablePrefix(env)

  if (patch.turnstileSecretKey !== undefined) {
    await setSetting(
      env.DB,
      prefix,
      "caline_turnstile_secret_key",
      patch.turnstileSecretKey.trim()
    )
  }
  if (patch.enotifyKey !== undefined) {
    await setSetting(
      env.DB,
      prefix,
      "caline_enotify_key",
      patch.enotifyKey.trim()
    )
  }

  const updatedJson: Omit<
    CalineSiteSettings,
    "turnstileSecretKeySet" | "enotifyKeySet"
  > = {
    auditSwitch: patch.auditSwitch ?? current.auditSwitch,
    guestMode: patch.guestMode ?? current.guestMode,
    reservedNicks: patch.reservedNicks ?? current.reservedNicks,
    disallowedWords: patch.disallowedWords ?? current.disallowedWords,
    ipBlacklist: patch.ipBlacklist ?? current.ipBlacklist,
    maxContentLength: patch.maxContentLength ?? current.maxContentLength,
    ipRateLimitSeconds: patch.ipRateLimitSeconds ?? current.ipRateLimitSeconds,
    levelThresholds: patch.levelThresholds ?? current.levelThresholds,
    gravatarMirror: patch.gravatarMirror ?? current.gravatarMirror,
    safeDomains: patch.safeDomains ?? current.safeDomains,
    turnstileEnabled: patch.turnstileEnabled ?? current.turnstileEnabled,
    turnstileSiteKey: patch.turnstileSiteKey ?? current.turnstileSiteKey,
    enotifyEnabled: patch.enotifyEnabled ?? current.enotifyEnabled
  }

  await setSetting(
    env.DB,
    prefix,
    "caline_site_settings",
    JSON.stringify(updatedJson)
  )

  return readCalineSettings(env)
}
