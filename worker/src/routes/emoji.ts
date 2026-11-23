/**
 * 表情包清单路由（GET /emoji/<group>/manifest.json）。
 * 自托管 @waline/emojis 1.2.0 三包（qq, weibo, bilibili）。
 */
import { Hono } from "hono"
import { EMOJI_MANIFESTS } from "../data/emojis"
import type { HonoEnv } from "../types"

export const emojiRoutes = new Hono<HonoEnv>()

emojiRoutes.get("/:group/manifest.json", (c) => {
  const group = c.req.param("group")
  const manifest = EMOJI_MANIFESTS[group]

  if (!manifest) {
    return c.json({ error: "Emoji group not found" }, 404)
  }

  c.header("Cache-Control", "public, max-age=31536000, immutable")
  c.header("Access-Control-Allow-Origin", "*")
  return c.json(manifest)
})
