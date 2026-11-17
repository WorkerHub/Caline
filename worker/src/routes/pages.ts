/**
 * 页面浏览量与 Reaction 接口（规格 §4、§7）。
 *
 * 统一 JSON 响应信封：成功 `{ data }`，失败 `{ error: { code, message } }`。
 */
import { Hono } from "hono"
import { incrementPageview, incrementReaction } from "../db/queries/counters"
import { calineError, calineSuccess, readJsonBody } from "../lib/http"
import { getTablePrefix } from "../lib/table-prefix"
import type {
  PageReactionInput,
  PageReactionResult,
  PageViewInput,
  PageViewResult
} from "@caline/shared"
import type { HonoEnv } from "../types"

export const pagesRoutes = new Hono<HonoEnv>()

pagesRoutes.post("/view", async (c) => {
  const body = await readJsonBody<PageViewInput>(c)
  const url = typeof body?.url === "string" ? body.url.trim() : ""
  if (!url) {
    return calineError(c, 400, "INVALID_URL", "Page url is required")
  }

  const prefix = getTablePrefix(c.env)
  const counter = await incrementPageview(c.env.DB, prefix, url)

  const result: PageViewResult = {
    url: counter.url,
    pageview: counter.pageview
  }
  return calineSuccess(c, result)
})

pagesRoutes.post("/reaction", async (c) => {
  const body = await readJsonBody<PageReactionInput>(c)
  const url = typeof body?.url === "string" ? body.url.trim() : ""
  if (!url) {
    return calineError(c, 400, "INVALID_URL", "Page url is required")
  }

  const type = Number(body?.type)
  if (!Number.isInteger(type) || type < 0 || type > 8) {
    return calineError(
      c,
      400,
      "INVALID_REACTION_TYPE",
      "Reaction type must be an integer between 0 and 8"
    )
  }

  const prefix = getTablePrefix(c.env)
  const counter = await incrementReaction(c.env.DB, prefix, url, type)

  const result: PageReactionResult = {
    url: counter.url,
    pageview: counter.pageview,
    reactions: {
      reaction0: counter.reaction0,
      reaction1: counter.reaction1,
      reaction2: counter.reaction2,
      reaction3: counter.reaction3,
      reaction4: counter.reaction4,
      reaction5: counter.reaction5,
      reaction6: counter.reaction6,
      reaction7: counter.reaction7,
      reaction8: counter.reaction8
    }
  }
  return calineSuccess(c, result)
})
