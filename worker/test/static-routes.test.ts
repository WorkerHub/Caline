/**
 * 规格 §8 修订：静态路由与 SPA 回落。
 *
 * 验证条：
 * 1. 根路径 GET / 服务演示页；
 * 2. GET /ui 与 GET /ui/* 客户端路由回落至 SPA 宿主（/ui/index.html）；
 * 3. 静态资源（/client/v1.js、/ui/assets/*）优先直接返回；
 * 4. 根路径统一 SPA 回落已删除，非 /ui 的未命中路径如实返回 404；
 * 5. 未命中的 /api/* 依然返回 JSON 404。
 */
import { describe, expect, it } from "vitest"
import {
  activePrefix,
  initializedContext,
  makeContext,
  request,
  seedSession
} from "./support/app"

describe("Worker 静态路由与 /ui SPA 回落（规格 §8 修订）", () => {
  it("GET / 命中演示页", async () => {
    const { env } = makeContext()
    const res = await request(env, "/")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/html")
    expect(await res.text()).toBe("<html>demo</html>")
  })

  it("GET /ui 与 GET /ui/ 回落到 SPA 宿主 /ui/index.html", async () => {
    const { env } = makeContext()

    const resNoSlash = await request(env, "/ui")
    expect(resNoSlash.status).toBe(200)
    expect(resNoSlash.headers.get("content-type")).toContain("text/html")
    expect(await resNoSlash.text()).toBe("<html>spa</html>")

    const resSlash = await request(env, "/ui/")
    expect(resSlash.status).toBe(200)
    expect(resSlash.headers.get("content-type")).toContain("text/html")
    expect(await resSlash.text()).toBe("<html>spa</html>")
  })

  it("GET /ui/* 客户端路由（如 /ui/login、/ui/setup、/ui/comments）回落到 SPA 宿主", async () => {
    const { env } = makeContext()
    const routes = [
      "/ui/login",
      "/ui/register",
      "/ui/forgot-password",
      "/ui/setup",
      "/ui/comments",
      "/ui/settings",
      "/ui/data",
      "/ui/site-settings",
      "/ui/admin"
    ]

    for (const route of routes) {
      const res = await request(env, route)
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toContain("text/html")
      expect(await res.text()).toBe("<html>spa</html>")
    }
  })

  it("真实静态资源命中时直接返回，不走 SPA 回落", async () => {
    const { env } = makeContext()

    const clientRes = await request(env, "/client/v1.js")
    expect(clientRes.status).toBe(200)
    expect(await clientRes.text()).toBe("/* static asset */")

    const uiAssetRes = await request(env, "/ui/assets/index.js")
    expect(uiAssetRes.status).toBe(200)
    expect(await uiAssetRes.text()).toBe("/* static asset */")
  })

  it("非 /ui 未命中路径返回 404（原根路径统一回落已删除）", async () => {
    const { env } = makeContext()
    const nonUiPaths = [
      "/login",
      "/register",
      "/setup",
      "/comments",
      "/random-404",
      "/assets/not-exist.js"
    ]

    for (const path of nonUiPaths) {
      const res = await request(env, path)
      expect(res.status).toBe(404)
    }
  })

  it("未命中 API 请求返回 JSON 404（非 HTML 页面）", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const session = await seedSession(db, prefix, { role: "admin" })

    const res = await request(env, "/api/not-existing-endpoint", {
      headers: { Cookie: session.cookie }
    })
    expect(res.status).toBe(404)
    expect(res.headers.get("content-type")).toContain("application/json")
    const body = (await res.json()) as { error?: string }
    expect(body.error).toBe("Not found")
  })
})
