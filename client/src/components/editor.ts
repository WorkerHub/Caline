/**
 * 评论发表编辑器组件（原生 DOM，极简无多余说辞）。
 */

import type { LocaleKey } from "../i18n/locales"
import { EMOJI_BASE_SET } from "../utils/emoji"
import { renderMarkdownPreview } from "../utils/markdown"
import { getGuestProfile, saveGuestProfile } from "../utils/storage"

export interface EditorProps {
  t: (key: LocaleKey) => string
  wordLimit?: number
  isGuestDisabled?: boolean
  isAllDisabled?: boolean
  serverUrl: string
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

  if (props.isGuestDisabled) {
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
      <span>回复 <strong class="cl-at-user">@${props.replyTarget.nick}</strong></span>
      <button type="button" class="cl-action-btn cl-reply-cancel">${props.t("btn_cancel")}</button>
    `
    replyBar
      .querySelector(".cl-reply-cancel")
      ?.addEventListener("click", () => {
        props.replyTarget?.onCancel()
      })
    container.appendChild(replyBar)
  }

  // 2. 身份输入三件套与登录入口
  const metaInputs = document.createElement("div")
  metaInputs.className = "cl-editor-meta-inputs"
  metaInputs.innerHTML = `
    <input type="text" class="cl-input cl-input-nick" placeholder="${props.t("placeholder_nick")}" value="${profile.nick || ""}" required />
    <input type="email" class="cl-input cl-input-mail" placeholder="${props.t("placeholder_mail")}" value="${profile.mail || ""}" />
    <input type="url" class="cl-input cl-input-link" placeholder="${props.t("placeholder_link")}" value="${profile.link || ""}" />
    <a href="${props.serverUrl}/ui/login" target="_blank" rel="noopener" class="cl-login-link cl-editor-login-prompt" style="font-size:12px;display:inline-flex;align-items:center;text-decoration:none;padding:0 4px;color:var(--cl-color-text-muted);white-space:nowrap;">${props.t("login_prompt")}</a>
  `
  container.appendChild(metaInputs)

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
    const nickInput = metaInputs.querySelector(
      ".cl-input-nick"
    ) as HTMLInputElement
    const mailInput = metaInputs.querySelector(
      ".cl-input-mail"
    ) as HTMLInputElement
    const linkInput = metaInputs.querySelector(
      ".cl-input-link"
    ) as HTMLInputElement

    const nick = nickInput?.value.trim()
    const mail = mailInput?.value.trim()
    const link = linkInput?.value.trim()
    const content = textarea.value.trim()

    if (!nick) {
      alert(props.t("error_empty_nick"))
      nickInput?.focus()
      return
    }

    if (!content) {
      alert(props.t("error_empty_content"))
      textarea.focus()
      return
    }

    // 记忆三件套
    saveGuestProfile({ nick, mail, link })

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
