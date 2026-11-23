/**
 * 评论发表编辑器组件（原生 DOM，极简无多余说辞）。
 */

import type { AuthMe } from "@caline/shared"
import { CalineApiClient } from "../api/client"
import type { LocaleKey } from "../i18n/locales"
import {
  EMOJI_BASE_SET,
  EMOJI_GROUPS,
  fetchEmojiManifest,
  prefetchEmojiManifests,
  resolveEmojiImageUrl
} from "../utils/emoji"
import { escapeHtml, renderMarkdownPreview } from "../utils/markdown"
import { openLoginPopup } from "../utils/popup"
import { getGuestProfile, saveGuestProfile } from "../utils/storage"

const ICON_SEARCH =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="cl-icon"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>'
const ICON_IMAGE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="cl-icon"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path></svg>'

export interface EditorProps {
  t: (key: LocaleKey, params?: Record<string, string | number>) => string
  wordLimit?: number
  isGuestDisabled?: boolean
  isAllDisabled?: boolean
  serverUrl: string
  user?: AuthMe | null
  onLogout?: () => Promise<void> | void
  onLoginSuccess?: () => unknown
  onUpload?: (file: File, turnstileToken?: string) => Promise<{ url: string }>
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
        <a href="${props.serverUrl}/ui/login" target="_blank" rel="noopener" class="cl-login-link">${props.t("login_to_comment")}</a>
      </div>
    `
    const loginLink = container.querySelector(".cl-login-link")
    loginLink?.addEventListener("click", (e) => {
      e.preventDefault()
      openLoginPopup({
        serverUrl: props.serverUrl,
        onAuthRefresh: () => props.onLoginSuccess?.()
      })
    })
    return container
  }

  const profile = getGuestProfile()
  const wordLimit = props.wordLimit || 1000

  let isPreview = false
  let showEmoji = false
  let closeEmojiPanel = () => {}

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
        closeEmojiPanel()
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
    const loginPromptLink = metaInputs.querySelector(".cl-editor-login-prompt")
    loginPromptLink?.addEventListener("click", (e) => {
      e.preventDefault()
      openLoginPopup({
        serverUrl: props.serverUrl,
        onAuthRefresh: () => props.onLoginSuccess?.()
      })
    })
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

  function insertTextAtCursor(text: string) {
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const val = textarea.value
    textarea.value = val.substring(0, start) + text + val.substring(end)
    textarea.focus()
    textarea.selectionStart = textarea.selectionEnd = start + text.length
    updateWordCount()
  }

  // 4. 表情面板（分组切换 + 清单懒加载）
  const emojiPanel = document.createElement("div")
  emojiPanel.className = "cl-emoji-panel"
  emojiPanel.style.display = "none"

  const emojiTabs = document.createElement("div")
  emojiTabs.className = "cl-emoji-tabs"

  const emojiContent = document.createElement("div")
  emojiContent.className = "cl-emoji-content"

  let currentEmojiGroup = "default"
  let hasRenderedEmoji = false
  let emojiObserver: IntersectionObserver | null = null

  async function renderEmojiGroup(groupId: string) {
    if (emojiObserver) {
      emojiObserver.disconnect()
      emojiObserver = null
    }

    currentEmojiGroup = groupId
    const tabs = emojiTabs.querySelectorAll<HTMLButtonElement>(".cl-emoji-tab")
    for (const tab of tabs) {
      tab.classList.toggle("active", tab.getAttribute("data-group") === groupId)
    }

    emojiContent.innerHTML = ""

    if (groupId === "default") {
      const grid = document.createElement("div")
      grid.className = "cl-emoji-grid"
      for (const emoji of EMOJI_BASE_SET) {
        const btn = document.createElement("button")
        btn.type = "button"
        btn.className = "cl-emoji-btn"
        btn.textContent = emoji
        btn.addEventListener("click", () => {
          insertTextAtCursor(emoji)
        })
        grid.appendChild(btn)
      }
      emojiContent.appendChild(grid)
      return
    }

    const loadingEl = document.createElement("div")
    loadingEl.className = "cl-emoji-loading"
    loadingEl.textContent = props.t("loading")
    emojiContent.appendChild(loadingEl)

    try {
      const manifest = await fetchEmojiManifest(props.serverUrl, groupId)
      if (currentEmojiGroup !== groupId) return

      emojiContent.innerHTML = ""
      const grid = document.createElement("div")
      grid.className = "cl-emoji-grid"

      const hasObserver = typeof IntersectionObserver !== "undefined"
      if (hasObserver) {
        emojiObserver = new IntersectionObserver(
          (entries, observer) => {
            for (const entry of entries) {
              if (entry.isIntersecting) {
                const target = entry.target as HTMLImageElement
                if (target.dataset.src) {
                  target.src = target.dataset.src
                  delete target.dataset.src
                }
                observer.unobserve(target)
              }
            }
          },
          {
            root: grid,
            rootMargin: "50px"
          }
        )
      }

      for (const [name, relPath] of Object.entries(manifest)) {
        const btn = document.createElement("button")
        btn.type = "button"
        btn.className = "cl-emoji-btn cl-emoji-img-btn"
        btn.title = name
        btn.setAttribute("aria-label", name)

        const imgUrl = resolveEmojiImageUrl(props.serverUrl, groupId, relPath)
        const img = document.createElement("img")
        img.alt = name
        img.className = "cl-emoji-img"
        img.loading = "lazy"

        if (hasObserver && emojiObserver) {
          img.dataset.src = imgUrl
          emojiObserver.observe(img)
        } else {
          img.src = imgUrl
        }

        btn.appendChild(img)

        btn.addEventListener("click", () => {
          insertTextAtCursor(`:${groupId}_${name}:`)
        })
        grid.appendChild(btn)
      }
      emojiContent.appendChild(grid)
    } catch {
      if (currentEmojiGroup !== groupId) return
      emojiContent.innerHTML = `<div class="cl-emoji-error">${props.t("error_network")}</div>`
    }
  }

  for (const group of EMOJI_GROUPS) {
    const tabBtn = document.createElement("button")
    tabBtn.type = "button"
    tabBtn.className = `cl-emoji-tab${group.id === "default" ? " active" : ""}`
    tabBtn.setAttribute("data-group", group.id)
    tabBtn.textContent = props.t(group.nameKey)
    tabBtn.addEventListener("click", () => {
      if (currentEmojiGroup !== group.id) {
        void renderEmojiGroup(group.id)
      }
    })
    emojiTabs.appendChild(tabBtn)
  }

  emojiPanel.appendChild(emojiTabs)
  emojiPanel.appendChild(emojiContent)

  // 5. 底部工具条
  const footer = document.createElement("div")
  footer.className = "cl-editor-footer"

  const tools = document.createElement("div")
  tools.className = "cl-editor-tools"

  const emojiToggle = document.createElement("button")
  emojiToggle.type = "button"
  emojiToggle.className = "cl-tool-btn"
  emojiToggle.textContent = "😀"
  emojiToggle.title = props.t("emoji_panel")
  emojiToggle.setAttribute("aria-label", props.t("emoji_panel"))

  const triggerPrefetch = () => {
    void prefetchEmojiManifests(props.serverUrl)
  }
  emojiToggle.addEventListener("mouseenter", triggerPrefetch)
  emojiToggle.addEventListener("focus", triggerPrefetch)

  const handleOutsidePointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null
    if (!target) return
    if (emojiPanel.contains(target) || emojiToggle.contains(target)) {
      return
    }
    closeEmojiPanel()
  }

  function openEmojiPanel() {
    if (showEmoji) return
    showEmoji = true
    emojiPanel.style.display = "flex"
    emojiToggle.classList.add("active")
    if (!hasRenderedEmoji) {
      hasRenderedEmoji = true
      void renderEmojiGroup(currentEmojiGroup)
    }
    document.addEventListener("pointerdown", handleOutsidePointerDown)
  }

  closeEmojiPanel = () => {
    if (!showEmoji) return
    showEmoji = false
    emojiPanel.style.display = "none"
    emojiToggle.classList.remove("active")
    document.removeEventListener("pointerdown", handleOutsidePointerDown)
  }

  emojiToggle.addEventListener("click", () => {
    if (showEmoji) {
      closeEmojiPanel()
    } else {
      openEmojiPanel()
    }
  })

  // 图片上传按钮与隐藏文件选择框
  const fileInput = document.createElement("input")
  fileInput.type = "file"
  fileInput.accept = "image/*"
  fileInput.style.display = "none"
  container.appendChild(fileInput)

  const uploadStatusEl = document.createElement("span")
  uploadStatusEl.className = "cl-upload-status"
  uploadStatusEl.style.display = "none"

  const imageBtn = document.createElement("button")
  imageBtn.type = "button"
  imageBtn.className = "cl-tool-btn cl-tool-btn-image"
  imageBtn.title = props.t("btn_image")
  imageBtn.setAttribute("aria-label", props.t("btn_image"))
  imageBtn.innerHTML = ICON_IMAGE

  async function handleUpload(file: File, turnstileToken?: string) {
    imageBtn.disabled = true
    uploadStatusEl.style.display = "inline"
    uploadStatusEl.classList.remove("error")
    uploadStatusEl.textContent = props.t("uploading")

    try {
      let resUrl = ""
      if (props.onUpload) {
        const res =
          turnstileToken !== undefined
            ? await props.onUpload(file, turnstileToken)
            : await props.onUpload(file)
        resUrl = res.url
      } else {
        const client = new CalineApiClient(props.serverUrl)
        const res =
          turnstileToken !== undefined
            ? await client.uploadImage(file, turnstileToken)
            : await client.uploadImage(file)
        resUrl = res.url
      }

      let finalUrl = resUrl
      if (!finalUrl.startsWith("http://") && !finalUrl.startsWith("https://")) {
        if (finalUrl.startsWith("/")) {
          finalUrl = `${props.serverUrl}${finalUrl}`
        } else {
          finalUrl = `${props.serverUrl}/${finalUrl}`
        }
      }

      insertTextAtCursor(`![](${finalUrl})`)
      uploadStatusEl.style.display = "none"
      uploadStatusEl.textContent = ""
    } catch (err: unknown) {
      uploadStatusEl.classList.add("error")
      uploadStatusEl.textContent =
        err instanceof Error ? err.message : props.t("upload_failed")
    } finally {
      imageBtn.disabled = false
      fileInput.value = ""
    }
  }

  imageBtn.addEventListener("click", () => {
    fileInput.click()
  })

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0]
    if (file) {
      void handleUpload(file)
    }
  })

  textarea.addEventListener("paste", (e: ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type?.startsWith("image/")) {
        const file = item.getAsFile()
        if (file) {
          e.preventDefault()
          void handleUpload(file)
          break // 一次一张
        }
      }
    }
  })

  // 预览按钮（放大镜内联 SVG，尺寸风格与 emoji/图片按钮一致）
  const previewToggle = document.createElement("button")
  previewToggle.type = "button"
  previewToggle.className = "cl-tool-btn cl-tool-btn-preview"
  previewToggle.title = props.t("btn_preview")
  previewToggle.setAttribute("aria-label", props.t("btn_preview"))
  previewToggle.innerHTML = ICON_SEARCH
  previewToggle.addEventListener("click", () => {
    isPreview = !isPreview
    if (isPreview) {
      previewBox.innerHTML = renderMarkdownPreview(textarea.value, {
        serverUrl: props.serverUrl
      })
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
  tools.appendChild(imageBtn)
  tools.appendChild(previewToggle)
  tools.appendChild(wordLimitEl)
  tools.appendChild(uploadStatusEl)

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
      closeEmojiPanel()
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
