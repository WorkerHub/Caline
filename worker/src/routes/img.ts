/**
 * 公开只读图片路由（GET /img/<key>）。
 * 规格约束：
 * - 经 worker 公开路由只读 GET /img/<key>；
 * - Referer 防盗链校验：Referer 为空放行，非空须为 oneboy.app 或 *.oneboy.app，否则 403；
 * - 长缓存 immutable；
 * - 支持 ETag 与 If-None-Match 304。
 */
import { Hono } from "hono"
import type { HonoEnv } from "../types"

export const imgRoutes = new Hono<HonoEnv>()

export function isAllowedReferer(referer: string | undefined | null): boolean {
  if (!referer?.trim()) {
    return true
  }
  try {
    const url = new URL(referer)
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "")
    return (
      hostname === "oneboy.app" ||
      (hostname.endsWith(".oneboy.app") &&
        hostname.length > ".oneboy.app".length)
    )
  } catch {
    return false
  }
}

function getMimeTypeByExt(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase()
  if (ext === "png") return "image/png"
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg"
  if (ext === "gif") return "image/gif"
  if (ext === "webp") return "image/webp"
  return "application/octet-stream"
}

function cleanEtag(etag: string): string {
  let cleaned = etag.trim()
  if (cleaned.startsWith("W/") || cleaned.startsWith("w/")) {
    cleaned = cleaned.slice(2).trim()
  }
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1)
  }
  return cleaned
}

function matchesIfNoneMatch(ifNoneMatchHeader: string, etag: string): boolean {
  const target = cleanEtag(etag)
  if (!target) return false
  const candidates = ifNoneMatchHeader.split(",").map((s) => s.trim())
  for (const candidate of candidates) {
    if (candidate === "*") return true
    if (cleanEtag(candidate) === target) return true
  }
  return false
}

imgRoutes.get("/*", async (c) => {
  const referer = c.req.header("referer") ?? c.req.header("referrer")
  if (!isAllowedReferer(referer)) {
    return c.text("Forbidden", 403)
  }

  const rawPath = c.req.path
  let key: string
  try {
    key = decodeURIComponent(rawPath.replace(/^\/img\/?/, ""))
  } catch {
    return c.text("Not Found", 404)
  }

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
    const clientIfNoneMatch = c.req.header("if-none-match")
    if (
      clientIfNoneMatch &&
      matchesIfNoneMatch(clientIfNoneMatch, object.httpEtag)
    ) {
      return new Response(null, { status: 304, headers })
    }
  }

  return new Response(object.body, {
    status: 200,
    headers
  })
})
