import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  applyTheme,
  readStoredTheme,
  resolveTheme,
  THEME_STORAGE_KEY
} from "@/lib/theme"

describe("三档主题解析", () => {
  it("auto 跟随系统，其余原样", () => {
    expect(resolveTheme("auto", true)).toBe("dark")
    expect(resolveTheme("auto", false)).toBe("light")
    expect(resolveTheme("light", true)).toBe("light")
    expect(resolveTheme("dark", false)).toBe("dark")
  })
})

describe("主题落 DOM", () => {
  it("applyTheme 切 .dark 与 color-scheme", () => {
    applyTheme("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe("dark")

    applyTheme("light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe("light")
  })
})

describe("主题持久化", () => {
  it("读 zustand persist 的 JSON 形态，也兼容裸字符串", () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ state: { theme: "dark" }, version: 0 })
    )
    expect(readStoredTheme()).toBe("dark")

    localStorage.setItem(THEME_STORAGE_KEY, "light")
    expect(readStoredTheme()).toBe("light")

    localStorage.setItem(THEME_STORAGE_KEY, "purple")
    expect(readStoredTheme()).toBeNull()
  })

  it("首屏内联脚本与 store 用同一个存储键，且在包体之前执行", () => {
    const html = readFileSync(
      path.resolve(process.cwd(), "ui/index.html"),
      "utf8"
    )
    expect(html).toContain(`localStorage.getItem("${THEME_STORAGE_KEY}")`)
    const scriptAt = html.indexOf("localStorage.getItem")
    const moduleAt = html.indexOf("/src/main.tsx")
    expect(scriptAt).toBeGreaterThan(0)
    expect(moduleAt).toBeGreaterThan(scriptAt)
  })
})

describe("后台贴纸尺寸规范", () => {
  it("web/src/index.css 给 .cl-emoji-sticker 与 img[src*='/emoji/'] 定高 28px、width: auto", () => {
    const css = readFileSync(
      path.resolve(import.meta.dirname, "../index.css"),
      "utf8"
    )
    expect(css).toContain(".cl-emoji-sticker")
    expect(css).toContain('img[src*="/emoji/"]')
    expect(css).toContain("height: 28px")
    expect(css).toContain("width: auto")
  })
})

describe("后台图片显示约束", () => {
  it("web/src/index.css 给评论正文与预览区普通图片配置 max-width: 100%、height: auto、max-height: 480px", () => {
    const css = readFileSync(
      path.resolve(import.meta.dirname, "../index.css"),
      "utf8"
    )
    expect(css).toContain(".cl-comment-text img")
    expect(css).toContain(".cl-editor-preview img")
    expect(css).toContain("max-width: 100%")
    expect(css).toContain("height: auto")
    expect(css).toContain("max-height: 480px")
    expect(css).toContain("object-fit: contain")
  })

  it("后台普通图片（/img/ 与外链图）生效 max-width/height/max-height 约束，贴纸保持 28px 定高", () => {
    const css = readFileSync(
      path.resolve(import.meta.dirname, "../index.css"),
      "utf8"
    )
    const styleEl = document.createElement("style")
    styleEl.textContent = css
    document.head.appendChild(styleEl)

    const container = document.createElement("div")
    container.className = "cl-comment-text"
    container.innerHTML = `
      <img id="admin-img-upload" src="/img/2026/11/23/test.webp" />
      <img id="admin-img-external" src="https://example.com/photo.jpg" />
      <img id="admin-sticker" src="https://example.com/emoji/qq/doge.png" class="cl-emoji-sticker" />
    `
    document.body.appendChild(container)

    try {
      const uploadImg = document.getElementById("admin-img-upload")!
      const externalImg = document.getElementById("admin-img-external")!
      const stickerImg = document.getElementById("admin-sticker")!

      const uploadStyle = window.getComputedStyle(uploadImg)
      expect(uploadStyle.maxWidth).toBe("100%")
      expect(uploadStyle.maxHeight).toBe("480px")
      expect(uploadStyle.height).toBe("auto")

      const externalStyle = window.getComputedStyle(externalImg)
      expect(externalStyle.maxWidth).toBe("100%")
      expect(externalStyle.maxHeight).toBe("480px")
      expect(externalStyle.height).toBe("auto")

      const stickerStyle = window.getComputedStyle(stickerImg)
      expect(stickerStyle.height).toBe("28px")
      expect(stickerStyle.maxHeight).toBe("28px")
      expect(stickerStyle.width).toBe("auto")
    } finally {
      styleEl.remove()
      container.remove()
    }
  })
})
