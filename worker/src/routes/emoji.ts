/**
 * 表情包清单路由（GET /emoji/<group>/manifest.json）。
 * 自托管表情包（qq, weibo, bilibili, douyin）。
 */
import { Hono } from "hono"
import { EMOJI_MANIFESTS } from "../data/emojis"
import type { HonoEnv } from "../types"

export const emojiRoutes = new Hono<HonoEnv>()

emojiRoutes.get("/:group/manifest.json", (c) => {
  const group = c.req.param("group")
  if (!Object.hasOwn(EMOJI_MANIFESTS, group)) {
    return c.json({ error: "Emoji group not found" }, 404)
  }

  const manifest = EMOJI_MANIFESTS[group]
  c.header("Cache-Control", "public, max-age=31536000, immutable")
  c.header("Access-Control-Allow-Origin", "*")
  return c.json(manifest)
})
