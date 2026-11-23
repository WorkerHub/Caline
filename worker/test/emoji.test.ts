import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { EMOJI_MANIFESTS } from "../src/data/emojis"
import { renderAndSanitizeMarkdown } from "../src/core/pipeline"
import { activePrefix, initializedContext, request } from "./support/app"
import { findCommentById } from "../src/db/queries/comments"
import type { CreateCommentResult } from "@caline/shared"

describe("Self-hosted Emoji Packages & Manifest Endpoints", () => {
  it("serves qq emoji manifest with correct headers and mapping", async () => {
    const ctx = await initializedContext()
    const res = await request(ctx.env, "/emoji/qq/manifest.json")
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable"
    )
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")

    const data = (await res.json()) as Record<string, string>
    expect(data.smile).toBe("qq_smile.gif")
    expect(Object.keys(data).length).toBe(199)
  })

  it("serves weibo emoji manifest with correct headers and mapping", async () => {
    const ctx = await initializedContext()
    const res = await request(ctx.env, "/emoji/weibo/manifest.json")
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable"
    )
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")

    const data = (await res.json()) as Record<string, string>
    expect(data.doge).toBe("weibo_doge.png")
    expect(Object.keys(data).length).toBe(89)
  })

  it("serves bilibili emoji manifest with correct headers and mapping", async () => {
    const ctx = await initializedContext()
    const res = await request(ctx.env, "/emoji/bilibili/manifest.json")
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable"
    )
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")

    const data = (await res.json()) as Record<string, string>
    expect(data.doge).toBe("bb_doge.png")
    expect(Object.keys(data).length).toBe(51)
  })

  it("serves douyin emoji manifest with correct headers and mapping", async () => {
    const ctx = await initializedContext()
    const res = await request(ctx.env, "/emoji/douyin/manifest.json")
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable"
    )
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")

    const data = (await res.json()) as Record<string, string>
    expect(data["18jin"]).toBe("18jin.png")
    expect(data["666"]).toBe("666.png")
    expect(data.吉吉国王_emoji).toBe("吉吉国王_emoji.png")
    expect(Object.keys(data).length).toBe(415)
  })

  it("returns 404 for invalid or prototype pollution emoji groups", async () => {
    const ctx = await initializedContext()
    const resNonexistent = await request(
      ctx.env,
      "/emoji/nonexistent/manifest.json"
    )
    expect(resNonexistent.status).toBe(404)

    const resProto = await request(ctx.env, "/emoji/__proto__/manifest.json")
    expect(resProto.status).toBe(404)

    const resConstructor = await request(
      ctx.env,
      "/emoji/constructor/manifest.json"
    )
    expect(resConstructor.status).toBe(404)
  })

  it("cross-checks static manifest.json and EMOJI_MANIFESTS to prevent drift", () => {
    const emojiRoot = path.resolve(
      import.meta.dirname,
      "../../web/public/emoji"
    )
    const groups = ["qq", "weibo", "bilibili", "douyin"] as const

    for (const group of groups) {
      const manifestPath = path.join(emojiRoot, group, "manifest.json")
      expect(fs.existsSync(manifestPath)).toBe(true)

      const staticManifest = JSON.parse(
        fs.readFileSync(manifestPath, "utf8")
      ) as Record<string, string>
      const runtimeManifest = EMOJI_MANIFESTS[group]

      expect(staticManifest).toEqual(runtimeManifest)
    }
  })

  it("verifies physical static assets exist in web/public/emoji and correspond to manifests", () => {
    const emojiRoot = path.resolve(
      import.meta.dirname,
      "../../web/public/emoji"
    )
    const groups = ["qq", "weibo", "bilibili", "douyin"] as const

    for (const group of groups) {
      const groupDir = path.join(emojiRoot, group)
      expect(fs.existsSync(groupDir)).toBe(true)

      const manifestPath = path.join(groupDir, "manifest.json")
      expect(fs.existsSync(manifestPath)).toBe(true)

      const manifest = JSON.parse(
        fs.readFileSync(manifestPath, "utf8")
      ) as Record<string, string>
      expect(Object.keys(manifest).length).toBeGreaterThan(0)

      for (const [name, relPath] of Object.entries(manifest)) {
        expect(name).toBeTruthy()
        expect(relPath).toBeTruthy()
        const imgPath = path.join(groupDir, relPath)
        expect(fs.existsSync(imgPath)).toBe(true)
        const stat = fs.statSync(imgPath)
        expect(stat.size).toBeGreaterThan(0)
      }
    }
  })
})

