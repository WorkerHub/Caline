/**
 * Caline 最近评论轻量独立挂件（规格 §7）。
 * - Caline.recentComments({ serverURL, el, count? })
 */

import { CalineApiClient } from "../api/client"
import { createTranslator, resolveLanguage } from "../i18n/locales"
import { escapeHtml, isSafeHttpUrl } from "../utils/markdown"

export interface RecentCommentsOptions {
  serverURL: string
  el: string | HTMLElement
  count?: number
  lang?: string
}

export async function recentComments(
  options: RecentCommentsOptions
): Promise<void> {
  const container =
    typeof options.el === "string"
      ? document.querySelector(options.el)
      : options.el
  if (!container) return

  const lang = resolveLanguage(options.lang)
  const t = createTranslator(lang)
  const client = new CalineApiClient(options.serverURL)

  container.innerHTML = `<div class="cl-recent-loading">${t("loading")}</div>`

  try {
    const items = await client.getRecentComments(options.count || 5)
    if (!items || items.length === 0) {
      container.innerHTML = `<div class="cl-recent-empty">${t("no_comments")}</div>`
      return
    }

    const html = items
      .map((item) => {
        const safeNick = escapeHtml(item.nick || t("guest"))
        const hasSafeLink = isSafeHttpUrl(item.link)
        const safeLink = hasSafeLink ? escapeHtml(item.link!.trim()) : ""
        const nickHtml = hasSafeLink
          ? `<a href="${safeLink}" target="_blank" rel="nofollow ugc noopener" class="cl-recent-nick">${safeNick}</a>`
          : `<span class="cl-recent-nick">${safeNick}</span>`

        return `
        <div class="cl-recent-item" data-id="${item.id}">
          <div class="cl-recent-avatar-wrap">
            <img src="${escapeHtml(item.avatar)}" alt="${safeNick}" class="cl-recent-avatar" loading="lazy" />
          </div>
          <div class="cl-recent-body">
            <div class="cl-recent-meta">
              ${nickHtml}
              <span class="cl-recent-time">${new Date(item.createdAt).toLocaleDateString()}</span>
            </div>
            <div class="cl-recent-content">
              ${item.contentHtml}
            </div>
          </div>
        </div>
      `
      })
      .join("")

    container.innerHTML = `<div class="cl-recent-list">${html}</div>`
  } catch (_err) {
    container.innerHTML = `<div class="cl-recent-error">${t("error_network")}</div>`
  }
}
