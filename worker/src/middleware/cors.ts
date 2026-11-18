/**
 * CORS 中间件（规格 §5 安全域名）。
 *
 * 1. OPTIONS 预检请求：
 *    - 匹配 safeDomains（若未配置 safeDomains，则默认放行所有 Origin）；
 *    - 允许时直接回 204 No Content，并返回 Access-Control-* 头，不再穿透到下游守卫；
 *    - 拒绝时回 403 Forbidden，不返回 Access-Control-Allow-Origin。
 * 2. 实际业务请求（带 Origin 头）：
 *    - 允许时下游执行后注入 Access-Control-Allow-Origin / Credentials / Vary；
 *    - 拒绝时不注入 CORS 头，由浏览器同源策略拦截。
 * 3. 同源/无 Origin 头请求：原样通行。
 */
import type { MiddlewareHandler } from "hono"
import { isDomainAllowed } from "../core/pipeline"
import { readCalineSettings } from "../lib/settings"
import type { HonoEnv } from "../types"

export const corsMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const origin = c.req.header("origin")

  // 非跨域请求（无 Origin 请求头）
  if (!origin) {
    if (c.req.method === "OPTIONS") {
      return c.body(null, 204)
    }
    return next()
  }

  // 跨域请求：按安全域名校验
  let safeDomains: string[] = []
  try {
    const settings = await readCalineSettings(c.env)
    safeDomains = settings.safeDomains
  } catch {
    // 数据库未就绪等异常降级为默认空列表（默认全放行）
    safeDomains = []
  }

  const allowed = isDomainAllowed(origin, safeDomains)

  if (!allowed) {
    if (c.req.method === "OPTIONS") {
      return c.json({ error: "Origin not allowed" }, 403)
    }
    // 业务请求未在安全域名内，不注入 CORS 响应头
    return next()
  }

  // 域名允许时：处理 OPTIONS 预检请求
  if (c.req.method === "OPTIONS") {
    const reqHeaders = c.req.header("access-control-request-headers")
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods":
          "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          reqHeaders || "Content-Type, Authorization, X-Setup-Secret, Accept",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin"
      }
    })
  }

  // 业务请求：继续下游路由并注入 CORS 头
  try {
    await next()
  } finally {
    c.header("Access-Control-Allow-Origin", origin)
    c.header("Access-Control-Allow-Credentials", "true")
    c.header("Vary", "Origin")
  }
}
