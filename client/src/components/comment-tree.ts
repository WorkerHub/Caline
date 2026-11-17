/**
 * 评论树渲染与单条交互组件（原生 DOM，极简风格）。
 */

import type { CommentPublicItem, CommentPublicReplyItem } from "@caline/shared"
import type { LocaleKey } from "../i18n/locales"
import { escapeHtml, isSafeHttpUrl } from "../utils/markdown"
import {
  getEditToken,
  isCommentLiked,
  markCommentLiked,
  removeEditToken
} from "../utils/storage"

export interface CommentTreeProps {
  items: CommentPublicItem[]
  t: (key: LocaleKey) => string
  onReply: (
    comment: CommentPublicItem | CommentPublicReplyItem,
    rootId: number
  ) => void
  onLike: (id: number) => Promise<number>
  onUpdate: (id: number, content: string, token: string) => Promise<string>
  onDelete: (id: number, token: string) => Promise<void>
}

export function renderCommentTree(props: CommentTreeProps): HTMLElement {
  const container = document.createElement("div")
  container.className = "cl-tree-container"

  if (props.items.length === 0) {
    container.innerHTML = `<div class="cl-empty-state">${props.t("no_comments")}</div>`
    return container
  }

  for (const item of props.items) {
    const rootEl = renderRootComment(item, props)
    container.appendChild(rootEl)
  }

  return container
}

function renderRootComment(
  item: CommentPublicItem,
  props: CommentTreeProps
): HTMLElement {
  const root = document.createElement("div")
  root.className = "cl-item"
  root.dataset.id = String(item.id)

  const editToken = getEditToken(item.id)
  const isLiked = isCommentLiked(item.id)

  const safeNick = escapeHtml(item.nick || props.t("guest"))
  const hasSafeLink = isSafeHttpUrl(item.link)
  const safeLink = hasSafeLink ? escapeHtml(item.link!.trim()) : ""
  const nickHtml = hasSafeLink
    ? `<a href="${safeLink}" target="_blank" rel="nofollow ugc noopener" class="cl-nick">${safeNick}</a>`
    : `<span class="cl-nick">${safeNick}</span>`

  const stickyHtml = item.sticky
    ? `<span class="cl-sticky-tag">${props.t("sticky")}</span>`
    : ""
  const badgeHtml = item.badge
    ? `<span class="cl-badge">${escapeHtml(item.badge)}</span>`
    : ""
  const levelHtml =
    item.level !== undefined
      ? `<span class="cl-badge">Lv.${item.level}</span>`
      : ""

  const timeStr = new Date(item.createdAt).toLocaleDateString()

  root.innerHTML = `
    <div class="cl-avatar-wrap">
      <img src="${escapeHtml(item.avatar)}" alt="${safeNick}" class="cl-avatar" loading="lazy" />
    </div>
    <div class="cl-content-wrap">
      <div class="cl-meta-line">
        ${nickHtml}
        ${stickyHtml}
        ${badgeHtml}
        ${levelHtml}
        <span class="cl-time">${timeStr}</span>
      </div>
      <div class="cl-comment-text">${item.contentHtml}</div>
      <div class="cl-actions">
        <button type="button" class="cl-action-btn cl-btn-like ${isLiked ? "cl-liked" : ""}">
          ${isLiked ? props.t("liked") : props.t("like")} (${item.likeCount})
        </button>
        <button type="button" class="cl-action-btn cl-btn-reply">${props.t("btn_reply")}</button>
        ${editToken ? `<button type="button" class="cl-action-btn cl-btn-edit">${props.t("btn_edit")}</button>` : ""}
        ${editToken ? `<button type="button" class="cl-action-btn cl-btn-delete">${props.t("btn_delete")}</button>` : ""}
      </div>
      <div class="cl-replies-list"></div>
    </div>
  `

  // 绑定点赞
  const likeBtn = root.querySelector(".cl-btn-like") as HTMLButtonElement
  likeBtn?.addEventListener("click", async () => {
    if (isCommentLiked(item.id)) return
    try {
      const newCount = await props.onLike(item.id)
      markCommentLiked(item.id)
      likeBtn.classList.add("cl-liked")
      likeBtn.textContent = `${props.t("liked")} (${newCount})`
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : props.t("error_network"))
    }
  })

  // 绑定回复
  const replyBtn = root.querySelector(".cl-btn-reply") as HTMLButtonElement
  replyBtn?.addEventListener("click", () => {
    props.onReply(item, item.id)
  })

  // 绑定编辑/删除（15 分钟访客编辑）
  if (editToken) {
    bindEditActions(root, item.id, item.contentHtml, editToken, props)
  }

  // 渲染子回复（平铺挂载）
  const repliesContainer = root.querySelector(".cl-replies-list") as HTMLElement
  if (item.replies && item.replies.length > 0) {
    for (const reply of item.replies) {
      const replyEl = renderReplyComment(reply, item.id, props)
      repliesContainer.appendChild(replyEl)
    }
  }

  return root
}