describe("Server-side Emoji Shortcode Rendering Pipeline", () => {
  const baseUrl = "https://example.com"

  it("replaces valid shortcodes with absolute image tags for all 4 supported groups", async () => {
    const input =
      "QQ :qq_smile: and :qq_1:, Weibo :weibo_doge:, Bilibili :bilibili_doge:, Douyin :douyin_18jin: and :douyin_吉吉国王_emoji:"
    const html = await renderAndSanitizeMarkdown(input, baseUrl)
    expect(html).toContain(
      '<img src="https://example.com/emoji/qq/qq_smile.gif" alt=":qq_smile:" class="cl-emoji-sticker">'
    )
    expect(html).toContain(
      '<img src="https://example.com/emoji/qq/qq_1.gif" alt=":qq_1:" class="cl-emoji-sticker">'
    )
    expect(html).toContain(
      '<img src="https://example.com/emoji/weibo/weibo_doge.png" alt=":weibo_doge:" class="cl-emoji-sticker">'
    )
    expect(html).toContain(
      '<img src="https://example.com/emoji/bilibili/bb_doge.png" alt=":bilibili_doge:" class="cl-emoji-sticker">'
    )
    expect(html).toContain(
      '<img src="https://example.com/emoji/douyin/18jin.png" alt=":douyin_18jin:" class="cl-emoji-sticker">'
    )
    expect(html).toContain(
      '<img src="https://example.com/emoji/douyin/%E5%90%89%E5%90%89%E5%9B%BD%E7%8E%8B_emoji.png" alt=":douyin_吉吉国王_emoji:" class="cl-emoji-sticker">'
    )
  })

  it("retains unknown shortcodes and unknown groups as plain text", async () => {
    const input =
      "Unknown key :qq_9999:, unknown group :foo_bar:, invalid syntax :qq_: and :douyin_nonexistent:"
    const html = await renderAndSanitizeMarkdown(input, baseUrl)
    expect(html).toContain(":qq_9999:")
    expect(html).toContain(":foo_bar:")
    expect(html).toContain(":qq_:")
    expect(html).toContain(":douyin_nonexistent:")
    expect(html).not.toContain("<img")
  })

  it("exempts code blocks from shortcode replacement", async () => {
    const input = "```\n:qq_smile: :weibo_doge: :douyin_18jin:\n```"
    const html = await renderAndSanitizeMarkdown(input, baseUrl)
    expect(html).toContain(":qq_smile:")
    expect(html).toContain(":weibo_doge:")
    expect(html).toContain(":douyin_18jin:")
    expect(html).not.toContain("<img")
  })

  it("exempts inline code from shortcode replacement", async () => {
    const input = "Use `:qq_smile:` and `:douyin_18jin:` in code"
    const html = await renderAndSanitizeMarkdown(input, baseUrl)
    expect(html).toContain("<code>:qq_smile:</code>")
    expect(html).toContain("<code>:douyin_18jin:</code>")
    expect(html).not.toContain("<img")
  })

  it("correctly handles consecutive shortcodes, mixed text, and existing markdown images", async () => {
    const input =
      ":qq_smile::qq_1: and ![custom](https://img.example.com/pic.png) and [link :weibo_doge:](https://example.com)"
    const html = await renderAndSanitizeMarkdown(input, baseUrl)
    expect(html).toContain(
      '<img src="https://example.com/emoji/qq/qq_smile.gif" alt=":qq_smile:" class="cl-emoji-sticker"><img src="https://example.com/emoji/qq/qq_1.gif" alt=":qq_1:" class="cl-emoji-sticker">'
    )
    expect(html).toContain(
      '<img src="https://img.example.com/pic.png" alt="custom">'
    )
    expect(html).toContain(
      '<a href="https://example.com">link <img src="https://example.com/emoji/weibo/weibo_doge.png" alt=":weibo_doge:" class="cl-emoji-sticker"></a>'
    )
  })

  it("uses relative path fallback when baseUrl is omitted", async () => {
    const input = "No base: :qq_smile:"
    const html = await renderAndSanitizeMarkdown(input)
    expect(html).toContain(
      '<img src="/emoji/qq/qq_smile.gif" alt=":qq_smile:" class="cl-emoji-sticker">'
    )
  })

  it("renders emoji shortcodes in comments API using request origin as baseUrl", async () => {
    const { env } = await initializedContext()
    const prefix = activePrefix(env)
    const createRes = await request(env, "/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "/posts/emoji-test",
        content: "Great post! :douyin_666: and :qq_smile:",
        nick: "EmojiFan",
        mail: "emojifan@example.com"
      })
    })

    expect(createRes.status).toBe(201)
    const body = (await createRes.json()) as { data: CreateCommentResult }
    expect(body.data.comment.contentHtml).toContain(
      '<img src="http://worker.test/emoji/douyin/666.png" alt=":douyin_666:" class="cl-emoji-sticker">'
    )
    expect(body.data.comment.contentHtml).toContain(
      '<img src="http://worker.test/emoji/qq/qq_smile.gif" alt=":qq_smile:" class="cl-emoji-sticker">'
    )

    // 验证数据库中 content_raw 原文未变
    const row = await findCommentById(env.DB, prefix, body.data.comment.id)
    expect(row).toBeDefined()
    expect(row!.content_raw).toBe("Great post! :douyin_666: and :qq_smile:")
  })
})

