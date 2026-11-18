/**
 * Caline 评论区核心挂载入口（规格 §7、§6）。
 * - 原生 TS 单 bundle，无框架；
 * - 极简 UI，无冗余标语与说明文字；
 * - 样式通过 CSS 变量隔离，命名空间统一为 cl-。
 */

import { CalineApiClient } from "./api/client"
import { createEditor } from "./components/editor"
import { renderCommentTree } from "./components/comment-tree"
import { createTranslator, resolveLanguage } from "./i18n/locales"
import type { CommentPublicItem, CommentSortOrder } from "@caline/shared"
import { saveEditToken } from "./utils/storage"
import { commentCount, pageview, reaction } from "./widgets/counters"
import { recentComments } from "./widgets/recent"
import "./styles/theme.css"

export interface CalineInitOptions {
  el?: string | HTMLElement
  serverURL?: string
  path?: string
  lang?: string
  pageSize?: number
  wordLimit?: number
}

export class CalineWidget {
  private container: HTMLElement
  private serverUrl: string
  private path: string
  private client: CalineApiClient
  private pageSize: number
  private wordLimit: number
  private currentSort: CommentSortOrder = "newest"
  private currentPage = 1
  private totalPages = 1
  private totalComments = 0
  private comments: CommentPublicItem[] = []
  private t: ReturnType<typeof createTranslator>

  private editorContainer!: HTMLElement
  private treeContainer!: HTMLElement
  private countTitle!: HTMLElement
  private loadMoreBtn!: HTMLButtonElement

  constructor(options: CalineInitOptions) {
    let el = options.el
    if (!el) {
      if (typeof document !== "undefined") {
        el =
          document.querySelector<HTMLElement>("#caline") ||
          document.querySelector<HTMLElement>("#comments") ||
          document.querySelector<HTMLElement>("#waline") ||
          document.querySelector<HTMLElement>("[data-caline]") ||
          undefined
      }
    } else if (typeof el === "string" && typeof document !== "undefined") {
      el = document.querySelector<HTMLElement>(el) || undefined
    }

    if (!el) {
      throw new Error(
        `Caline: container '${options.el || "#caline"}' not found`
      )
    }
    this.container = el as HTMLElement
    this.container.dataset.calineInitialized = "true"

    let serverUrl = options.serverURL
    if (!serverUrl) {
      if (typeof window !== "undefined" && window.location?.origin) {
        serverUrl = window.location.origin
      } else {
        serverUrl = ""
      }
      if (typeof console !== "undefined" && console.warn) {
        console.warn(
          "[Caline] serverURL is not specified, falling back to location.origin:",
          serverUrl
        )
      }
    }
    this.serverUrl = (serverUrl || "").replace(/\/+$/, "")
    this.path =
      options.path ||
      (typeof window !== "undefined" ? window.location.pathname : "/")
    this.pageSize = options.pageSize || 10
    this.wordLimit = options.wordLimit || 1000

    const lang = resolveLanguage(options.lang)
    this.t = createTranslator(lang)
    this.client = new CalineApiClient(this.serverUrl)

    this.renderSkeleton()
    this.loadComments()
  }

  private renderSkeleton() {
    this.container.classList.add("cl-root")
    this.container.innerHTML = `
      <div class="cl-editor-slot"></div>
      <div class="cl-header">
        <div class="cl-count-title">0 ${this.t("comments_count")}</div>
        <div class="cl-sort-bar">
          <button type="button" class="cl-sort-btn active" data-sort="newest">${this.t("sort_newest")}</button>
          <button type="button" class="cl-sort-btn" data-sort="oldest">${this.t("sort_oldest")}</button>
          <button type="button" class="cl-sort-btn" data-sort="hottest">${this.t("sort_hottest")}</button>
        </div>
      </div>
      <div class="cl-tree-slot"></div>
      <div class="cl-load-more-wrap" style="display:none;">
        <button type="button" class="cl-btn cl-btn-secondary cl-btn-load-more">${this.t("load_more")}</button>
      </div>
    `

    this.editorContainer = this.container.querySelector(
      ".cl-editor-slot"
    ) as HTMLElement
    this.treeContainer = this.container.querySelector(
      ".cl-tree-slot"
    ) as HTMLElement
    this.countTitle = this.container.querySelector(
      ".cl-count-title"
    ) as HTMLElement
    this.loadMoreBtn = this.container.querySelector(
      ".cl-btn-load-more"
    ) as HTMLButtonElement

    // 绑定排序切换
    const sortBtns = this.container.querySelectorAll(".cl-sort-btn")
    for (const btn of sortBtns) {
      btn.addEventListener("click", () => {
        for (const b of sortBtns) b.classList.remove("active")
        btn.classList.add("active")
        const sort = btn.getAttribute("data-sort") as CommentSortOrder
        if (this.currentSort !== sort) {
          this.currentSort = sort
          this.currentPage = 1
          this.loadComments(true)
        }
      })
    }

    // 绑定加载更多
    this.loadMoreBtn.addEventListener("click", () => {
      if (this.currentPage < this.totalPages) {
        this.currentPage++
        this.loadComments(false)
      }
    })

    // 渲染主发表区
    this.renderMainEditor()
  }

