import { describe, expect, it, beforeEach, vi } from "vitest"
import type { AuthMe } from "@caline/shared"
import { resolveLanguage, createTranslator } from "../src/i18n/locales"
import { renderMarkdownPreview, isSafeHttpUrl } from "../src/utils/markdown"
import {
  getGuestProfile,
  saveGuestProfile,
  getEditToken,
  saveEditToken,
  removeEditToken,
  isCommentLiked,
  markCommentLiked
} from "../src/utils/storage"
import { CalineApiClient } from "../src/api/client"
import { commentCount, pageview } from "../src/widgets/counters"
import { renderCommentTree } from "../src/components/comment-tree"
import { createEditor } from "../src/components/editor"
import {
  Caline,
  CALINE_VERSION,
  init,
  autoInit,
  scheduleAutoInit,
  type CalineInitOptions
} from "../src/index"
import { openLoginPopup } from "../src/utils/popup"
import {
  EMOJI_GROUPS,
  clearEmojiCache,
  fetchEmojiManifest,
  resolveEmojiImageUrl
} from "../src/utils/emoji"

describe("Caline Client Widget", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  describe("i18n locales", () => {
    it("resolves language and falls back to zh-CN", () => {
      expect(resolveLanguage("zh-CN")).toBe("zh-CN")
      expect(resolveLanguage("zh-TW")).toBe("zh-CN")
      expect(resolveLanguage("en-US")).toBe("en")
      expect(resolveLanguage("fr")).toBe("zh-CN") // fallback

      const tEn = createTranslator("en")
      expect(tEn("btn_submit")).toBe("Submit")

      const tZh = createTranslator("zh-CN")
      expect(tZh("btn_submit")).toBe("发表评论")
    })
  })

  describe("Markdown preview parser (minimal subset & XSS prevention)", () => {
    it("escapes html entities completely", () => {
      const malicious =
        '<script>alert("xss")</script><img src=x onerror=alert(1)>'
      const html = renderMarkdownPreview(malicious)
      expect(html).not.toContain("<script>")
      expect(html).not.toContain("<img")
      expect(html).toContain("&lt;script&gt;")
      expect(html).toContain("&lt;img")
    })

    it("filters javascript: and data: pseudo protocols in links", () => {
      const badLink1 = "[click](javascript:alert(1))"
      const badLink2 =
        "[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"
      const safeLink = "[github](https://github.com)"

      expect(renderMarkdownPreview(badLink1)).toContain('href="#"')
      expect(renderMarkdownPreview(badLink2)).toContain('href="#"')
      expect(renderMarkdownPreview(safeLink)).toContain(
        'href="https://github.com"'
      )
    })

    it("renders code blocks, inline code, bold, italic, quotes, and @user mentions", () => {
      const md = `
> a quote
Hello **world** and *italic*
Here is \`const a = 1\`
\`\`\`js
console.log("hello")
\`\`\`
Reply to @alice and @bob
`
      const html = renderMarkdownPreview(md)
      expect(html).toContain(
        '<blockquote class="cl-blockquote">a quote</blockquote>'
      )
      expect(html).toContain("<strong>world</strong>")
      expect(html).toContain("<em>italic</em>")
      expect(html).toContain('<code class="cl-inline-code">const a = 1</code>')
      expect(html).toContain(
        '<pre class="cl-code-block"><code class="language-js">console.log(&quot;hello&quot;)</code></pre>'
      )
      expect(html).toContain('<span class="cl-at-user">@alice</span>')
      expect(html).toContain('<span class="cl-at-user">@bob</span>')
    })
  })

  describe("Local storage: guest profile and 15m edit tokens", () => {
    it("saves and retrieves guest profile", () => {
      saveGuestProfile({
        nick: "Tester",
        mail: "test@example.com",
        link: "https://test.com"
      })
      const profile = getGuestProfile()
      expect(profile.nick).toBe("Tester")
      expect(profile.mail).toBe("test@example.com")
      expect(profile.link).toBe("https://test.com")
    })

    it("manages 15-minute edit token with expiration check", () => {
      const commentId = 123
      saveEditToken(commentId, "secret_token_123")
      expect(getEditToken(commentId)).toBe("secret_token_123")

      // 模拟 16 分钟后
      const origNow = Date.now
      try {
        Date.now = () => origNow() + 16 * 60 * 1000
        expect(getEditToken(commentId)).toBeNull()
      } finally {
        Date.now = origNow
      }

      // 显式删除
      saveEditToken(456, "token_456")
      expect(getEditToken(456)).toBe("token_456")
      removeEditToken(456)
      expect(getEditToken(456)).toBeNull()
    })

    it("tracks liked comments", () => {
      expect(isCommentLiked(99)).toBe(false)
      markCommentLiked(99)
      expect(isCommentLiked(99)).toBe(true)
    })
  })

  describe("API client contract binding", () => {
    it("calls listComments and unwraps ApiSuccess envelope", async () => {
      const client = new CalineApiClient("https://example.com")

      const mockResponse = {
        data: {
          items: [],
          total: 0,
          page: 1,
          pageSize: 10,
          totalPages: 0
        }
      }

      window.fetch = vi.fn().mockResolvedValue({
        json: async () => mockResponse
      }) as unknown as typeof fetch

      const result = await client.listComments({ url: "/post/1" })
      expect(result.total).toBe(0)
      expect(window.fetch).toHaveBeenCalledWith(
        "https://example.com/api/comments?url=%2Fpost%2F1",
        expect.objectContaining({ credentials: "include" })
      )
    })

    it("handles error envelope and throws", async () => {
      const client = new CalineApiClient("https://example.com")
      window.fetch = vi.fn().mockResolvedValue({
        json: async () => ({
          error: {
            code: "FORBIDDEN",
            message: "Edit window expired"
          }
        })
      }) as unknown as typeof fetch

      await expect(
        client.updateComment(1, { content: "new" }, "token")
      ).rejects.toThrow("Edit window expired")
    })
  })

  describe("Widgets: commentCount and pageview", () => {
    it("fills [data-caline-count] DOM elements", async () => {
      document.body.innerHTML = `
        <span data-caline-count="/p/1"></span>
        <span data-caline-count="/p/2"></span>
      `

      window.fetch = vi.fn().mockResolvedValue({
        json: async () => ({
          data: {
            "/p/1": 5,
            "/p/2": 12
          }
        })
      }) as unknown as typeof fetch

      const res = await commentCount({ serverURL: "https://example.com" })
      expect(res["/p/1"]).toBe(5)
      expect(
        document.querySelector('[data-caline-count="/p/1"]')?.textContent
      ).toBe("5")
      expect(
        document.querySelector('[data-caline-count="/p/2"]')?.textContent
      ).toBe("12")
    })

    it("reports pageview and fills [data-caline-pageview]", async () => {
      document.body.innerHTML = `
        <span data-caline-pageview data-path="/p/1"></span>
      `

      window.fetch = vi.fn().mockResolvedValue({
        json: async () => ({
          data: {
            url: "/p/1",
            pageview: 1024
          }
        })
      }) as unknown as typeof fetch

      const count = await pageview({
        serverURL: "https://example.com",
        url: "/p/1"
      })
      expect(count).toBe(1024)
      expect(
        document.querySelector("[data-caline-pageview]")?.textContent
      ).toBe("1024")
    })
  })

  describe("Security fixes & reviewer items", () => {
    it("isSafeHttpUrl validates protocols properly", () => {
      expect(isSafeHttpUrl("https://example.com")).toBe(true)
      expect(isSafeHttpUrl("http://example.com")).toBe(true)
      expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false)
      expect(isSafeHttpUrl("data:text/html,abc")).toBe(false)
      expect(isSafeHttpUrl("vbscript:msgbox(1)")).toBe(false)
      expect(isSafeHttpUrl(undefined)).toBe(false)
    })

    it("prevents DOM XSS when editing comment with malicious content", async () => {
      saveEditToken(1, "token_1")
      const t = createTranslator("zh-CN")
      const tree = renderCommentTree({
        items: [
          {
            id: 1,
            userId: null,
            nick: "Attacker",
            avatar: "avatar.png",
            link: "javascript:alert(1)",
            url: "/p/1",
            contentHtml:
              "&lt;/textarea&gt;&lt;script&gt;window.__xss=1&lt;/script&gt;",
            sticky: false,
            likeCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            replies: []
          }
        ],
        t,
        onReply: vi.fn(),
        onLike: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn()
      })

      document.body.appendChild(tree)

      // 验证 link: javascript: 不被渲染为可点击超链接，而是 <span>
      const nickLink = tree.querySelector('a[href^="javascript:"]')
      expect(nickLink).toBeNull()
      expect(tree.querySelector(".cl-nick")?.tagName.toLowerCase()).toBe("span")

      // 验证点击编辑时不会将内容直接拼接进 innerHTML 导致 textarea 逃逸
      const editBtn = tree.querySelector(".cl-btn-edit") as HTMLButtonElement
      editBtn.click()

      expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
      const textarea = tree.querySelector(".cl-textarea") as HTMLTextAreaElement
      expect(textarea.value).toContain("</textarea><script>")
      tree.remove()
    })

    it("renders login prompt in normal editor", () => {
      const t = createTranslator("zh-CN")
      const editor = createEditor({
        t,
        serverUrl: "https://example.com",
        onSubmit: vi.fn()
      })
      const loginLink = editor.querySelector(".cl-editor-login-prompt")
      expect(loginLink).not.toBeNull()
      expect(loginLink?.getAttribute("href")).toBe(
        "https://example.com/ui/login"
      )
      expect(loginLink?.textContent).toBe(t("login_prompt"))
    })
  })

  describe("Auto-initialization and script embedding (§12 一行 script 即工作)", () => {
    beforeEach(() => {
      document.body.innerHTML = ""
      delete (window as unknown as { CALINE_CONFIG?: unknown }).CALINE_CONFIG
      window.fetch = vi.fn().mockResolvedValue({
        json: async () => ({
          data: {
            items: [],
            total: 0,
            page: 1,
            pageSize: 10,
            totalPages: 0
          }
        })
      }) as unknown as typeof fetch
    })

    it("Caline global exports all expected methods and autoInit hook", () => {
      expect(typeof Caline.init).toBe("function")
      expect(typeof Caline.autoInit).toBe("function")
      expect(typeof Caline.scheduleAutoInit).toBe("function")
      expect(typeof Caline.commentCount).toBe("function")
      expect(typeof Caline.pageview).toBe("function")
      expect(typeof Caline.reaction).toBe("function")
      expect(typeof Caline.recentComments).toBe("function")
      expect((window as unknown as { Caline: unknown }).Caline).toBe(Caline)
    })

    it("Caline.init gracefully falls back to location.origin when serverURL is omitted", () => {
      document.body.innerHTML = '<div id="caline"></div>'
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

      const widget = init({ el: "#caline" } as CalineInitOptions)
      expect(widget).toBeDefined()
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Caline] serverURL is not specified"),
        expect.any(String)
      )
      expect(
        document.querySelector("#caline")?.classList.contains("cl-root")
      ).toBe(true)
    })

    it("Caline.init auto-detects container #comments when el is omitted", () => {
      document.body.innerHTML = '<div id="comments"></div>'
      const widget = init({ serverURL: "https://example.com" })
      expect(widget).toBeDefined()
      expect(
        document.querySelector("#comments")?.classList.contains("cl-root")
      ).toBe(true)
    })

    it("Caline.init container fallback excludes <script data-caline> and throws if no valid container exists", () => {
      document.body.innerHTML = `
        <script data-caline src="https://caline.example.com/client/v1.js"></script>
      `
      expect(() => init({ serverURL: "https://example.com" })).toThrow(
        "Caline: container '#caline' not found"
      )
      const scriptTag = document.querySelector("script")
      expect(scriptTag?.classList.contains("cl-root")).toBe(false)
    })

    it("Caline.init container fallback matches <div data-caline> while ignoring <script data-caline>", () => {
      document.body.innerHTML = `
        <script data-caline src="https://caline.example.com/client/v1.js"></script>
        <div data-caline id="real-container"></div>
      `
      const widget = init({ serverURL: "https://example.com" })
      expect(widget).toBeDefined()
      const realContainer = document.querySelector("#real-container")
      expect(realContainer?.classList.contains("cl-root")).toBe(true)
      const scriptTag = document.querySelector("script")
      expect(scriptTag?.classList.contains("cl-root")).toBe(false)
    })

    it("autoInit reads data attributes from script tag and mounts to container", () => {
      document.body.innerHTML = `
        <div id="my-comments"></div>
        <script src="https://caline.example.com/client/v1.js"
          data-server-url="https://caline.example.com"
          data-el="#my-comments"
          data-path="/blog/p1"
          data-lang="en"></script>
      `

      const widget = autoInit()
      expect(widget).not.toBeNull()
      const container = document.querySelector("#my-comments")
      expect(container?.classList.contains("cl-root")).toBe(true)
      expect(container?.getAttribute("data-caline-initialized")).toBe("true")
      expect(container?.querySelector(".cl-btn-primary")?.textContent).toBe(
        "Submit"
      )
    })

    it("supports 'one line script works' by automatically creating #caline container", () => {
      document.body.innerHTML = `
        <main>
          <h1>Blog Post</h1>
          <script src="https://caline.example.com/client/v1.js" data-server-url="https://caline.example.com"></script>
        </main>
      `

      const widget = autoInit()
      expect(widget).not.toBeNull()
      const generatedContainer = document.querySelector("#caline")
      expect(generatedContainer).not.toBeNull()
      expect(generatedContainer?.classList.contains("cl-root")).toBe(true)
      expect(generatedContainer?.getAttribute("data-caline-initialized")).toBe(
        "true"
      )
    })

    it("autoInit handles <script data-caline> without explicit container by inserting #caline div without crashing", () => {
      document.body.innerHTML = `
        <main>
          <h1>Article Title</h1>
          <script src="https://caline.example.com/client/v1.js" data-caline></script>
        </main>
      `

      const widget = autoInit()
      expect(widget).not.toBeNull()
      const scriptTag = document.querySelector("script")
      expect(scriptTag?.classList.contains("cl-root")).toBe(false)
      const insertedDiv = scriptTag?.nextElementSibling as HTMLElement
      expect(insertedDiv).not.toBeNull()
      expect(insertedDiv.id).toBe("caline")
      expect(insertedDiv.classList.contains("cl-root")).toBe(true)
      expect(insertedDiv.getAttribute("data-caline-initialized")).toBe("true")
    })

    it("autoInit handles <script data-caline data-server-url> without explicit container without crashing", () => {
      document.body.innerHTML = `
        <main>
          <h1>Article Title</h1>
          <script src="https://caline.example.com/client/v1.js" data-caline data-server-url="https://caline.example.com"></script>
        </main>
      `

      const widget = autoInit()
      expect(widget).not.toBeNull()
      const scriptTag = document.querySelector("script")
      expect(scriptTag?.classList.contains("cl-root")).toBe(false)
      const insertedDiv = scriptTag?.nextElementSibling as HTMLElement
      expect(insertedDiv).not.toBeNull()
      expect(insertedDiv.id).toBe("caline")
      expect(insertedDiv.classList.contains("cl-root")).toBe(true)
      expect(insertedDiv.getAttribute("data-caline-initialized")).toBe("true")
    })

    it("autoInit preserves existing container <div data-caline> without regression", () => {
      document.body.innerHTML = `
        <div data-caline id="explicit-div"></div>
        <script src="https://caline.example.com/client/v1.js" data-caline data-server-url="https://caline.example.com"></script>
      `

      const widget = autoInit()
      expect(widget).not.toBeNull()
      const scriptTag = document.querySelector("script")
      expect(scriptTag?.classList.contains("cl-root")).toBe(false)
      const targetDiv = document.querySelector("#explicit-div")
      expect(targetDiv?.classList.contains("cl-root")).toBe(true)
      expect(targetDiv?.getAttribute("data-caline-initialized")).toBe("true")
      // Should not insert another #caline div
      expect(document.querySelectorAll("#caline").length).toBe(0)
    })

    it("autoInit preserves existing container <div id='caline'> without regression", () => {
      document.body.innerHTML = `
        <div id="caline"></div>
        <script src="https://caline.example.com/client/v1.js" data-caline data-server-url="https://caline.example.com"></script>
      `

      const widget = autoInit()
      expect(widget).not.toBeNull()
      const container = document.querySelector("#caline")
      expect(container?.classList.contains("cl-root")).toBe(true)
      expect(container?.getAttribute("data-caline-initialized")).toBe("true")
      expect(document.querySelectorAll("#caline").length).toBe(1)
    })

    it("autoInit preserves existing container #comments without regression", () => {
      document.body.innerHTML = `
        <div id="comments"></div>
        <script src="https://caline.example.com/client/v1.js" data-caline data-server-url="https://caline.example.com"></script>
      `

      const widget = autoInit()
      expect(widget).not.toBeNull()
      const container = document.querySelector("#comments")
      expect(container?.classList.contains("cl-root")).toBe(true)
      expect(container?.getAttribute("data-caline-initialized")).toBe("true")
      expect(document.querySelector("#caline")).toBeNull()
    })

    it("autoInit preserves existing container #waline without regression", () => {
      document.body.innerHTML = `
        <div id="waline"></div>
        <script src="https://caline.example.com/client/v1.js" data-caline data-server-url="https://caline.example.com"></script>
      `

      const widget = autoInit()
      expect(widget).not.toBeNull()
      const container = document.querySelector("#waline")
      expect(container?.classList.contains("cl-root")).toBe(true)
      expect(container?.getAttribute("data-caline-initialized")).toBe("true")
      expect(document.querySelector("#caline")).toBeNull()
    })

    it("autoInit reads global window.CALINE_CONFIG", () => {
      ;(window as unknown as { CALINE_CONFIG: unknown }).CALINE_CONFIG = {
        serverURL: "https://caline.example.com",
        path: "/custom/path"
      }
      document.body.innerHTML = '<div id="caline"></div>'

      const widget = autoInit()
      expect(widget).not.toBeNull()
      expect(
        document.querySelector("#caline")?.classList.contains("cl-root")
      ).toBe(true)
    })

    it("autoInit avoids duplicate initialization on already initialized containers", () => {
      document.body.innerHTML = `
        <div id="caline"></div>
        <script src="https://caline.example.com/client/v1.js" data-server-url="https://caline.example.com"></script>
      `

      const first = autoInit()
      expect(first).not.toBeNull()
      const second = autoInit()
      expect(second).toBeNull()
    })

    it("autoInit gates execution and returns null when no intent or configuration is declared", () => {
      document.body.innerHTML = `
        <div id="comments"></div>
        <script src="https://caline.example.com/client/v1.js"></script>
      `

      const widget = autoInit()
      expect(widget).toBeNull()
      expect(
        document.querySelector("#comments")?.classList.contains("cl-root")
      ).toBe(false)
      expect(document.querySelector("#caline")).toBeNull()
    })

    it("autoInit does not insert div container inside document.head", () => {
      document.head.innerHTML = `
        <script src="https://caline.example.com/client/v1.js" data-server-url="https://caline.example.com"></script>
      `
      document.body.innerHTML = "<div>No container</div>"

      const widget = autoInit()
      expect(widget).toBeNull()
      expect(document.head.querySelector("div")).toBeNull()
    })

    it("scheduleAutoInit waits for DOMContentLoaded if document.readyState is loading", () => {
      document.body.innerHTML = '<div id="caline"></div>'
      const addEventSpy = vi.spyOn(document, "addEventListener")

      // 模拟 document.readyState === "loading"
      Object.defineProperty(document, "readyState", {
        value: "loading",
        configurable: true
      })

      scheduleAutoInit()
      expect(addEventSpy).toHaveBeenCalledWith(
        "DOMContentLoaded",
        expect.any(Function),
        { once: true }
      )

      // 恢复 readyState
      Object.defineProperty(document, "readyState", {
        value: "complete",
        configurable: true
      })
    })
  })

  describe("Logged-in mode and auth session handling", () => {
    const mockUser: AuthMe = {
      id: 42,
      email: "alice@example.com",
      displayName: "Alice",
      avatar: "https://example.com/alice.jpg",
      role: "user",
      status: "active",
      emailVerified: true,
      mustChangePassword: false,
      language: "zh-CN",
      timezone: "UTC",
      totpEnabled: false,
      emailTwoFactorEnabled: false,
      passkeyCount: 0,
      profileLocks: { displayNameLocked: false }
    }

    it("supports posting_as and logout i18n keys with parameter interpolation", () => {
      const tZh = createTranslator("zh-CN")
      expect(tZh("posting_as", { name: "Alice" })).toBe("以 Alice 身份发表")
      expect(tZh("logout")).toBe("退出登录")

      const tEn = createTranslator("en")
      expect(tEn("posting_as", { name: "Alice" })).toBe("Posting as Alice")
      expect(tEn("logout")).toBe("Sign out")
    })

    describe("Editor component in logged-in vs guest mode", () => {
      it("renders identity header, hides guest fields, and shows logout button in logged-in mode (zh-CN)", () => {
        const t = createTranslator("zh-CN")
        const onLogout = vi.fn()
        const onSubmit = vi.fn()

        const editor = createEditor({
          t,
          serverUrl: "https://example.com",
          user: mockUser,
          onLogout,
          onSubmit
        })

        // 身份栏存在
        const identityBar = editor.querySelector(".cl-editor-identity-bar")
        expect(identityBar).not.toBeNull()

        // 头像
        const avatar = editor.querySelector(
          ".cl-editor-avatar"
        ) as HTMLImageElement
        expect(avatar).not.toBeNull()
        expect(avatar.src).toBe("https://example.com/alice.jpg")
        expect(avatar.alt).toBe("Alice")

        // 身份文案及昵称高亮
        const notice = editor.querySelector(".cl-editor-identity-notice")
        expect(notice).not.toBeNull()
        expect(notice?.textContent).toBe("以 Alice 身份发表")
        expect(editor.querySelector(".cl-editor-user-name")?.textContent).toBe(
          "Alice"
        )

        // 退出登录按钮
        const logoutBtn = editor.querySelector(
          ".cl-editor-logout-btn"
        ) as HTMLButtonElement
        expect(logoutBtn).not.toBeNull()
        expect(logoutBtn.textContent).toBe("退出登录")

        // 访客表单及登录提示应被隐藏
        expect(editor.querySelector(".cl-editor-meta-inputs")).toBeNull()
        expect(editor.querySelector(".cl-input-nick")).toBeNull()
        expect(editor.querySelector(".cl-input-mail")).toBeNull()
        expect(editor.querySelector(".cl-input-link")).toBeNull()
        expect(editor.querySelector(".cl-editor-login-prompt")).toBeNull()
      })

      it("renders identity header in en-US mode", () => {
        const t = createTranslator("en")
        const editor = createEditor({
          t,
          serverUrl: "https://example.com",
          user: mockUser,
          onSubmit: vi.fn()
        })

        const notice = editor.querySelector(".cl-editor-identity-notice")
        expect(notice?.textContent).toBe("Posting as Alice")
        const logoutBtn = editor.querySelector(".cl-editor-logout-btn")
        expect(logoutBtn?.textContent).toBe("Sign out")
      })

      it("falls back to default avatar and email prefix when avatar and displayName are missing", () => {
        const t = createTranslator("zh-CN")
        const userWithoutProfile: AuthMe = {
          ...mockUser,
          displayName: "",
          avatar: undefined,
          email: "charlie@example.com"
        }

        const editor = createEditor({
          t,
          serverUrl: "https://example.com",
          user: userWithoutProfile,
          onSubmit: vi.fn()
        })

        const avatar = editor.querySelector(
          ".cl-editor-avatar"
        ) as HTMLImageElement
        expect(avatar.src).toContain("data:image/svg+xml")
        const notice = editor.querySelector(".cl-editor-identity-notice")
        expect(notice?.textContent).toBe("以 charlie 身份发表")
      })

      it("submits comments without guest fields in logged-in mode", async () => {
        const t = createTranslator("zh-CN")
        const onSubmit = vi.fn().mockResolvedValue(undefined)

        const editor = createEditor({
          t,
          serverUrl: "https://example.com",
          user: mockUser,
          onSubmit
        })

        const textarea = editor.querySelector(
          ".cl-textarea"
        ) as HTMLTextAreaElement
        textarea.value = "Hello logged-in comment!"
        textarea.dispatchEvent(new Event("input"))

        const submitBtn = editor.querySelector(
          ".cl-btn-primary"
        ) as HTMLButtonElement
        expect(submitBtn.disabled).toBe(false)
        submitBtn.click()

        expect(onSubmit).toHaveBeenCalledWith({
          content: "Hello logged-in comment!",
          nick: undefined,
          mail: undefined,
          link: undefined
        })
      })

      it("triggers onLogout handler when logout button is clicked", async () => {
        const t = createTranslator("zh-CN")
        const onLogout = vi.fn().mockResolvedValue(undefined)

        const editor = createEditor({
          t,
          serverUrl: "https://example.com",
          user: mockUser,
          onLogout,
          onSubmit: vi.fn()
        })

        const logoutBtn = editor.querySelector(
          ".cl-editor-logout-btn"
        ) as HTMLButtonElement
        logoutBtn.click()

        expect(onLogout).toHaveBeenCalled()
      })

      it("allows commenting when isGuestDisabled is true if user is logged in", () => {
        const t = createTranslator("zh-CN")
        const editor = createEditor({
          t,
          serverUrl: "https://example.com",
          isGuestDisabled: true,
          user: mockUser,
          onSubmit: vi.fn()
        })

        // 未被拦截为访客关闭提示
        expect(editor.querySelector(".cl-login-notice")).toBeNull()
        expect(editor.querySelector(".cl-textarea")).not.toBeNull()
        expect(editor.querySelector(".cl-editor-identity-bar")).not.toBeNull()
      })
    })

    describe("ApiClient getMe and logout", () => {
      it("getMe returns user data on 200 response", async () => {
        const client = new CalineApiClient("https://example.com")
        window.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ data: mockUser })
        }) as unknown as typeof fetch

        const user = await client.getMe()
        expect(user).toEqual(mockUser)
        expect(window.fetch).toHaveBeenCalledWith(
          "https://example.com/api/auth/me",
          expect.objectContaining({ credentials: "include" })
        )
      })

      it("getMe returns null on 401 unauthorized or network error", async () => {
        const client = new CalineApiClient("https://example.com")
        window.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          json: async () => ({
            error: { code: "UNAUTHORIZED", message: "Sign in required" }
          })
        }) as unknown as typeof fetch

        const user = await client.getMe()
        expect(user).toBeNull()

        // 网络异常
        window.fetch = vi.fn().mockRejectedValue(new Error("Network offline"))
        const userAfterNetworkError = await client.getMe()
        expect(userAfterNetworkError).toBeNull()
      })

      it("logout calls POST /api/auth/logout with credentials", async () => {
        const client = new CalineApiClient("https://example.com")
        window.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ success: true })
        }) as unknown as typeof fetch

        await client.logout()
        expect(window.fetch).toHaveBeenCalledWith(
          "https://example.com/api/auth/logout",
          expect.objectContaining({
            method: "POST",
            credentials: "include"
          })
        )
      })

      it("uploadImage sends multipart file and optionally appends turnstileToken", async () => {
        const client = new CalineApiClient("https://example.com")
        let requestBody: FormData | null = null
        window.fetch = vi
          .fn()
          .mockImplementation((_url: string, init?: RequestInit) => {
            requestBody = init?.body as FormData
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ data: { url: "/img/uploaded.png" } })
            })
          }) as unknown as typeof fetch

        const dummyFile = new File(["dummy"], "photo.png", {
          type: "image/png"
        })
        const res = await client.uploadImage(dummyFile, "turnstile_token_123")
        expect(res.url).toBe("/img/uploaded.png")
        expect(requestBody).not.toBeNull()
        expect((requestBody as unknown as FormData).get("file")).toBe(dummyFile)
        expect((requestBody as unknown as FormData).get("turnstileToken")).toBe(
          "turnstile_token_123"
        )
      })
    })

    describe("CalineWidget end-to-end auth state flow", () => {
      it("probes /api/auth/me on init and transitions to logged-in editor", async () => {
        document.body.innerHTML = '<div id="caline"></div>'
        const fetchMock = vi.fn().mockImplementation((url: string) => {
          if (url.includes("/api/auth/me")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ data: mockUser })
            })
          }
          if (url.includes("/api/comments")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                data: {
                  items: [],
                  total: 0,
                  page: 1,
                  pageSize: 10,
                  totalPages: 0
                }
              })
            })
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: {} })
          })
        })
        window.fetch = fetchMock as unknown as typeof fetch

        const widget = init({ el: "#caline", serverURL: "https://example.com" })
        expect(widget).toBeDefined()

        // 等待异步 checkAuth 完成
        await widget.checkAuth()

        const editorSlot = document.querySelector(".cl-editor-slot")
        expect(
          editorSlot?.querySelector(".cl-editor-identity-bar")
        ).not.toBeNull()
        expect(editorSlot?.querySelector(".cl-editor-avatar")).not.toBeNull()
        expect(
          editorSlot?.querySelector(".cl-editor-identity-notice")?.textContent
        ).toBe("以 Alice 身份发表")
        expect(editorSlot?.querySelector(".cl-editor-meta-inputs")).toBeNull()
      })

      it("falls back cleanly to guest mode on 401 without blocking comments loading", async () => {
        document.body.innerHTML = '<div id="caline"></div>'
        const fetchMock = vi.fn().mockImplementation((url: string) => {
          if (url.includes("/api/auth/me")) {
            return Promise.resolve({
              ok: false,
              status: 401,
              json: async () => ({
                error: { code: "UNAUTHORIZED", message: "Sign in required" }
              })
            })
          }
          if (url.includes("/api/comments")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                data: {
                  items: [
                    {
                      id: 1,
                      url: "/",
                      nick: "GuestPoster",
                      avatar: "https://example.com/avatar.png",
                      contentHtml: "<p>Hello</p>",
                      createdAt: new Date().toISOString(),
                      likes: 0,
                      sticky: false
                    }
                  ],
                  total: 1,
                  page: 1,
                  pageSize: 10,
                  totalPages: 1
                }
              })
            })
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: {} })
          })
        })
        window.fetch = fetchMock as unknown as typeof fetch

        const widget = init({ el: "#caline", serverURL: "https://example.com" })
        await widget.checkAuth()

        // 访客表单正常展现
        const editorSlot = document.querySelector(".cl-editor-slot")
        expect(
          editorSlot?.querySelector(".cl-editor-meta-inputs")
        ).not.toBeNull()
        expect(editorSlot?.querySelector(".cl-input-nick")).not.toBeNull()
        expect(editorSlot?.querySelector(".cl-editor-identity-bar")).toBeNull()

        // 评论列表成功加载，未被鉴权失败阻塞
        const treeSlot = document.querySelector(".cl-tree-slot")
        expect(treeSlot?.textContent).toContain("GuestPoster")
      })

      it("switches from logged-in mode back to guest mode when logout is clicked without page reload", async () => {
        document.body.innerHTML = '<div id="caline"></div>'
        let loggedIn = true

        const fetchMock = vi
          .fn()
          .mockImplementation((url: string, init?: RequestInit) => {
            if (url.includes("/api/auth/logout") && init?.method === "POST") {
              loggedIn = false
              return Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({ success: true })
              })
            }
            if (url.includes("/api/auth/me")) {
              if (loggedIn) {
                return Promise.resolve({
                  ok: true,
                  status: 200,
                  json: async () => ({ data: mockUser })
                })
              }
              return Promise.resolve({
                ok: false,
                status: 401,
                json: async () => ({
                  error: { code: "UNAUTHORIZED", message: "Sign in required" }
                })
              })
            }
            if (url.includes("/api/comments")) {
              return Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({
                  data: {
                    items: [],
                    total: 0,
                    page: 1,
                    pageSize: 10,
                    totalPages: 0
                  }
                })
              })
            }
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ data: {} })
            })
          })
        window.fetch = fetchMock as unknown as typeof fetch

        const widget = init({ el: "#caline", serverURL: "https://example.com" })
        await widget.checkAuth()

        const editorSlot = document.querySelector(".cl-editor-slot")
        expect(
          editorSlot?.querySelector(".cl-editor-identity-bar")
        ).not.toBeNull()

        // 点击退出登录
        const logoutBtn = editorSlot?.querySelector(
          ".cl-editor-logout-btn"
        ) as HTMLButtonElement
        expect(logoutBtn).not.toBeNull()
        logoutBtn.click()

        await vi.waitFor(() => {
          expect(widget.user).toBeNull()
        })

        // 验证 POST /api/auth/logout 已被调用
        expect(fetchMock).toHaveBeenCalledWith(
          "https://example.com/api/auth/logout",
          expect.objectContaining({ method: "POST" })
        )

        // 验证无需刷新页面，主发表框无缝切回访客模式
        expect(editorSlot?.querySelector(".cl-editor-identity-bar")).toBeNull()
        expect(
          editorSlot?.querySelector(".cl-editor-meta-inputs")
        ).not.toBeNull()
        expect(editorSlot?.querySelector(".cl-input-nick")).not.toBeNull()
        expect(
          editorSlot?.querySelector(".cl-editor-login-prompt")
        ).not.toBeNull()
      })

      it("keeps logged-in state and alerts error when logout request fails", async () => {
        document.body.innerHTML = '<div id="caline"></div>'
        const alertMock = vi.spyOn(window, "alert").mockImplementation(() => {})

        const fetchMock = vi
          .fn()
          .mockImplementation((url: string, init?: RequestInit) => {
            if (url.includes("/api/auth/logout") && init?.method === "POST") {
              return Promise.reject(new Error("Logout network timeout"))
            }
            if (url.includes("/api/auth/me")) {
              return Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({ data: mockUser })
              })
            }
            if (url.includes("/api/comments")) {
              return Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({
                  data: {
                    items: [],
                    total: 0,
                    page: 1,
                    pageSize: 10,
                    totalPages: 0
                  }
                })
              })
            }
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ data: {} })
            })
          })
        window.fetch = fetchMock as unknown as typeof fetch

        const widget = init({ el: "#caline", serverURL: "https://example.com" })
        await widget.checkAuth()

        const editorSlot = document.querySelector(".cl-editor-slot")
        expect(
          editorSlot?.querySelector(".cl-editor-identity-bar")
        ).not.toBeNull()

        // 点击退出登录
        const logoutBtn = editorSlot?.querySelector(
          ".cl-editor-logout-btn"
        ) as HTMLButtonElement
        expect(logoutBtn).not.toBeNull()
        logoutBtn.click()

        await vi.waitFor(() => {
          expect(alertMock).toHaveBeenCalledWith("Logout network timeout")
        })

        // 验证失败后未脱离登录态，仍保持登录 UI，未展示访客表单
        expect(widget.user).toEqual(mockUser)
        expect(
          editorSlot?.querySelector(".cl-editor-identity-bar")
        ).not.toBeNull()
        expect(editorSlot?.querySelector(".cl-editor-meta-inputs")).toBeNull()
        expect(logoutBtn.disabled).toBe(false)
      })

      it("submits comment without guest fields when logged in", async () => {
        document.body.innerHTML = '<div id="caline"></div>'
        let createCommentPayload: Record<string, unknown> | null = null

        const fetchMock = vi
          .fn()
          .mockImplementation((url: string, init?: RequestInit) => {
            if (url.includes("/api/auth/me")) {
              return Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({ data: mockUser })
              })
            }
            if (url.includes("/api/comments") && init?.method === "POST") {
              createCommentPayload = JSON.parse(init.body as string)
              return Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({
                  data: {
                    comment: {
                      id: 99,
                      url: "/",
                      status: "approved",
                      contentHtml: "<p>Logged in comment</p>",
                      createdAt: new Date().toISOString()
                    },
                    status: "approved"
                  }
                })
              })
            }
            if (url.includes("/api/comments")) {
              return Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({
                  data: {
                    items: [],
                    total: 0,
                    page: 1,
                    pageSize: 10,
                    totalPages: 0
                  }
                })
              })
            }
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ data: {} })
            })
          })
        window.fetch = fetchMock as unknown as typeof fetch

        const widget = init({ el: "#caline", serverURL: "https://example.com" })
        await widget.checkAuth()

        const editorSlot = document.querySelector(".cl-editor-slot")!
        const textarea = editorSlot.querySelector(
          ".cl-textarea"
        ) as HTMLTextAreaElement
        textarea.value = "Posting with my account"
        textarea.dispatchEvent(new Event("input"))

        const submitBtn = editorSlot.querySelector(
          ".cl-btn-primary"
        ) as HTMLButtonElement
        submitBtn.click()

        await vi.waitFor(() => {
          expect(createCommentPayload).not.toBeNull()
        })

        expect(createCommentPayload).not.toBeNull()
        expect(createCommentPayload).toEqual({
          url: "/",
          content: "Posting with my account"
        })
        // 确保未携带访客身份字段
        expect(createCommentPayload).not.toHaveProperty("nick")
        expect(createCommentPayload).not.toHaveProperty("mail")
        expect(createCommentPayload).not.toHaveProperty("link")
      })

      it("renders logged-in reply editor with identity bar and submits without guest fields", async () => {
        document.body.innerHTML = '<div id="caline"></div>'
        let replyCommentPayload: Record<string, unknown> | null = null

        const fetchMock = vi
          .fn()
          .mockImplementation((url: string, init?: RequestInit) => {
            if (url.includes("/api/auth/me")) {
              return Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({ data: mockUser })
              })
            }
            if (url.includes("/api/comments") && init?.method === "POST") {
              replyCommentPayload = JSON.parse(init.body as string)
              return Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({
                  data: {
                    comment: {
                      id: 100,
                      url: "/",
                      status: "approved",
                      contentHtml: "<p>Reply comment</p>",
                      createdAt: new Date().toISOString()
                    },
                    status: "approved"
                  }
                })
              })
            }
            if (url.includes("/api/comments")) {
              return Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({
                  data: {
                    items: [
                      {
                        id: 1,
                        url: "/",
                        nick: "OriginalAuthor",
                        avatar: "https://example.com/author.png",
                        contentHtml: "<p>Original post</p>",
                        createdAt: new Date().toISOString(),
                        likes: 0,
                        sticky: false
                      }
                    ],
                    total: 1,
                    page: 1,
                    pageSize: 10,
                    totalPages: 1
                  }
                })
              })
            }
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ data: {} })
            })
          })
        window.fetch = fetchMock as unknown as typeof fetch

        const widget = init({ el: "#caline", serverURL: "https://example.com" })
        await widget.checkAuth()

        // 触发回复
        const replyTriggerBtn = document.querySelector(
          ".cl-btn-reply"
        ) as HTMLButtonElement
        expect(replyTriggerBtn).not.toBeNull()
        replyTriggerBtn.click()

        // 回复编辑器挂载
        const replySlot = document.querySelector(".cl-reply-editor-slot")
        expect(replySlot).not.toBeNull()

        // 验证回复编辑器同样呈现登录身份栏与退出按钮，且无访客三件套
        expect(
          replySlot?.querySelector(".cl-editor-identity-bar")
        ).not.toBeNull()
        expect(replySlot?.querySelector(".cl-editor-avatar")).not.toBeNull()
        expect(
          replySlot?.querySelector(".cl-editor-identity-notice")?.textContent
        ).toBe("以 Alice 身份发表")
        expect(replySlot?.querySelector(".cl-editor-meta-inputs")).toBeNull()

        // 填写回复并发表
        const replyTextarea = replySlot?.querySelector(
          ".cl-textarea"
        ) as HTMLTextAreaElement
        replyTextarea.value = "Replying as Alice"
        replyTextarea.dispatchEvent(new Event("input"))

        const replySubmitBtn = replySlot?.querySelector(
          ".cl-btn-primary"
        ) as HTMLButtonElement
        replySubmitBtn.click()

        await vi.waitFor(() => {
          expect(replyCommentPayload).not.toBeNull()
        })

        expect(replyCommentPayload).not.toBeNull()
        expect(replyCommentPayload).toEqual({
          url: "/",
          content: "Replying as Alice",
          pid: 1,
          rid: 1
        })
        expect(replyCommentPayload).not.toHaveProperty("nick")
        expect(replyCommentPayload).not.toHaveProperty("mail")
        expect(replyCommentPayload).not.toHaveProperty("link")
      })
    })
  })

  describe("Alignment features: Footer, Login Popup, Toolbar Icons, Upload & Emoji Groups", () => {
    beforeEach(() => {
      clearEmojiCache()
    })

    describe("Footer (Powered by Caline v<version>)", () => {
      it("renders right-aligned footer with Caline link and injected version", () => {
        document.body.innerHTML = '<div id="caline"></div>'
        window.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            data: { items: [], total: 0, page: 1, pageSize: 10, totalPages: 0 }
          })
        }) as unknown as typeof fetch

        init({ el: "#caline", serverURL: "https://example.com" })

        const container = document.querySelector("#caline")!
        const footer = container.querySelector(".cl-footer")
        expect(footer).not.toBeNull()

        // 验证弱化文案与版本号
        expect(footer?.textContent).toContain(
          `Powered by Caline v${CALINE_VERSION}`
        )

        // 验证 Caline 仓库链接与安全属性
        const link = footer?.querySelector(
          "a.cl-footer-link"
        ) as HTMLAnchorElement
        expect(link).not.toBeNull()
        expect(link.href).toBe("https://github.com/WorkerHub/Caline")
        expect(link.target).toBe("_blank")
        expect(link.rel).toBe("noopener")
        expect(link.textContent).toBe("Caline")
      })
    })

    describe("Login popup & fallback handling", () => {
      it("opens centered 480x640 popup with menubar/toolbar disabled", () => {
        const mockPopup = { closed: false } as Window
        const openSpy = vi.spyOn(window, "open").mockReturnValue(mockPopup)
        const onAuthRefresh = vi.fn()

        openLoginPopup({
          serverUrl: "https://caline.example.com",
          onAuthRefresh
        })

        expect(openSpy).toHaveBeenCalledWith(
          "https://caline.example.com/ui/login?popup=1",
          "caline-login",
          expect.stringContaining("width=480,height=640")
        )
        const featuresArg = openSpy.mock.calls[0][2] as string
        expect(featuresArg).toContain("menubar=no")
        expect(featuresArg).toContain("toolbar=no")
        expect(featuresArg).toContain("location=no")
        expect(featuresArg).toContain("status=no")
      })

      it("falls back to standard new tab when popup is blocked or fails to open", () => {
        const openSpy = vi.spyOn(window, "open")
        // 第一次调用返回 null（模拟弹窗拦截）
        openSpy.mockReturnValueOnce(null)

        const onAuthRefresh = vi.fn()
        const popup = openLoginPopup({
          serverUrl: "https://caline.example.com",
          onAuthRefresh
        })

        expect(popup).toBeNull()
        // 验证回落为普通新标签打开 /ui/login
        expect(openSpy).toHaveBeenCalledTimes(2)
        expect(openSpy).toHaveBeenLastCalledWith(
          "https://caline.example.com/ui/login",
          "_blank",
          "noopener"
        )
      })

      it("triggers auth refresh when popup is closed via polling", async () => {
        vi.useFakeTimers()
        const mockPopup = { closed: false } as Window
        vi.spyOn(window, "open").mockReturnValue(mockPopup)
        const onAuthRefresh = vi.fn()

        openLoginPopup({
          serverUrl: "https://caline.example.com",
          onAuthRefresh
        })

        expect(onAuthRefresh).not.toHaveBeenCalled()

        // 模拟用户在弹窗中完成登录并关闭了弹窗
        ;(mockPopup as { closed: boolean }).closed = true
        vi.advanceTimersByTime(600)

        expect(onAuthRefresh).toHaveBeenCalledTimes(1)
        vi.useRealTimers()
      })

      it("triggers auth refresh on window postMessage from valid origin", async () => {
        const mockPopup = { closed: false } as Window
        vi.spyOn(window, "open").mockReturnValue(mockPopup)
        const onAuthRefresh = vi.fn()

        openLoginPopup({
          serverUrl: "https://caline.example.com",
          onAuthRefresh
        })

        // 派发来自非匹配 origin 的消息（例如恶意站点）
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "LOGIN_SUCCESS" },
            origin: "https://evil.com"
          })
        )
        expect(onAuthRefresh).not.toHaveBeenCalled()

        // 派发来自 serverURL origin 的合法消息
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "LOGIN_SUCCESS" },
            origin: "https://caline.example.com"
          })
        )
        expect(onAuthRefresh).toHaveBeenCalledTimes(1)
      })

      it("triggers login popup from guest prompt and guest-disabled notice links", () => {
        const openSpy = vi
          .spyOn(window, "open")
          .mockReturnValue({ closed: false } as Window)
        const t = createTranslator("zh-CN")

        // 1. 访客态表单中的登录入口
        const editor = createEditor({
          t,
          serverUrl: "https://example.com",
          onSubmit: vi.fn()
        })
        const guestLoginLink = editor.querySelector(
          ".cl-editor-login-prompt"
        ) as HTMLAnchorElement
        expect(guestLoginLink).not.toBeNull()
        guestLoginLink.click()

        expect(openSpy).toHaveBeenCalledWith(
          "https://example.com/ui/login?popup=1",
          "caline-login",
          expect.stringContaining("width=480,height=640")
        )

        // 2. 访客关闭态的登录入口
        const closedEditor = createEditor({
          t,
          serverUrl: "https://example.com",
          isGuestDisabled: true,
          onSubmit: vi.fn()
        })
        const closedLoginLink = closedEditor.querySelector(
          ".cl-login-link"
        ) as HTMLAnchorElement
        expect(closedLoginLink).not.toBeNull()
        closedLoginLink.click()

        expect(openSpy).toHaveBeenCalledWith(
          "https://example.com/ui/login?popup=1",
          "caline-login",
          expect.stringContaining("width=480,height=640")
        )
      })
    })

    describe("Toolbar iconification & preview toggle", () => {
      it("renders magnifying glass SVG for preview toggle and image icon for upload", () => {
        const t = createTranslator("zh-CN")
        const editor = createEditor({
          t,
          serverUrl: "https://example.com",
          onSubmit: vi.fn()
        })

        // 预览按钮检查
        const previewBtn = editor.querySelector(
          ".cl-tool-btn-preview"
        ) as HTMLButtonElement
        expect(previewBtn).not.toBeNull()
        expect(previewBtn.querySelector("svg")).not.toBeNull()
        expect(previewBtn.title).toBe("预览")
        expect(previewBtn.getAttribute("aria-label")).toBe("预览")

        // 图片按钮检查
        const imageBtn = editor.querySelector(
          ".cl-tool-btn-image"
        ) as HTMLButtonElement
        expect(imageBtn).not.toBeNull()
        expect(imageBtn.querySelector("svg")).not.toBeNull()
        expect(imageBtn.title).toBe("插入图片")
        expect(imageBtn.getAttribute("aria-label")).toBe("插入图片")

        // Emoji 按钮检查
        const emojiBtn = editor.querySelector(
          ".cl-tool-btn"
        ) as HTMLButtonElement
        expect(emojiBtn.textContent).toBe("😀")
        expect(emojiBtn.title).toBe("表情")
        expect(emojiBtn.getAttribute("aria-label")).toBe("表情")

        // 预览切换功能保持一致
        const textarea = editor.querySelector(
          ".cl-textarea"
        ) as HTMLTextAreaElement
        const previewBox = editor.querySelector(
          ".cl-editor-preview"
        ) as HTMLElement
        textarea.value = "**Bold**"

        previewBtn.click()
        expect(previewBox.style.display).toBe("block")
        expect(textarea.style.display).toBe("none")
        expect(previewBtn.classList.contains("active")).toBe(true)
        expect(previewBox.innerHTML).toContain("<strong>Bold</strong>")

        previewBtn.click()
        expect(previewBox.style.display).toBe("none")
        expect(textarea.style.display).toBe("block")
        expect(previewBtn.classList.contains("active")).toBe(false)
      })
    })

    describe("Image upload (file picker & paste, progress state and error recovery)", () => {
      it("uploads selected file and inserts ![](absoluteUrl) at cursor", async () => {
        const t = createTranslator("zh-CN")
        const uploadMock = vi
          .fn()
          .mockResolvedValue({ url: "/img/photo_123.jpg" })
        const editor = createEditor({
          t,
          serverUrl: "https://example.com",
          onUpload: uploadMock,
          onSubmit: vi.fn()
        })

        const textarea = editor.querySelector(
          ".cl-textarea"
        ) as HTMLTextAreaElement
        textarea.value = "Prefix text "
        textarea.selectionStart = textarea.selectionEnd = 12

        const fileInput = editor.querySelector(
          'input[type="file"]'
        ) as HTMLInputElement
        const dummyFile = new File(["dummy content"], "photo.jpg", {
          type: "image/jpeg"
        })

        // 模拟选择文件
        Object.defineProperty(fileInput, "files", {
          value: [dummyFile],
          configurable: true
        })
        fileInput.dispatchEvent(new Event("change"))

        await vi.waitFor(() => {
          expect(uploadMock).toHaveBeenCalledWith(dummyFile)
        })

        await vi.waitFor(() => {
          expect(textarea.value).toBe(
            "Prefix text ![](https://example.com/img/photo_123.jpg)"
          )
        })
      })

      it("handles paste image event on textarea and inserts markdown", async () => {
        const t = createTranslator("zh-CN")
        const uploadMock = vi
          .fn()
          .mockResolvedValue({ url: "https://cdn.example.com/img/pasted.png" })
        const editor = createEditor({
          t,
          serverUrl: "https://example.com",
          onUpload: uploadMock,
          onSubmit: vi.fn()
        })

        const textarea = editor.querySelector(
          ".cl-textarea"
        ) as HTMLTextAreaElement
        textarea.value = "Before "
        textarea.selectionStart = textarea.selectionEnd = 7

        const dummyFile = new File(["pasted"], "image.png", {
          type: "image/png"
        })
        const clipboardEvent = new Event("paste") as unknown as ClipboardEvent
        Object.defineProperty(clipboardEvent, "clipboardData", {
          value: {
            items: [
              {
                type: "image/png",
                getAsFile: () => dummyFile
              }
            ]
          }
        })

        textarea.dispatchEvent(clipboardEvent)

        await vi.waitFor(() => {
          expect(uploadMock).toHaveBeenCalledWith(dummyFile)
        })

        await vi.waitFor(() => {
          expect(textarea.value).toBe(
            "Before ![](https://cdn.example.com/img/pasted.png)"
          )
        })
      })

      it("displays error in editor and preserves input content on upload failure", async () => {
        const t = createTranslator("zh-CN")
        const uploadMock = vi
          .fn()
          .mockRejectedValue(new Error("File size exceeds 5MB"))
        const editor = createEditor({
          t,
          serverUrl: "https://example.com",
          onUpload: uploadMock,
          onSubmit: vi.fn()
        })

        const textarea = editor.querySelector(
          ".cl-textarea"
        ) as HTMLTextAreaElement
        const originalContent =
          "Important drafted content that must never be lost"
        textarea.value = originalContent

        const fileInput = editor.querySelector(
          'input[type="file"]'
        ) as HTMLInputElement
        const dummyFile = new File(["too big"], "large.png", {
          type: "image/png"
        })
        Object.defineProperty(fileInput, "files", {
          value: [dummyFile],
          configurable: true
        })
        fileInput.dispatchEvent(new Event("change"))

        const statusEl = editor.querySelector(
          ".cl-upload-status"
        ) as HTMLElement

        await vi.waitFor(() => {
          expect(statusEl.textContent).toBe("File size exceeds 5MB")
          expect(statusEl.classList.contains("error")).toBe(true)
        })

        // 验证用户已写文字绝对不丢失
        expect(textarea.value).toBe(originalContent)
      })
    })

    describe("Emoji panel: grouping, manifest lazy loading & insertion", () => {
      it("defines 4 emoji groups and fetchEmojiManifest loads manifest with caching", async () => {
        expect(EMOJI_GROUPS.length).toBe(4)
        expect(EMOJI_GROUPS.map((g) => g.id)).toEqual([
          "default",
          "qq",
          "weibo",
          "bilibili"
        ])

        const fetchSpy = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ test: "test.png" })
        })
        window.fetch = fetchSpy as unknown as typeof fetch

        const manifest1 = await fetchEmojiManifest(
          "https://example.com",
          "weibo"
        )
        expect(manifest1).toEqual({ test: "test.png" })
        expect(fetchSpy).toHaveBeenCalledTimes(1)

        // 再次获取命中缓存
        const manifest2 = await fetchEmojiManifest(
          "https://example.com",
          "weibo"
        )
        expect(manifest2).toEqual({ test: "test.png" })
        expect(fetchSpy).toHaveBeenCalledTimes(1)
      })

      it("renders Unicode base set in default group and inserts emoji", () => {
        const t = createTranslator("zh-CN")
        const editor = createEditor({
          t,
          serverUrl: "https://example.com",
          onSubmit: vi.fn()
        })

        const textarea = editor.querySelector(
          ".cl-textarea"
        ) as HTMLTextAreaElement
        const emojiToggle = editor.querySelector(
          ".cl-tool-btn"
        ) as HTMLButtonElement
        const emojiPanel = editor.querySelector(
          ".cl-emoji-panel"
        ) as HTMLElement

        // 打开面板
        emojiToggle.click()
        expect(emojiPanel.style.display).toBe("flex")

        // 验证 tabs 一行展示
        const tabs = emojiPanel.querySelectorAll(".cl-emoji-tab")
        expect(tabs.length).toBe(4)
        expect(tabs[0].textContent).toBe("默认")
        expect(tabs[1].textContent).toBe("QQ")
        expect(tabs[2].textContent).toBe("微博")
        expect(tabs[3].textContent).toBe("B站")

        // 验证默认分组激活
        expect(tabs[0].classList.contains("active")).toBe(true)

        // 验证渲染 Unicode 按钮并插入
        const unicodeBtns = emojiPanel.querySelectorAll(".cl-emoji-btn")
        expect(unicodeBtns.length).toBeGreaterThan(10)
        ;(unicodeBtns[0] as HTMLButtonElement).click()
        expect(textarea.value).toBe("😀")
      })

      it("lazy loads manifest on switching to qq group and inserts ![](imageUrl)", async () => {
        const t = createTranslator("zh-CN")
        const fetchMock = vi.fn().mockImplementation((url: string) => {
          if (url.includes("/emoji/qq/manifest.json")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                doge: "doge.png",
                cool: "cool.gif"
              })
            })
          }
          return Promise.resolve({ ok: false, status: 404 })
        })
        window.fetch = fetchMock as unknown as typeof fetch

        const editor = createEditor({
          t,
          serverUrl: "https://example.com",
          onSubmit: vi.fn()
        })

        const textarea = editor.querySelector(
          ".cl-textarea"
        ) as HTMLTextAreaElement
        const emojiToggle = editor.querySelector(
          ".cl-tool-btn"
        ) as HTMLButtonElement
        emojiToggle.click()

        const emojiPanel = editor.querySelector(
          ".cl-emoji-panel"
        ) as HTMLElement
        const qqTab = emojiPanel.querySelector(
          '.cl-emoji-tab[data-group="qq"]'
        ) as HTMLButtonElement
        expect(qqTab).not.toBeNull()

        // 切换到 QQ 分组
        qqTab.click()

        await vi.waitFor(() => {
          expect(fetchMock).toHaveBeenCalledWith(
            "https://example.com/emoji/qq/manifest.json"
          )
        })

        await vi.waitFor(() => {
          const imgBtns = emojiPanel.querySelectorAll(".cl-emoji-img-btn")
          expect(imgBtns.length).toBe(2)
        })

        const dogeBtn = emojiPanel.querySelector(
          '.cl-emoji-img-btn[title="doge"]'
        ) as HTMLButtonElement
        expect(dogeBtn).not.toBeNull()
        const img = dogeBtn.querySelector("img") as HTMLImageElement
        expect(img.src).toBe("https://example.com/emoji/qq/doge.png")

        // 点击插入 markdown 语法
        dogeBtn.click()
        expect(textarea.value).toBe(
          "![](https://example.com/emoji/qq/doge.png)"
        )
      })

      it("resolveEmojiImageUrl resolves relative, root-relative, and absolute URLs correctly", () => {
        expect(
          resolveEmojiImageUrl("https://example.com", "weibo", "smile.png")
        ).toBe("https://example.com/emoji/weibo/smile.png")
        expect(
          resolveEmojiImageUrl(
            "https://example.com",
            "weibo",
            "/custom/smile.png"
          )
        ).toBe("https://example.com/custom/smile.png")
        expect(
          resolveEmojiImageUrl(
            "https://example.com",
            "weibo",
            "https://cdn.example.com/smile.png"
          )
        ).toBe("https://cdn.example.com/smile.png")
      })
    })
  })
})