describe("Emoji Sticker Uniform Sizing & Server-side Class (cl-emoji-sticker)", () => {
  const baseUrl = "https://example.com"

  it("attaches cl-emoji-sticker class to shortcode-converted images", async () => {
    const html = await renderAndSanitizeMarkdown(":qq_smile:", baseUrl)
    expect(html).toContain(
      '<img src="https://example.com/emoji/qq/qq_smile.gif" alt=":qq_smile:" class="cl-emoji-sticker">'
    )
  })

  it("attaches cl-emoji-sticker class to Markdown image with root-relative /emoji/ path", async () => {
    const html = await renderAndSanitizeMarkdown("![sticker](/emoji/x)", baseUrl)
    expect(html).toContain('<img src="/emoji/x" alt="sticker" class="cl-emoji-sticker">')
  })

  it("attaches cl-emoji-sticker class to Markdown image with same-origin absolute URL starting with /emoji/", async () => {
    const html = await renderAndSanitizeMarkdown(
      "![sticker](https://example.com/emoji/qq/qq_smile.gif)",
      baseUrl
    )
    expect(html).toContain(
      '<img src="https://example.com/emoji/qq/qq_smile.gif" alt="sticker" class="cl-emoji-sticker">'
    )
  })

  it("does NOT attach cl-emoji-sticker class to Markdown image with /img/ path", async () => {
    const html = await renderAndSanitizeMarkdown(
      "![uploaded](/img/2026/11/23/abcdef.webp)",
      baseUrl
    )
    expect(html).toContain('<img src="/img/2026/11/23/abcdef.webp" alt="uploaded">')
    expect(html).not.toContain("cl-emoji-sticker")
  })

  it("does NOT attach cl-emoji-sticker class to external domain /emoji/ path", async () => {
    const html = await renderAndSanitizeMarkdown(
      "![external](https://other.com/emoji/x)",
      baseUrl
    )
    expect(html).toContain('<img src="https://other.com/emoji/x" alt="external">')
    expect(html).not.toContain("cl-emoji-sticker")
  })

  it("does NOT attach cl-emoji-sticker class to external domain general images", async () => {
    const html = await renderAndSanitizeMarkdown(
      "![external](https://external.com/pic.png)",
      baseUrl
    )
    expect(html).toContain('<img src="https://external.com/pic.png" alt="external">')
    expect(html).not.toContain("cl-emoji-sticker")
  })

  it("preserves cl-emoji-sticker through rehypeSanitize while stripping non-cl- class names on img", async () => {
    const md = "![sticker](/emoji/qq/qq_smile.gif)"
    const html = await renderAndSanitizeMarkdown(md, baseUrl)
    expect(html).toContain('class="cl-emoji-sticker"')
  })

  it("handles mixed content with shortcodes, relative stickers, uploads, and external emojis", async () => {
    const md = [
      ":qq_smile:",
      "![rel](/emoji/douyin/666.png)",
      "![abs](https://example.com/emoji/weibo/weibo_doge.png)",
      "![upload](/img/avatar.png)",
      "![ext](https://evil.org/emoji/fake.gif)"
    ].join("\n\n")

    const html = await renderAndSanitizeMarkdown(md, baseUrl)
    expect(html).toContain(
      '<img src="https://example.com/emoji/qq/qq_smile.gif" alt=":qq_smile:" class="cl-emoji-sticker">'
    )
    expect(html).toContain(
      '<img src="/emoji/douyin/666.png" alt="rel" class="cl-emoji-sticker">'
    )
    expect(html).toContain(
      '<img src="https://example.com/emoji/weibo/weibo_doge.png" alt="abs" class="cl-emoji-sticker">'
    )
    expect(html).toContain(
      '<img src="/img/avatar.png" alt="upload">'
    )
    expect(html).toContain(
      '<img src="https://evil.org/emoji/fake.gif" alt="ext">'
    )
  })
})
