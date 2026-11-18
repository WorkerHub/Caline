/**
 * CORS 跨域治理与安全域名测试（QA #7 缺陷①、规格 §5）。
 *
 * 覆盖：
 * 1. OPTIONS 预检 204（无论公开还是私有路由，不被 401 拦截，不落入 404）。
 * 2. 预检与业务请求正确附带 Access-Control-Allow-Origin / Credentials / Methods / Headers / Vary。
 * 3. safeDomains 白名单生效：非法源预检 403、合法源放行、合法子域名放行。
 * 4. 业务错误响应（401 / 404）在合法源下依然携带 CORS 头，避免浏览器拦截遮蔽真实业务错误。
 * 5. 无 Origin 请求（同源）正常响应，不注入多余 CORS 头。
 */
import { describe, expect, it } from "vitest"
import { initializedContext, request } from "./support/app"
import { writeCalineSettings } from "../src/lib/settings"

describe("CORS 跨域与预检处理", () => {
  it("默认无 safeDomains 配置时：OPTIONS 预检对公开与受保护接口均返回 204", async () => {
    const { env } = await initializedContext()

    // 公开端点预检
    const publicOpt = await request(env, "/api/comments", {
      method: "OPTIONS",
      headers: {
        Origin: "https://myblog.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type, Authorization"
      }
    })
    expect(publicOpt.status).toBe(204)
    expect(publicOpt.headers.get("access-control-allow-origin")).toBe(
      "https://myblog.com"
    )
    expect(publicOpt.headers.get("access-control-allow-credentials")).toBe(
      "true"
    )
    expect(publicOpt.headers.get("access-control-allow-methods")).toContain(
      "POST"
    )
    expect(publicOpt.headers.get("access-control-allow-headers")).toContain(
      "Content-Type"
    )
    expect(publicOpt.headers.get("vary")).toBe("Origin")

    // 受保护端点预检（不能被 401 拦截，也不能回 404）
    const protectedOpt = await request(env, "/api/me", {
      method: "OPTIONS",
      headers: {
        Origin: "https://myblog.com",
        "Access-Control-Request-Method": "GET"
      }
    })
    expect(protectedOpt.status).toBe(204)
    expect(protectedOpt.headers.get("access-control-allow-origin")).toBe(
      "https://myblog.com"
    )
    expect(protectedOpt.headers.get("access-control-allow-credentials")).toBe(
      "true"
    )
  })

  it("跨域业务请求携带 Access-Control-* 与 Vary 头", async () => {
    const { env } = await initializedContext()

    const res = await request(env, "/api/public", {
      headers: { Origin: "https://myblog.com" }
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://myblog.com"
    )
    expect(res.headers.get("access-control-allow-credentials")).toBe("true")
    expect(res.headers.get("vary")).toBe("Origin")
  })

  it("业务错误响应（401 / 404）在合法源下保留 CORS 头以供浏览器读取", async () => {
    const { env } = await initializedContext()

    // 401 未登录
    const unauth = await request(env, "/api/me", {
      headers: { Origin: "https://myblog.com" }
    })
    expect(unauth.status).toBe(401)
    expect(unauth.headers.get("access-control-allow-origin")).toBe(
      "https://myblog.com"
    )
    expect(unauth.headers.get("access-control-allow-credentials")).toBe("true")

    // 404 接口不存在（公开前缀下的未命中路径）
    const notFound = await request(env, "/api/comments/non-existent-subpath", {
      headers: { Origin: "https://myblog.com" }
    })
    expect(notFound.status).toBe(404)
    expect(notFound.headers.get("access-control-allow-origin")).toBe(
      "https://myblog.com"
    )
    expect(notFound.headers.get("access-control-allow-credentials")).toBe(
      "true"
    )
  })

  it("配置 safeDomains 时，严格限制允许源，拒绝非法域名", async () => {
    const { env } = await initializedContext()

    // 设置安全域名白名单
    await writeCalineSettings(env, {
      safeDomains: ["https://allowed.com", "myblog.org"]
    })

    // 1. 非法 Origin 发起预检 -> 403 Forbidden 且无 allow-origin 头
    const evilOpt = await request(env, "/api/comments", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.com",
        "Access-Control-Request-Method": "POST"
      }
    })
    expect(evilOpt.status).toBe(403)
    expect(evilOpt.headers.get("access-control-allow-origin")).toBeNull()

    // 2. 合法完整源发起预检 -> 204
    const goodOpt = await request(env, "/api/comments", {
      method: "OPTIONS",
      headers: {
        Origin: "https://allowed.com",
        "Access-Control-Request-Method": "POST"
      }
    })
    expect(goodOpt.status).toBe(204)
    expect(goodOpt.headers.get("access-control-allow-origin")).toBe(
      "https://allowed.com"
    )

    // 3. 合法子域名发起预检 -> 204
    const subOpt = await request(env, "/api/comments", {
      method: "OPTIONS",
      headers: {
        Origin: "https://sub.myblog.org",
        "Access-Control-Request-Method": "GET"
      }
    })
    expect(subOpt.status).toBe(204)
    expect(subOpt.headers.get("access-control-allow-origin")).toBe(
      "https://sub.myblog.org"
    )

    // 4. 非法源发起业务请求 -> 响应不含 CORS 头
    const evilReq = await request(env, "/api/public", {
      headers: { Origin: "https://attacker.com" }
    })
    expect(evilReq.status).toBe(200)
    expect(evilReq.headers.get("access-control-allow-origin")).toBeNull()
  })

  it("同源/无 Origin 头请求正常通行，不增加 Access-Control-* 头", async () => {
    const { env } = await initializedContext()

    const res = await request(env, "/api/public")
    expect(res.status).toBe(200)
    expect(res.headers.get("access-control-allow-origin")).toBeNull()
    expect(res.headers.get("access-control-allow-credentials")).toBeNull()
  })
})
