/**
 * Caline 独立轻量计数挂件：
 * 供博客列表页与文章页无缝调用（规格 §7）。
 * - Caline.commentCount({ serverURL, urls })
 * - Caline.pageview({ serverURL, url? })
 * - Caline.reaction({ serverURL, url?, type })
 */

import { CalineApiClient } from "../api/client"

export interface CommentCountOptions {
  serverURL: string
  urls?: string[]
  selector?: string // 默认 [data-caline-count]
}

export async function commentCount(
  options: CommentCountOptions
): Promise<Record<string, number>> {
  const client = new CalineApiClient(options.serverURL)
  const selector = options.selector || "[data-caline-count]"
  const elements =
    typeof document !== "undefined"
      ? Array.from(document.querySelectorAll(selector))
      : []

  let queryUrls = options.urls || []
  if (queryUrls.length === 0 && elements.length > 0) {
    queryUrls = elements
      .map(
        (el) =>
          el.getAttribute("data-caline-count") ||
          el.getAttribute("data-path") ||
          ""
      )
      .filter(Boolean)
  }

  if (queryUrls.length === 0) return {}

  const counts = await client.getCommentCounts(queryUrls)

  for (const el of elements) {
    const path =
      el.getAttribute("data-caline-count") || el.getAttribute("data-path") || ""
    if (path && counts[path] !== undefined) {
      el.textContent = String(counts[path])
    }
  }

  return counts
}

export interface PageviewOptions {
  serverURL: string
  url?: string
  selector?: string // 默认 [data-caline-pageview]
}

export async function pageview(options: PageviewOptions): Promise<number> {
  const client = new CalineApiClient(options.serverURL)
  const targetUrl =
    options.url ||
    (typeof window !== "undefined" ? window.location.pathname : "")
  if (!targetUrl) return 0

  const res = await client.postView({ url: targetUrl })

  const selector = options.selector || "[data-caline-pageview]"
  if (typeof document !== "undefined") {
    const elements = document.querySelectorAll(selector)
    for (const el of elements) {
      const elPath = el.getAttribute("data-path") || targetUrl
      if (elPath === targetUrl) {
        el.textContent = String(res.pageview)
      }
    }
  }

  return res.pageview
}

export interface ReactionOptions {
  serverURL: string
  type: number
  url?: string
}

export async function reaction(options: ReactionOptions) {
  const client = new CalineApiClient(options.serverURL)
  const targetUrl =
    options.url ||
    (typeof window !== "undefined" ? window.location.pathname : "")
  if (!targetUrl) return null

  return client.postReaction({ url: targetUrl, type: options.type })
}