  private renderMainEditor() {
    this.editorContainer.innerHTML = ""
    const editor = createEditor({
      t: this.t,
      wordLimit: this.wordLimit,
      serverUrl: this.serverUrl,
      onSubmit: async (data) => {
        const res = await this.client.createComment({
          url: this.path,
          content: data.content,
          nick: data.nick,
          mail: data.mail,
          link: data.link
        })

        // 若有下发访客 15 分钟编辑 token，记录到 localStorage
        if (res.editToken) {
          saveEditToken(res.comment.id, res.editToken)
        }

        // 重新拉取第一页以展现最新发布或待审提示
        this.currentPage = 1
        await this.loadComments(true)
      }
    })
    this.editorContainer.appendChild(editor)
  }

  private async loadComments(replace = true) {
    if (replace) {
      this.treeContainer.innerHTML = `<div class="cl-empty-state">${this.t("loading")}</div>`
    }

    try {
      const res = await this.client.listComments({
        url: this.path,
        page: this.currentPage,
        pageSize: this.pageSize,
        sort: this.currentSort
      })

      this.totalComments = res.total
      this.totalPages = res.totalPages
      this.countTitle.textContent = `${this.totalComments} ${this.t("comments_count")}`

      if (replace) {
        this.comments = res.items
      } else {
        this.comments = [...this.comments, ...res.items]
      }

      this.treeContainer.innerHTML = ""
      const tree = renderCommentTree({
        items: this.comments,
        t: this.t,
        onReply: (comment, rootId) => {
          this.showReplyEditor(comment, rootId)
        },
        onLike: async (id) => {
          const r = await this.client.likeComment(id)
          return r.likeCount
        },
        onUpdate: async (id, content, token) => {
          const r = await this.client.updateComment(id, { content }, token)
          return r.contentHtml
        },
        onDelete: async (id, token) => {
          await this.client.deleteComment(id, token)
          this.totalComments = Math.max(0, this.totalComments - 1)
          this.countTitle.textContent = `${this.totalComments} ${this.t("comments_count")}`
        }
      })
      this.treeContainer.appendChild(tree)

      const loadMoreWrap = this.container.querySelector(
        ".cl-load-more-wrap"
      ) as HTMLElement
      if (this.currentPage < this.totalPages) {
        loadMoreWrap.style.display = "block"
      } else {
        loadMoreWrap.style.display = "none"
      }
    } catch {
      this.treeContainer.innerHTML = `<div class="cl-empty-state">${this.t("error_network")}</div>`
    }
  }

  private showReplyEditor(
    comment: { id: number; nick: string },
    rootId: number
  ) {
    // 移除已有回复框
    const existing = this.treeContainer.querySelector(".cl-reply-editor-slot")
    if (existing) existing.remove()

    const targetEl = this.treeContainer.querySelector(
      `[data-id="${comment.id}"]`
    )
    if (!targetEl) return

    const replySlot = document.createElement("div")
    replySlot.className = "cl-reply-editor-slot"
    replySlot.style.marginTop = "8px"

    const editor = createEditor({
      t: this.t,
      wordLimit: this.wordLimit,
      serverUrl: this.serverUrl,
      replyTarget: {
        nick: comment.nick || this.t("guest"),
        onCancel: () => replySlot.remove()
      },
      onSubmit: async (data) => {
        const res = await this.client.createComment({
          url: this.path,
          content: data.content,
          pid: comment.id,
          rid: rootId,
          nick: data.nick,
          mail: data.mail,
          link: data.link
        })

        if (res.editToken) {
          saveEditToken(res.comment.id, res.editToken)
        }

        replySlot.remove()
        this.currentPage = 1
        await this.loadComments(true)
      }
    })

    replySlot.appendChild(editor)
    const contentWrap = targetEl.querySelector(".cl-content-wrap")
    if (contentWrap) {
      contentWrap.appendChild(replySlot)
    } else {
      targetEl.appendChild(replySlot)
    }
  }
}

export function init(options: CalineInitOptions): CalineWidget {
  return new CalineWidget(options)
}

