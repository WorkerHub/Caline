/**
 * 评论发表编辑器组件（原生 DOM，极简无多余说辞）。
 */

import type { AuthMe } from "@caline/shared"
import type { LocaleKey } from "../i18n/locales"
import { EMOJI_BASE_SET } from "../utils/emoji"
import { escapeHtml, renderMarkdownPreview } from "../utils/markdown"
import { getGuestProfile, saveGuestProfile } from "../utils/storage"

export interface EditorProps {
  t: (key: LocaleKey, params?: Record<string, string | number>) => string
  wordLimit?: number
  isGuestDisabled?: boolean
  isAllDisabled?: boolean
  serverUrl: string
  user?: AuthMe | null
  onLogout?: () => Promise<void> | void
  onSubmit: (data: {
    nick?: string
    mail?: string
    link?: string
    content: string
  }) => Promise<void>
  replyTarget?: {
    nick: string
    onCancel: () => void
  }
}

export function createEditor(props: EditorProps): HTMLElement {
  const container = document.createElement("div")
  container.className = "cl-editor-container"

  if (props.isAllDisabled) {
    container.innerHTML = `<div class="cl-login-notice">${props.t("all_closed")}</div>`
    return container
  }

  if (props.isGuestDisabled && !props.user) {
    container.innerHTML = `
      <div class="cl-login-notice">
        ${props.t("guest_closed")}
        <br>
        <a href="${props.serverUrl}/ui/login" target="_blank" class="cl-login-link">${props.t("login_to_comment")}</a>
      </div>
    `
    return container
  }

  const profile = getGuestProfile()
  const wordLimit = props.wordLimit || 1000

  let isPreview = false
  let showEmoji = false

  // 1. 回复提示条
  if (props.replyTarget) {
    const replyBar = document.createElement("div")
    replyBar.style.cssText =
      "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:12px;color:var(--cl-color-text-muted);"
    replyBar.innerHTML = `
      <span>${props.t("btn_reply")} <strong class="cl-at-user">@${escapeHtml(props.replyTarget.nick)}</strong></span>
      <button type="button" class="cl-action-btn cl-reply-cancel">${props.t("btn_cancel")}</button>
    `
    replyBar
      .querySelector(".cl-reply-cancel")
      ?.addEventListener("click", () => {
        props.replyTarget?.onCancel()
      })
    container.appendChild(replyBar)
  }

  let metaInputs: HTMLElement | null = null

  // 2. 身份区（登录态展示身份栏与退出按钮；访客态展示三件套与登录入口）
  if (props.user) {
    const displayName =
      props.user.displayName ||
      (props.user.email ? props.user.email.split("@")[0] : "") ||
      props.t("guest")

    const defaultAvatar =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2394a3b8'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E"
    const avatarUrl = props.user.avatar || defaultAvatar

    const identityBar = document.createElement("div")
    identityBar.className = "cl-editor-identity-bar"

    const userInfo = document.createElement("div")
    userInfo.className = "cl-editor-user-info"

    const avatarImg = document.createElement("img")
    avatarImg.className = "cl-avatar cl-editor-avatar"
    avatarImg.src = avatarUrl
    avatarImg.alt = displayName
    userInfo.appendChild(avatarImg)

    const noticeSpan = document.createElement("span")
    noticeSpan.className = "cl-editor-identity-notice"
    const rawNotice = props.t("posting_as", { name: displayName })
    noticeSpan.innerHTML = escapeHtml(rawNotice).replace(
      escapeHtml(displayName),
      `<strong class="cl-editor-user-name">${escapeHtml(displayName)}</strong>`
    )
    userInfo.appendChild(noticeSpan)

    identityBar.appendChild(userInfo)

    const logoutBtn = document.createElement("button")
    logoutBtn.type = "button"
    logoutBtn.className = "cl-action-btn cl-editor-logout-btn"
    logoutBtn.textContent = props.t("logout")
    logoutBtn.addEventListener("click", async () => {
      logoutBtn.disabled = true
      try {
        if (props.onLogout) {
          await props.onLogout()
        }
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : props.t("error_network")
        alert(msg)
      } finally {
        logoutBtn.disabled = false
      }
    })
    identityBar.appendChild(logoutBtn)

    container.appendChild(identityBar)
  } else {
    metaInputs = document.createElement("div")
    metaInputs.className = "cl-editor-meta-inputs"
    metaInputs.innerHTML = `
      <input type="text" class="cl-input cl-input-nick" placeholder="${props.t("placeholder_nick")}" value="${escapeHtml(profile.nick || "")}" required />
      <input type="email" class="cl-input cl-input-mail" placeholder="${props.t("placeholder_mail")}" value="${escapeHtml(profile.mail || "")}" />
      <input type="url" class="cl-input cl-input-link" placeholder="${props.t("placeholder_link")}" value="${escapeHtml(profile.link || "")}" />
      <a href="${props.serverUrl}/ui/login" target="_blank" rel="noopener" class="cl-login-link cl-editor-login-prompt" style="font-size:12px;display:inline-flex;align-items:center;text-decoration:none;padding:0 4px;color:var(--cl-color-text-muted);white-space:nowrap;">${props.t("login_prompt")}</a>
    `
    container.appendChild(metaInputs)
  }

  // 3. 文本域 / 预览区
  const textarea = document.createElement("textarea")
  textarea.className = "cl-textarea"
  textarea.placeholder = props.t("placeholder_content")

  const previewBox = document.createElement("div")
  previewBox.className = "cl-editor-preview"
  previewBox.style.display = "none"

  container.appendChild(textarea)
  container.appendChild(previewBox)

  // 4. 表情面板
  const emojiPanel = document.createElement("div")
  emojiPanel.className = "cl-emoji-panel"
  emojiPanel.style.display = "none"
  for (const emoji of EMOJI_BASE_SET) {
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "cl-emoji-btn"
    btn.textContent = emoji
    btn.addEventListener("click", () => {
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const val = textarea.value
      textarea.value = val.substring(0, start) + emoji + val.substring(end)
      textarea.focus()
      textarea.selectionStart = textarea.selectionEnd = start + emoji.length
      updateWordCount()
    })
    emojiPanel.appendChild(btn)
  }

  // 5. 底部工具条
  const footer = document.createElement("div")
  footer.className = "cl-editor-footer"

  const tools = document.createElement("div")
  tools.className = "cl-editor-tools"

  const emojiToggle = document.createElement("button")
  emojiToggle.type = "button"
  emojiToggle.className = "cl-tool-btn"
  emojiToggle.textContent = "😀"
  emojiToggle.addEventListener("click", () => {
    showEmoji = !showEmoji
    emojiPanel.style.display = showEmoji ? "grid" : "none"
    emojiToggle.classList.toggle("active", showEmoji)
  })

  const previewToggle = document.createElement("button")
  previewToggle.type = "button"
  previewToggle.className = "cl-tool-btn"
  previewToggle.textContent = props.t("btn_preview")
  previewToggle.addEventListener("click", () => {
    isPreview = !isPreview
    if (isPreview) {
      previewBox.innerHTML = renderMarkdownPreview(textarea.value)
      previewBox.style.display = "block"
      textarea.style.display = "none"
      previewToggle.classList.add("active")
    } else {
      previewBox.style.display = "none"
      textarea.style.display = "block"
      previewToggle.classList.remove("active")
    }
  })

  const wordLimitEl = document.createElement("span")
  wordLimitEl.className = "cl-word-limit"
  wordLimitEl.textContent = `0 / ${wordLimit}`

  function updateWordCount() {
    const len = textarea.value.length
    wordLimitEl.textContent = `${len} / ${wordLimit}`
    if (len > wordLimit) {
      wordLimitEl.classList.add("error")
      submitBtn.disabled = true
    } else {
      wordLimitEl.classList.remove("error")
      submitBtn.disabled = len === 0
    }
  }

  textarea.addEventListener("input", updateWordCount)

  tools.appendChild(emojiToggle)
  tools.appendChild(previewToggle)
  tools.appendChild(wordLimitEl)

  // 提交按钮
  const submitBtn = document.createElement("button")
  submitBtn.type = "button"
  submitBtn.className = "cl-btn cl-btn-primary"
  submitBtn.textContent = props.t("btn_submit")
  submitBtn.disabled = true

  submitBtn.addEventListener("click", async () => {
    let nick: string | undefined
    let mail: string | undefined
    let link: string | undefined

    if (!props.user) {
      const nickInput = metaInputs?.querySelector(
        ".cl-input-nick"
      ) as HTMLInputElement
      const mailInput = metaInputs?.querySelector(
        ".cl-input-mail"
      ) as HTMLInputElement
      const linkInput = metaInputs?.querySelector(
        ".cl-input-link"
      ) as HTMLInputElement

      nick = nickInput?.value.trim()
      mail = mailInput?.value.trim()
      link = linkInput?.value.trim()

      if (!nick) {
        alert(props.t("error_empty_nick"))
        nickInput?.focus()
        return
      }
    }

    const content = textarea.value.trim()

    if (!content) {
      alert(props.t("error_empty_content"))
      textarea.focus()
      return
    }

    // 仅在访客模式下记忆三件套
    if (!props.user && nick) {
      saveGuestProfile({ nick, mail, link })
    }

    submitBtn.disabled = true
    submitBtn.textContent = props.t("btn_submitting")

    try {
      await props.onSubmit({ nick, mail, link, content })
      textarea.value = ""
      updateWordCount()
      if (isPreview) {
        previewToggle.click()
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : props.t("error_network")
      alert(msg)
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = props.t("btn_submit")
    }
  })

  footer.appendChild(tools)
  footer.appendChild(submitBtn)
  container.appendChild(footer)
  container.appendChild(emojiPanel)

  return container
}
