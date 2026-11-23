/**
 * 公开只读图片路由（GET /img/<key>）。
 * 规格约束：
 * - 经 worker 公开路由只读 GET /img/<key>；
 * - 长缓存 immutable；
 * - 支持 ETag 与 If-None-Match 304。
 */
import { Hono } from "hono"
import type { HonoEnv } from "../types"

export const imgRoutes = new Hono<HonoEnv>()

function getMimeTypeByExt(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase()
  if (ext === "png") return "image/png"
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg"
  if (ext === "gif") return "image/gif"
  if (ext === "webp") return "image/webp"
  return "application/octet-stream"
}

imgRoutes.get("/*", async (c) => {
  const rawPath = c.req.path
  const key = decodeURIComponent(rawPath.replace(/^\/img\/?/, ""))
  if (!key || key.includes("..")) {
    return c.text("Not Found", 404)
  }

  if (!c.env.IMAGES) {
    return c.text("Storage not configured", 500)
  }

  const object = await c.env.IMAGES.get(key)
  if (!object) {
    return c.text("Not Found", 404)
  }

  const headers = new Headers()
  headers.set("Cache-Control", "public, max-age=31536000, immutable")
  headers.set("Access-Control-Allow-Origin", "*")

  const contentType = object.httpMetadata?.contentType || getMimeTypeByExt(key)
  headers.set("Content-Type", contentType)

  if (object.httpEtag) {
    headers.set("ETag", object.httpEtag)
    const clientEtag = c.req.header("if-none-match")
    if (clientEtag && clientEtag === object.httpEtag) {
      return new Response(null, { status: 304, headers })
    }
  }

  return new Response(object.body, {
    status: 200,
    headers
  })
})