function findCurrentScript(): HTMLScriptElement | null {
  if (typeof document === "undefined") return null
  if (
    document.currentScript &&
    document.currentScript instanceof HTMLScriptElement
  ) {
    return document.currentScript
  }
  const scripts = Array.from(
    document.querySelectorAll<HTMLScriptElement>("script")
  )
  for (let i = scripts.length - 1; i >= 0; i--) {
    const s = scripts[i]
    if (
      s.hasAttribute("data-server-url") ||
      s.hasAttribute("data-caline") ||
      (s.src && (s.src.includes("/client/v1.js") || s.src.includes("v1.js")))
    ) {
      return s
    }
  }
  return null
}

export function autoInit(): CalineWidget | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null
  }

  const globalConfig =
    (
      window as unknown as {
        CALINE_CONFIG?: Partial<CalineInitOptions>
      }
    ).CALINE_CONFIG || {}

  const script = findCurrentScript()
  const scriptDataset = script ? script.dataset : {}

  let serverURL =
    globalConfig.serverURL ||
    scriptDataset.serverUrl ||
    script?.getAttribute("data-server-url") ||
    ""

  if (!serverURL && script?.src) {
    try {
      const parsed = new URL(script.src, window.location.href)
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        serverURL = parsed.origin
      }
    } catch {
      // ignore
    }
  }

  let el: HTMLElement | null = null
  const targetSelector =
    globalConfig.el || scriptDataset.el || script?.getAttribute("data-el")

  if (targetSelector) {
    if (typeof targetSelector === "string") {
      el = document.querySelector<HTMLElement>(targetSelector)
    } else if (targetSelector instanceof HTMLElement) {
      el = targetSelector
    }
  } else {
    el =
      document.querySelector<HTMLElement>("#caline") ||
      document.querySelector<HTMLElement>("#comments") ||
      document.querySelector<HTMLElement>("#waline") ||
      document.querySelector<HTMLElement>("[data-caline]")
  }

  if (!serverURL && el?.getAttribute("data-server-url")) {
    serverURL = el.getAttribute("data-server-url") || ""
  }

  if (!serverURL) {
    serverURL = window.location.origin || ""
    if (typeof console !== "undefined" && console.warn) {
      console.warn(
        "[Caline] serverURL is not specified, falling back to location.origin:",
        serverURL
      )
    }
  }

  // 若仍没有容器，但脚本在 DOM 中，自动在 script 后插入 #caline 容器
  if (!el && script && script.parentNode) {
    const autoDiv = document.createElement("div")
    autoDiv.id = "caline"
    autoDiv.className = "caline-container"
    script.parentNode.insertBefore(autoDiv, script.nextSibling)
    el = autoDiv
  }

  if (!el) {
    return null
  }

  if (el.dataset.calineInitialized === "true") {
    return null
  }

  const path =
    globalConfig.path ||
    scriptDataset.path ||
    script?.getAttribute("data-path") ||
    el.getAttribute("data-path") ||
    undefined

  const lang =
    globalConfig.lang ||
    scriptDataset.lang ||
    script?.getAttribute("data-lang") ||
    el.getAttribute("data-lang") ||
    undefined

  const rawPageSize =
    globalConfig.pageSize ||
    scriptDataset.pageSize ||
    script?.getAttribute("data-page-size") ||
    el.getAttribute("data-page-size")
  const pageSize = rawPageSize ? Number(rawPageSize) : undefined

  const rawWordLimit =
    globalConfig.wordLimit ||
    scriptDataset.wordLimit ||
    script?.getAttribute("data-word-limit") ||
    el.getAttribute("data-word-limit")
  const wordLimit = rawWordLimit ? Number(rawWordLimit) : undefined

  const widget = init({
    el,
    serverURL,
    path,
    lang,
    pageSize,
    wordLimit
  })

  // 联动触发独立计数挂件自动填充
  if (serverURL) {
    if (document.querySelector("[data-caline-count]")) {
      commentCount({ serverURL }).catch(() => {})
    }
    if (document.querySelector("[data-caline-pageview]")) {
      pageview({ serverURL }).catch(() => {})
    }
  }

  return widget
}

export function scheduleAutoInit(): void {
  if (typeof document === "undefined") return

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        autoInit()
      },
      { once: true }
    )
  } else {
    autoInit()
  }
}

// 导出独立挂件与工具函数
export { commentCount, pageview, reaction } from "./widgets/counters"
export { recentComments } from "./widgets/recent"

export const Caline = {
  init,
  autoInit,
  scheduleAutoInit,
  commentCount,
  pageview,
  reaction,
  recentComments
}

// 全局挂载支持与自动初始化 (支持 <script src="/client/v1.js"> 直接一行 script 运作)
if (typeof window !== "undefined") {
  const g = window as unknown as Record<string, unknown>
  g.Caline = Caline
  scheduleAutoInit()
}

export default Caline
