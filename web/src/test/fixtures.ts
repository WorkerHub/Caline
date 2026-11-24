import { PROJECT_NAME, PROJECT_TAGLINE } from "@worker/config/project"
import type {
  AdminCreateUserResult,
  AdminSettings,
  AdminUser,
  CalineDataDump,
  CalineSiteSettings,
  CommentAdminItem,
  Me,
  PublicInfo,
  SetupState
} from "@/lib/api-types"

export { PROJECT_NAME, PROJECT_TAGLINE }

/** 测试用的 DTO 形状：默认值只覆盖页面关心的字段，用例按需覆盖。 */

export function publicInfo(overrides: Partial<PublicInfo> = {}): PublicInfo {
  return {
    name: PROJECT_NAME,
    tagline: PROJECT_TAGLINE,
    repositoryUrl: "https://example.com/template",
    version: "v1.0.0-0-test",
    appMode: "multi",
    registrationEnabled: true,
    emailConfigured: true,
    ...overrides
  }
}

export function me(overrides: Partial<Me> = {}): Me {
  return {
    id: 1,
    email: "owner@example.com",
    displayName: "Owner",
    role: "admin",
    status: "active",
    emailVerified: true,
    mustChangePassword: false,
    language: "zh",
    timezone: "Asia/Shanghai",
    totpEnabled: false,
    emailTwoFactorEnabled: false,
    passkeyCount: 0,
    profileLocks: { displayNameLocked: false },
    ...overrides
  }
}

export function setupState(overrides: Partial<SetupState> = {}): SetupState {
  return {
    enabled: true,
    ownerExists: false,
    tablePrefix: "template_",
    ...overrides
  }
}

export function adminSettings(
  overrides: Partial<AdminSettings> = {}
): AdminSettings {
  return {
    registration: {
      enabled: true,
      approvalRequired: true,
      emailVerification: false
    },
    profileLocks: { displayNameLocked: false },
    setupPageEnabled: true,
    tablePrefix: "template_",
    email: {
      provider: "smtp",
      smtp: {
        host: "smtp.example.com",
        port: "587",
        username: "mailer",
        passwordSet: true,
        from: "noreply@example.com",
        fromName: PROJECT_NAME
      },
      resend: { apiKeySet: false, from: "", fromName: "" },
      configured: true
    },
    ...overrides
  }
}

export function adminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 2,
    email: "user@example.com",
    displayName: "User",
    role: "user",
    status: "active",
    emailVerified: true,
    createdAt: "2026-01-02T03:04:05.000Z",
    ...overrides
  }
}

export function adminCreatedUser(
  overrides: Partial<AdminCreateUserResult> = {}
): AdminCreateUserResult {
  return {
    id: 9,
    email: "new@example.com",
    role: "user",
    status: "active",
    temporaryPassword: "temp-2026",
    ...overrides
  }
}

export function commentItem(
  overrides: Partial<CommentAdminItem> = {}
): CommentAdminItem {
  return {
    id: 1,
    userId: null,
    nick: "Alice",
    mail: "alice@example.com",
    link: "https://alice.example.com",
    url: "/posts/first",
    pid: null,
    rid: null,
    contentRaw: "Hello world comment",
    contentHtml: "<p>Hello world comment</p>",
    status: "approved",
    sticky: false,
    likeCount: 0,
    ip: "192.168.1.1",
    ua: "Mozilla/5.0 Chrome/120.0",
    createdAt: "2026-02-01T12:00:00.000Z",
    updatedAt: "2026-02-01T12:00:00.000Z",
    ...overrides
  }
}

export function calineSiteSettings(
  overrides: Partial<CalineSiteSettings> = {}
): CalineSiteSettings {
  return {
    auditSwitch: false,
    guestMode: "open",
    reservedNicks: ["admin", "root"],
    disallowedWords: ["spamword"],
    ipBlacklist: ["10.0.0.1"],
    maxContentLength: 1000,
    ipRateLimitSeconds: 60,
    levelThresholds: [0, 10, 50],
    gravatarMirror: "https://cravatar.cn/avatar/",
    safeDomains: ["example.com"],
    turnstileEnabled: false,
    turnstileSiteKey: "0x4AAAAAA",
    turnstileSecretKeySet: true,
    enotifyEnabled: false,
    enotifyKeySet: false,
    orphanCleanupEnabled: false,
    ...overrides
  }
}

export function calineDataDump(
  overrides: Partial<CalineDataDump> = {}
): CalineDataDump {
  return {
    version: "1.0.0",
    exportedAt: "2026-02-01T12:00:00.000Z",
    comments: [
      {
        id: 1,
        user_id: null,
        nick: "Alice",
        mail: "alice@example.com",
        link: "https://alice.example.com",
        url: "/posts/first",
        pid: null,
        rid: null,
        content_raw: "Hello world comment",
        content_html: "<p>Hello world comment</p>",
        status: "approved",
        sticky: 0,
        like_count: 0,
        edit_token_hash: null,
        ip: "192.168.1.1",
        ua: "Mozilla/5.0 Chrome/120.0",
        created_at: "2026-02-01T12:00:00.000Z",
        updated_at: "2026-02-01T12:00:00.000Z"
      }
    ],
    counters: [
      {
        id: 1,
        url: "/posts/first",
        pageview: 10,
        reaction0: 1,
        reaction1: 0,
        reaction2: 0,
        reaction3: 0,
        reaction4: 0,
        reaction5: 0,
        reaction6: 0,
        reaction7: 0,
        reaction8: 0,
        created_at: "2026-02-01T12:00:00.000Z",
        updated_at: "2026-02-01T12:00:00.000Z"
      }
    ],
    users: [
      {
        id: 1,
        email: "owner@example.com",
        role: "admin",
        status: "active",
        email_verified: 1,
        language: "zh",
        display_name: "Owner",
        timezone: "Asia/Shanghai",
        created_at: "2026-02-01T12:00:00.000Z",
        updated_at: "2026-02-01T12:00:00.000Z",
        label: "Author",
        avatar: "",
        url: "",
        github_id: null
      }
    ],
    ...overrides
  }
}
