/**
 * 通行密钥（第二因子）与设置页管理：注册、列表、断言登录、删除。
 *
 * WebAuthn 的浏览器侧无法在 vitest 里跑，所以把 `@simplewebauthn/server` 换成
 * 固定返回（规格 §7-9 允许 stub）：本用例验证的是我们的接线——挑战 Cookie、
 * 用户绑定、凭据落库、成功后发会话、未知凭据被拒、DTO 不泄露公钥。
 */
import { describe, expect, it, vi } from "vitest"
import { verifyAuthenticationResponse } from "@simplewebauthn/server"

import { PROJECT_NAME } from "../src/config/project"

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: vi.fn(async () => ({
    challenge: "register-challenge",
    rp: { id: "worker.test", name: PROJECT_NAME },
    user: { id: "dXNlcg", name: "user", displayName: "user" },
    pubKeyCredParams: [],
    timeout: 60_000,
    excludeCredentials: [],
    authenticatorSelection: {},
    attestation: "none"
  })),
  verifyRegistrationResponse: vi.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: "cred-1",
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: ["internal"]
      }
    }
  })),
  generateAuthenticationOptions: vi.fn(async () => ({
    challenge: "auth-challenge",
    rpId: "worker.test",
    allowCredentials: [],
    timeout: 60_000
  })),
  verifyAuthenticationResponse: vi.fn(async (options: any) => {
    if (options?.response?.id === "invalid-assertion") {
      return { verified: false }
    }
    const currentCounter = options?.credential?.counter ?? 0
    return {
      verified: true,
      authenticationInfo: {
        credentialID: options?.credential?.id ?? "cred-1",
        newCounter: currentCounter + 1
      }
    }
  })
}))

import { findPasskeyByGlobalCredentialId } from "../src/db/queries/passkeys"
import { writeRegistrationSettings } from "../src/lib/settings"
import { getTablePrefix } from "../src/lib/table-prefix"
import { passkeysTable, usersTable } from "../src/lib/tables"
import {
  configureResend,
  cookieFrom,
  cookieHeader,
  initializedContext,
  loginUser,
  postJson,
  registerAndLogin,
  request,
  TEST_PASSWORD
} from "./support/app"

