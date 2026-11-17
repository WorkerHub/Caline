import { describe, expect, it, beforeEach, vi } from "vitest"
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
      expect(loginLink?.getAttribute("href")).toBe("https://example.com/login")
      expect(loginLink?.textContent).toBe(t("login_prompt"))
    })
  })
})