function renderReplyComment(
  reply: CommentPublicReplyItem,
  rootId: number,
  props: CommentTreeProps
): HTMLElement {
  const el = document.createElement("div")
  el.className = "cl-reply-item"
  el.dataset.id = String(reply.id)

  const editToken = getEditToken(reply.id)
  const isLiked = isCommentLiked(reply.id)

  const safeNick = escapeHtml(reply.nick || props.t("guest"))
  const hasSafeLink = isSafeHttpUrl(reply.link)
  const safeLink = hasSafeLink ? escapeHtml(reply.link!.trim()) : ""
  const nickHtml = hasSafeLink
    ? `<a href="${safeLink}" target="_blank" rel="nofollow ugc noopener" class="cl-nick">${safeNick}</a>`
    : `<span class="cl-nick">${safeNick}</span>`

  const badgeHtml = reply.badge
    ? `<span class="cl-badge">${escapeHtml(reply.badge)}</span>`
    : ""
  const levelHtml =
    reply.level !== undefined
      ? `<span class="cl-badge">Lv.${reply.level}</span>`
      : ""
  const timeStr = new Date(reply.createdAt).toLocaleDateString()

  const replyToHtml = reply.replyTo
    ? `<span class="cl-at-user">@${escapeHtml(reply.replyTo.nick)}</span>`
    : ""

  el.innerHTML = `
    <div class="cl-avatar-wrap">
      <img src="${escapeHtml(reply.avatar)}" alt="${safeNick}" class="cl-reply-avatar" loading="lazy" />
    </div>
    <div class="cl-content-wrap">
      <div class="cl-meta-line">
        ${nickHtml}
        ${badgeHtml}
        ${levelHtml}
        <span class="cl-time">${timeStr}</span>
      </div>
      <div class="cl-comment-text">${replyToHtml}${reply.contentHtml}</div>
      <div class="cl-actions">
        <button type="button" class="cl-action-btn cl-btn-like ${isLiked ? "cl-liked" : ""}">
          ${isLiked ? props.t("liked") : props.t("like")} (${reply.likeCount})
        </button>
        <button type="button" class="cl-action-btn cl-btn-reply">${props.t("btn_reply")}</button>
        ${editToken ? `<button type="button" class="cl-action-btn cl-btn-edit">${props.t("btn_edit")}</button>` : ""}
        ${editToken ? `<button type="button" class="cl-action-btn cl-btn-delete">${props.t("btn_delete")}</button>` : ""}
      </div>
    </div>
  `

  const likeBtn = el.querySelector(".cl-btn-like") as HTMLButtonElement
  likeBtn?.addEventListener("click", async () => {
    if (isCommentLiked(reply.id)) return
    try {
      const newCount = await props.onLike(reply.id)
      markCommentLiked(reply.id)
      likeBtn.classList.add("cl-liked")
      likeBtn.textContent = `${props.t("liked")} (${newCount})`
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : props.t("error_network"))
    }
  })

  const replyBtn = el.querySelector(".cl-btn-reply") as HTMLButtonElement
  replyBtn?.addEventListener("click", () => {
    props.onReply(reply, rootId)
  })

  if (editToken) {
    bindEditActions(el, reply.id, reply.contentHtml, editToken, props)
  }

  return el
}

function bindEditActions(
  root: HTMLElement,
  commentId: number,
  _contentHtml: string,
  token: string,
  props: CommentTreeProps
) {
  const editBtn = root.querySelector(".cl-btn-edit")
  const deleteBtn = root.querySelector(".cl-btn-delete")
  const textContainer = root.querySelector(".cl-comment-text") as HTMLElement

  editBtn?.addEventListener("click", () => {
    // 检查 15 分钟窗口
    const currentToken = getEditToken(commentId)
    if (!currentToken) {
      alert(props.t("edit_expired"))
      editBtn.remove()
      deleteBtn?.remove()
      return
    }

    const editArea = document.createElement("div")
    editArea.style.marginTop = "8px"

    const textarea = document.createElement("textarea")
    textarea.className = "cl-textarea"
    textarea.style.minHeight = "60px"
    textarea.value = (textContainer.textContent || "").trim()

    const btnRow = document.createElement("div")
    btnRow.style.cssText = "display:flex;gap:8px;margin-top:6px;"
    btnRow.innerHTML = `
      <button type="button" class="cl-btn cl-btn-primary cl-edit-save">${props.t("btn_save")}</button>
      <button type="button" class="cl-btn cl-btn-secondary cl-edit-cancel">${props.t("btn_cancel")}</button>
    `

    editArea.appendChild(textarea)
    editArea.appendChild(btnRow)

    const origDisplay = textContainer.style.display
    textContainer.style.display = "none"
    textContainer.parentNode?.insertBefore(editArea, textContainer.nextSibling)

    editArea.querySelector(".cl-edit-cancel")?.addEventListener("click", () => {
      editArea.remove()
      textContainer.style.display = origDisplay
    })

    editArea
      .querySelector(".cl-edit-save")
      ?.addEventListener("click", async () => {
        const val = textarea.value.trim()
        if (!val) return

        try {
          const newHtml = await props.onUpdate(commentId, val, token)
          textContainer.innerHTML = newHtml
          editArea.remove()
          textContainer.style.display = origDisplay
        } catch (err: unknown) {
          alert(err instanceof Error ? err.message : props.t("edit_expired"))
        }
      })
  })

  deleteBtn?.addEventListener("click", async () => {
    const currentToken = getEditToken(commentId)
    if (!currentToken) {
      alert(props.t("edit_expired"))
      editBtn?.remove()
      deleteBtn.remove()
      return
    }

    if (!confirm(props.t("delete_confirm"))) return

    try {
      await props.onDelete(commentId, token)
      removeEditToken(commentId)
      root.remove()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : props.t("edit_expired"))
    }
  })
}