describe("通行密钥", () => {
  it("注册 → 列表 → 作为第二因子登录 → 删除", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "owner@example.test"
    })

    const options = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    expect(options.status).toBe(200)
    expect(((await options.json()) as { challenge: string }).challenge).toBe(
      "register-challenge"
    )
    const challengeCookie = cookieFrom(options, "passkey_challenge")

    const created = await postJson(
      env,
      "/api/auth/2fa/passkey/register/verify",
      { credential: { id: "cred-1", type: "public-key" } },
      { cookie: cookieHeader(cookie, challengeCookie) }
    )
    expect(created.status).toBe(201)

    const list = await request(env, "/api/me/passkeys", { headers: { cookie } })
    const listBody = (await list.json()) as {
      items: Array<Record<string, unknown>>
    }
    expect(listBody.items).toHaveLength(1)
    expect(Object.keys(listBody.items[0]).sort()).toEqual([
      "createdAt",
      "id",
      "lastUsedAt",
      "transports"
    ])
    const raw = JSON.stringify(listBody)
    expect(raw).not.toContain("cred-1")
    expect(raw).not.toContain("publicKey")

    const meBound = (await (
      await request(env, "/api/me", { headers: { cookie } })
    ).json()) as { passkeyCount: number }
    expect(meBound.passkeyCount).toBe(1)

    // 密码步 → tempToken，方法里应有 passkey
    const passwordStep = await loginUser(env, { email: "owner@example.test" })
    const stepBody = (await passwordStep.json()) as {
      requires2fa: boolean
      tempToken: string
      methods: string[]
    }
    expect(stepBody.requires2fa).toBe(true)
    expect(stepBody.methods).toContain("passkey")

    const assertOptions = await postJson(env, "/api/auth/2fa/passkey/options", {
      tempToken: stepBody.tempToken
    })
    expect(assertOptions.status).toBe(200)
    const assertChallenge = cookieFrom(assertOptions, "passkey_challenge")

    const verified = await postJson(
      env,
      "/api/auth/2fa/passkey/verify",
      { tempToken: stepBody.tempToken, credential: { id: "cred-1" } },
      { cookie: assertChallenge }
    )
    expect(verified.status).toBe(200)
    const verifiedBody = (await verified.json()) as {
      success: boolean
      user: { email: string }
    }
    expect(verifiedBody.success).toBe(true)
    expect(verifiedBody.user.email).toBe("owner@example.test")
    expect("requires2fa" in verifiedBody).toBe(false)
    const session = cookieFrom(verified)
    expect(
      (await request(env, "/api/me", { headers: { cookie: session } })).status
    ).toBe(200)

    const passkeyId = listBody.items[0].id as number
    const removed = await request(env, `/api/me/passkeys/${passkeyId}`, {
      method: "DELETE",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ password: "correct-horse-battery" })
    })
    expect(removed.status).toBe(200)
    const empty = await request(env, "/api/me/passkeys", {
      headers: { cookie }
    })
    expect(((await empty.json()) as { items: unknown[] }).items).toEqual([])
    const meCleared = (await (
      await request(env, "/api/me", { headers: { cookie } })
    ).json()) as { passkeyCount: number }
    expect(meCleared.passkeyCount).toBe(0)
  })

  it("未知凭据被拒；删除需要正确密码", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "owner@example.test"
    })

    const options = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    const challengeCookie = cookieFrom(options, "passkey_challenge")
    await postJson(
      env,
      "/api/auth/2fa/passkey/register/verify",
      { credential: { id: "cred-1" } },
      { cookie: cookieHeader(cookie, challengeCookie) }
    )

    const step = (await (
      await loginUser(env, { email: "owner@example.test" })
    ).json()) as { tempToken: string }
    const assertOptions = await postJson(env, "/api/auth/2fa/passkey/options", {
      tempToken: step.tempToken
    })
    const assertChallenge = cookieFrom(assertOptions, "passkey_challenge")

    const unknown = await postJson(
      env,
      "/api/auth/2fa/passkey/verify",
      { tempToken: step.tempToken, credential: { id: "nope" } },
      { cookie: assertChallenge }
    )
    expect(unknown.status).toBe(400)
    expect(((await unknown.json()) as { code: string }).code).toBe(
      "PASSKEY_FAILED"
    )

    const wrongPassword = await request(env, "/api/me/passkeys/1", {
      method: "DELETE",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ password: "wrong-password" })
    })
    expect(wrongPassword.status).toBe(403)
    expect(((await wrongPassword.json()) as { code: string }).code).toBe(
      "PASSWORD_INCORRECT"
    )
  })

  it("缺少挑战 Cookie 时拒绝断言", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "owner@example.test"
    })

    const options = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    const challengeCookie = cookieFrom(options, "passkey_challenge")
    await postJson(
      env,
      "/api/auth/2fa/passkey/register/verify",
      { credential: { id: "cred-1" } },
      { cookie: cookieHeader(cookie, challengeCookie) }
    )

    const step = (await (
      await loginUser(env, { email: "owner@example.test" })
    ).json()) as { tempToken: string }

    const res = await postJson(env, "/api/auth/2fa/passkey/verify", {
      tempToken: step.tempToken,
      credential: { id: "cred-1" }
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe(
      "PASSKEY_CHALLENGE_MISSING"
    )
  })
})

