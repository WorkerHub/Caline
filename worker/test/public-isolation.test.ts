/**
 * 规格 §7-8（公开隔离）：
 * - `/api/public` 只有公开字段，可缓存；
 * - 私有接口未登录一律 401 JSON + `no-store`；
 * - 公开响应里不出现密码哈希、TOTP 密钥、邮件配置等私有数据；
 * - 未命中的 API 是 JSON 404，不落 SPA 回落。
 */
import { describe, expect, it } from "vitest"
import { PROJECT_NAME } from "../src/config/project"
import {
  initializedContext,
  registerAndLogin,
  request,
  TEST_APP_VERSION
} from "./support/app"

const PUBLIC_KEYS = [
  "appMode",
  "emailConfigured",
  "name",
  "registrationEnabled",
  "repositoryUrl",
  "tagline",
  "turnstileEnabled",
  "turnstileSiteKey",
  "version"
]

describe("公开面隔离", () => {
  it("/api/public：公开字段、可缓存、无私有字段", async () => {
    const { env } = await initializedContext()
    const res = await request(env, "/api/public")
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("public, max-age=60")

    const raw = await res.text()
    const body = JSON.parse(raw) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual([...PUBLIC_KEYS].sort())
    expect(body).toMatchObject({
      name: PROJECT_NAME,
      appMode: "multi",
      registrationEnabled: true,
      emailConfigured: false,
      version: TEST_APP_VERSION,
      turnstileEnabled: false,
      turnstileSiteKey: ""
    })
    expect(String(body.repositoryUrl)).toContain("github.com")
    expect(String(body.tagline).length).toBeGreaterThan(0)

    for (const forbidden of [
      "password",
      "totp",
      "smtp",
      "resend",
      "api_key",
      "secret"
    ]) {
      expect(raw.toLowerCase()).not.toContain(forbidden)
    }
  })

  it("/api/public：下发 Turnstile 配置（开启下发 sitekey、关闭为空字符串、私钥不泄露）", async () => {
    const { env } = await initializedContext()
    const { writeCalineSettings } = await import("../src/lib/settings")

    // 1. 开启且配置有效 sitekey
    await writeCalineSettings(env, {
      turnstileEnabled: true,
      turnstileSiteKey: "0x4AAAAAA_test_site_key",
      turnstileSecretKey: "0x4AAAAAA_test_secret_key"
    })
    let res = await request(env, "/api/public")
    expect(res.status).toBe(200)
    let body = (await res.json()) as Record<string, unknown>
    expect(body.turnstileEnabled).toBe(true)
    expect(body.turnstileSiteKey).toBe("0x4AAAAAA_test_site_key")

    // 2. 开启但 sitekey 为空/空白字符
    await writeCalineSettings(env, {
      turnstileEnabled: true,
      turnstileSiteKey: "   "
    })
    res = await request(env, "/api/public")
    expect(res.status).toBe(200)
    body = (await res.json()) as Record<string, unknown>
    expect(body.turnstileEnabled).toBe(false)
    expect(body.turnstileSiteKey).toBe("")

    // 3. 关闭但 sitekey 有值
    await writeCalineSettings(env, {
      turnstileEnabled: false,
      turnstileSiteKey: "0x4AAAAAA_test_site_key"
    })
    res = await request(env, "/api/public")
    expect(res.status).toBe(200)
    body = (await res.json()) as Record<string, unknown>
    expect(body.turnstileEnabled).toBe(false)
    expect(body.turnstileSiteKey).toBe("")

    // 4. 确保 secret key 绝不泄露到 /api/public
    const raw = JSON.stringify(body)
    expect(raw).not.toContain("0x4AAAAAA_test_secret_key")
    expect(raw.toLowerCase()).not.toContain("secret")
  })

  it("私有接口未登录：401 JSON + no-store", async () => {
    const { env } = await initializedContext()
    for (const path of ["/api/me", "/api/admin/settings", "/api/me/passkeys"]) {
      const res = await request(env, path)
      expect(res.status).toBe(401)
      expect(res.headers.get("cache-control")).toBe("no-store")
      expect(res.headers.get("content-type")).toContain("application/json")
      const body = (await res.json()) as { error: string }
      expect(body.error).toBeTruthy()
    }
  })

  it("登录后的 /api/me 不含密码哈希/TOTP 密钥", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "owner@example.test"
    })
    const res = await request(env, "/api/me", { headers: { cookie } })
    expect(res.status).toBe(200)
    const raw = await res.text()
    expect(raw).not.toContain("password")
    expect(raw).not.toContain("totp_secret")
    const body = JSON.parse(raw) as {
      email: string
      emailVerified: boolean
      totpEnabled: boolean
      passkeyCount: number
    }
    expect(body.email).toBe("owner@example.test")
    expect(body.emailVerified).toBe(true)
    expect(body.totpEnabled).toBe(false)
    expect(body.passkeyCount).toBe(0)
    expect(body).not.toHaveProperty("twoFactor")
  })

  it("未知 API 一律 JSON：未登录 401、已登录 404，都不落 SPA 回落", async () => {
    const { env } = await initializedContext()
    const anonymous = await request(env, "/api/does-not-exist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    })
    expect(anonymous.status).toBe(401)
    expect(anonymous.headers.get("content-type")).toContain("application/json")

    const { cookie } = await registerAndLogin(env, {
      email: "owner@example.test"
    })
    const authed = await request(env, "/api/does-not-exist", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "{}"
    })
    expect(authed.status).toBe(404)
    expect(authed.headers.get("content-type")).toContain("application/json")
  })
})
