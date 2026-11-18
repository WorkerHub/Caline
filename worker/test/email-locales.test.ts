/**
 * 规格 §7-10（邮件部分）：zh/en 两份模板同时存在，新增邮件类型必须补两种语言；
 * 语言代码只接受支持集。
 */
import { describe, expect, it } from "vitest"
import {
  buildAuthUiPath,
  normalizeLanguage,
  renderCodeEmail,
  renderTestEmail,
  SUPPORTED_LANGUAGES,
  type CodeEmailPurpose
} from "../src/locales/email"

const PURPOSES: CodeEmailPurpose[] = [
  "register_verify",
  "password_reset",
  "email_2fa"
]

describe("邮件模板双语", () => {
  it("两种语言 × 两种用途都有完整 subject/html/text，且不互相等同", () => {
    for (const purpose of PURPOSES) {
      const zh = renderCodeEmail("zh", purpose, "123456")
      const en = renderCodeEmail("en", purpose, "123456")
      for (const content of [zh, en]) {
        expect(content.subject.length).toBeGreaterThan(0)
        expect(content.html).toContain("123456")
        expect(content.text).toContain("123456")
      }
      expect(zh.subject).not.toBe(en.subject)
      expect(zh.html).not.toBe(en.html)
      expect(zh.text).not.toBe(en.text)
    }
  })

  it("测试邮件同样双语", () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const content = renderTestEmail(language)
      expect(content.subject.length).toBeGreaterThan(0)
      expect(content.html.length).toBeGreaterThan(0)
      expect(content.text.length).toBeGreaterThan(0)
    }
    expect(renderTestEmail("zh").subject).not.toBe(
      renderTestEmail("en").subject
    )
  })

  it("语言代码归一化只接受 zh/en", () => {
    expect(normalizeLanguage("zh")).toBe("zh")
    expect(normalizeLanguage("EN")).toBe("en")
    expect(normalizeLanguage(" en ")).toBe("en")
    expect(normalizeLanguage("ja")).toBeNull()
    expect(normalizeLanguage(undefined)).toBeNull()
    expect(normalizeLanguage(42)).toBeNull()
  })

  it("buildAuthUiPath 生成规范的 /ui 前缀路径（规格 §8 修订）", () => {
    expect(buildAuthUiPath("")).toBe("/ui")
    expect(buildAuthUiPath("/")).toBe("/ui")
    expect(buildAuthUiPath("/forgot-password")).toBe("/ui/forgot-password")
    expect(buildAuthUiPath("forgot-password")).toBe("/ui/forgot-password")
    expect(buildAuthUiPath("/login")).toBe("/ui/login")
    expect(buildAuthUiPath("/setup")).toBe("/ui/setup")
    expect(buildAuthUiPath("/register")).toBe("/ui/register")
  })

  it("邮件模板中若包含 URL 则必须带 /ui 前缀，严禁指向根路径", () => {
    for (const purpose of PURPOSES) {
      for (const lang of SUPPORTED_LANGUAGES) {
        const content = renderCodeEmail(lang, purpose, "123456")
        // 如果出现形如 href="/login"、href="/forgot-password" 等无 /ui 前缀的根路径链接则失败
        expect(content.html).not.toMatch(/href="\/(?!ui)[^"]*"/)
      }
    }
  })
})