describe("通行密钥免密直接登录（discoverable credential）", () => {
  it("options 端点：匿名可取、置挑战 Cookie、无 allow 列表", async () => {
    const { env } = await initializedContext()
    const options = await postJson(env, "/api/auth/passkey/options", {})
    expect(options.status).toBe(200)
    const body = (await options.json()) as Record<string, unknown>
    expect(body.challenge).toBe("auth-challenge")
    expect("allowCredentials" in body).toBe(false)
    const challengeCookie = cookieFrom(options, "passkey_challenge")
    expect(challengeCookie).toBeTruthy()
  })

  it("已注册第二因子的通行密钥可免密直接登录，成功建立会话并更新 counter", async () => {
    const { env } = await initializedContext()
    const prefix = getTablePrefix(env)
    const { cookie } = await registerAndLogin(env, {
      email: "direct-user@example.test"
    })

    // 用户在安全设置中登记第二因子通行密钥
    const regOpt = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    const regChallenge = cookieFrom(regOpt, "passkey_challenge")
    await postJson(
      env,
      "/api/auth/2fa/passkey/register/verify",
      { credential: { id: "cred-1", type: "public-key" } },
      { cookie: cookieHeader(cookie, regChallenge) }
    )

    // 登出
    await postJson(env, "/api/auth/logout", {}, { cookie })

    // 检查初始 counter 为 0，last_used_at 为 null
    const beforeRow = await findPasskeyByGlobalCredentialId(
      env.DB,
      prefix,
      "cred-1"
    )
    expect(beforeRow?.counter).toBe(0)
    expect(beforeRow?.last_used_at).toBeNull()

    // 1. 请求免密登录 options（匿名请求）
    const optRes = await postJson(env, "/api/auth/passkey/options", {})
    expect(optRes.status).toBe(200)
    const challengeCookie = cookieFrom(optRes, "passkey_challenge")

    // 2. 提交凭据断言（verify）
    const verifyRes = await postJson(
      env,
      "/api/auth/passkey/verify",
      { credential: { id: "cred-1" } },
      { cookie: challengeCookie }
    )
    expect(verifyRes.status).toBe(200)
    const verifyBody = (await verifyRes.json()) as {
      success: boolean
      user: { email: string; passkeyCount: number }
    }
    expect(verifyBody.success).toBe(true)
    expect(verifyBody.user.email).toBe("direct-user@example.test")
    expect(verifyBody.user.passkeyCount).toBe(1)

    // 3. 验证会话 Cookie 成功签发并可用
    const sessionCookie = cookieFrom(verifyRes)
    expect(sessionCookie).toBeTruthy()
    const me = await request(env, "/api/me", {
      headers: { cookie: sessionCookie }
    })
    expect(me.status).toBe(200)

    // 4. counter 递增防重放，且记录 last_used_at
    const afterRow = await findPasskeyByGlobalCredentialId(
      env.DB,
      prefix,
      "cred-1"
    )
    expect(afterRow?.counter).toBe(1)
    expect(afterRow?.last_used_at).not.toBeNull()

    // 5. 再次登录，counter 递增为 2
    const optRes2 = await postJson(env, "/api/auth/passkey/options", {})
    const challengeCookie2 = cookieFrom(optRes2, "passkey_challenge")
    const verifyRes2 = await postJson(
      env,
      "/api/auth/passkey/verify",
      { credential: { id: "cred-1" } },
      { cookie: challengeCookie2 }
    )
    expect(verifyRes2.status).toBe(200)
    const afterRow2 = await findPasskeyByGlobalCredentialId(
      env.DB,
      prefix,
      "cred-1"
    )
    expect(afterRow2?.counter).toBe(2)
  })

  it("未知凭据拒绝 (400 PASSKEY_FAILED)", async () => {
    const { env } = await initializedContext()
    const optRes = await postJson(env, "/api/auth/passkey/options", {})
    const challengeCookie = cookieFrom(optRes, "passkey_challenge")

    const res = await postJson(
      env,
      "/api/auth/passkey/verify",
      { credential: { id: "unknown-cred-id" } },
      { cookie: challengeCookie }
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe("PASSKEY_FAILED")
  })

  it("挑战缺失或过期时拒绝 (400 PASSKEY_CHALLENGE_MISSING)", async () => {
    const { env } = await initializedContext()

    // 缺失挑战 Cookie
    const resMissing = await postJson(env, "/api/auth/passkey/verify", {
      credential: { id: "cred-1" }
    })
    expect(resMissing.status).toBe(400)
    expect(((await resMissing.json()) as { code: string }).code).toBe(
      "PASSKEY_CHALLENGE_MISSING"
    )

    // 非法或伪造 Cookie
    const resBad = await postJson(
      env,
      "/api/auth/passkey/verify",
      { credential: { id: "cred-1" } },
      { cookie: "passkey_challenge=bad-cookie-value" }
    )
    expect(resBad.status).toBe(400)
    expect(((await resBad.json()) as { code: string }).code).toBe(
      "PASSKEY_CHALLENGE_MISSING"
    )
  })

  it("断言签名失败时拒绝 (401 PASSKEY_FAILED)", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "signer@example.test"
    })
    const regOpt = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    const regChallenge = cookieFrom(regOpt, "passkey_challenge")
    await postJson(
      env,
      "/api/auth/2fa/passkey/register/verify",
      { credential: { id: "cred-1", type: "public-key" } },
      { cookie: cookieHeader(cookie, regChallenge) }
    )

    const optRes = await postJson(env, "/api/auth/passkey/options", {})
    const challengeCookie = cookieFrom(optRes, "passkey_challenge")

    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
      verified: false
    } as never)

    const res = await postJson(
      env,
      "/api/auth/passkey/verify",
      { credential: { id: "cred-1" } },
      { cookie: challengeCookie }
    )
    expect(res.status).toBe(401)
    expect(((await res.json()) as { code: string }).code).toBe("PASSKEY_FAILED")
  })

  it("账号待审批 (pending) 或已停用 (disabled) 时拒绝直接登录", async () => {
    const { env, db } = await initializedContext()
    const prefix = getTablePrefix(env)
    const { cookie } = await registerAndLogin(env, {
      email: "status-test@example.test"
    })
    const regOpt = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    const regChallenge = cookieFrom(regOpt, "passkey_challenge")
    await postJson(
      env,
      "/api/auth/2fa/passkey/register/verify",
      { credential: { id: "cred-1", type: "public-key" } },
      { cookie: cookieHeader(cookie, regChallenge) }
    )

    // 1. pending 状态
    db.db
      .prepare(
        `UPDATE ${usersTable(prefix)} SET status = 'pending' WHERE email = ?`
      )
      .run("status-test@example.test")

    const optPending = await postJson(env, "/api/auth/passkey/options", {})
    const chalPending = cookieFrom(optPending, "passkey_challenge")
    const resPending = await postJson(
      env,
      "/api/auth/passkey/verify",
      { credential: { id: "cred-1" } },
      { cookie: chalPending }
    )
    expect(resPending.status).toBe(403)
    expect(((await resPending.json()) as { code: string }).code).toBe(
      "ACCOUNT_PENDING"
    )

    // 2. disabled 状态
    db.db
      .prepare(
        `UPDATE ${usersTable(prefix)} SET status = 'disabled' WHERE email = ?`
      )
      .run("status-test@example.test")

    const optDisabled = await postJson(env, "/api/auth/passkey/options", {})
    const chalDisabled = cookieFrom(optDisabled, "passkey_challenge")
    const resDisabled = await postJson(
      env,
      "/api/auth/passkey/verify",
      { credential: { id: "cred-1" } },
      { cookie: chalDisabled }
    )
    expect(resDisabled.status).toBe(403)
    expect(((await resDisabled.json()) as { code: string }).code).toBe(
      "ACCOUNT_DISABLED"
    )
  })

  it("凭据存在但用户不存在（未注册用户或已被删除）时拒绝", async () => {
    const { env } = await initializedContext()
    const prefix = getTablePrefix(env)
    await env.DB.prepare(
      `INSERT INTO ${passkeysTable(prefix)}
          (user_id, credential_id, public_key, counter, transports, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        999999,
        "orphan-cred",
        "AAAA",
        0,
        "internal",
        new Date().toISOString()
      )
      .run()

    const optRes = await postJson(env, "/api/auth/passkey/options", {})
    const challengeCookie = cookieFrom(optRes, "passkey_challenge")

    const res = await postJson(
      env,
      "/api/auth/passkey/verify",
      { credential: { id: "orphan-cred" } },
      { cookie: challengeCookie }
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe("PASSKEY_FAILED")
  })

  it("强制邮箱验证开启且用户未验证邮箱时拒绝登录", async () => {
    const { env, db } = await initializedContext()
    const prefix = getTablePrefix(env)
    const { cookie } = await registerAndLogin(env, {
      email: "unverified@example.test"
    })
    const regOpt = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    const regChallenge = cookieFrom(regOpt, "passkey_challenge")
    await postJson(
      env,
      "/api/auth/2fa/passkey/register/verify",
      { credential: { id: "cred-1", type: "public-key" } },
      { cookie: cookieHeader(cookie, regChallenge) }
    )

    configureResend(db, prefix)
    await writeRegistrationSettings(env, {
      emailVerificationRequired: true
    })
    db.db
      .prepare(
        `UPDATE ${usersTable(prefix)} SET email_verified = 0 WHERE email = ?`
      )
      .run("unverified@example.test")

    const optRes = await postJson(env, "/api/auth/passkey/options", {})
    const challengeCookie = cookieFrom(optRes, "passkey_challenge")

    const res = await postJson(
      env,
      "/api/auth/passkey/verify",
      { credential: { id: "cred-1" } },
      { cookie: challengeCookie }
    )
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe(
      "EMAIL_NOT_VERIFIED"
    )
  })
})
