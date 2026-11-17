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
  el: string | HTMLElement
  serverURL: string
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
    const el =
      typeof options.el === "string"
        ? document.querySelector(options.el)
        : options.el
    if (!el) {
      throw new Error(`Caline: container '${options.el}' not found`)
    }
    this.container = el as HTMLElement
    this.serverUrl = options.serverURL.replace(/\/+$/, "")
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

// 导出独立挂件与工具函数
export { commentCount, pageview, reaction } from "./widgets/counters"
export { recentComments } from "./widgets/recent"

export const Caline = {
  init,
  commentCount,
  pageview,
  reaction,
  recentComments
}

// 全局挂载支持 (支持 <script src="/client/v1.js"> 直接挂到 window.Caline)
if (typeof window !== "undefined") {
  const g = window as unknown as Record<string, unknown>
  g.Caline = Caline
}

export default Caline
