import { describe, expect, it } from "vitest"
import {
  countLinks,
  decideCommentStatus,
  hasDisallowedWords,
  isDomainAllowed,
  isNickReserved,
  renderAndSanitizeMarkdown
} from "../src/core/pipeline"
import { formatGravatarUrl, mailMd5 } from "../src/core/gravatar"

describe("Comments Pipeline", () => {
  it("renders Markdown and syntax highlights code blocks with hljs", async () => {
    const md = "Hello **world**!\n\n```js\nconst greeting = 'hi';\n```"
    const html = await renderAndSanitizeMarkdown(md)

    expect(html).toContain("<p>Hello <strong>world</strong>!</p>")
    expect(html).toContain('<code class="language-js">')
    expect(html).toContain('<span class="hljs-keyword">const</span>')
  })

  it("sanitizes dangerous HTML, scripts, event handlers, and javascript: links", async () => {
    const malicious = `
# Dangerous Comment

<script>alert('xss')</script>
<img src="x" onerror="alert(1)" />
<a href="javascript:alert(2)">Click me</a>

[Safe link](https://example.com)
`
    const html = await renderAndSanitizeMarkdown(malicious)

    expect(html).not.toContain("<script")
    expect(html).not.toContain("alert('xss')")
    expect(html).not.toContain("onerror")
    expect(html).not.toContain("javascript:")
    expect(html).toContain('<a href="https://example.com">Safe link</a>')
  })

  it("checks safe domains against origin or referer", () => {
    const safeDomains = ["https://example.com", "myblog.org"]

    expect(isDomainAllowed("https://example.com", safeDomains)).toBe(true)
    expect(isDomainAllowed("https://sub.myblog.org/page", safeDomains)).toBe(
      true
    )
    expect(isDomainAllowed("https://evil.com", safeDomains)).toBe(false)
    expect(isDomainAllowed(null, safeDomains)).toBe(false)
    expect(isDomainAllowed("https://anything.com", [])).toBe(true)
  })

  it("counts links accurately in raw markdown and html", () => {
    const text = "Check https://site1.com and https://site2.com"
    const html =
      '<p><a href="https://site1.com">1</a> <a href="https://site2.com">2</a></p>'
    expect(countLinks(text, html)).toBe(2)

    const text1 = "Single link https://example.com"
    expect(countLinks(text1, "<p>Single link</p>")).toBe(1)
  })

  it("detects disallowed words in comment text", () => {
    const words = ["badword", "casino"]
    expect(hasDisallowedWords("This is normal", words)).toBe(false)
    expect(hasDisallowedWords("Great BadWord here", words)).toBe(true)
    expect(hasDisallowedWords("Visit our casino now", words)).toBe(true)
  })

  it("checks reserved nicknames against custom list and admin names", () => {
    const reserved = ["admin", "root"]
    const admins = ["SiteOwner", "CalineAdmin"]

    expect(isNickReserved("Admin", reserved, admins)).toBe(true)
    expect(isNickReserved("siteowner", reserved, admins)).toBe(true)
    expect(isNickReserved("regular_user", reserved, admins)).toBe(false)
  })

  it("decides comment status according to priority rules", () => {
    // 1. Spam takes priority over everything
    expect(
      decideCommentStatus({
        isSpam: true,
        auditSwitch: false,
        isLoggedIn: true,
        linksCount: 0,
        hasApprovedHistory: true
      })
    ).toBe("spam")

    // 2. Audit switch forces waiting for all (even logged-in)
    expect(
      decideCommentStatus({
        isSpam: false,
        auditSwitch: true,
        isLoggedIn: true,
        linksCount: 0,
        hasApprovedHistory: true
      })
    ).toBe("waiting")

    // 3. Logged-in default approved
    expect(
      decideCommentStatus({
        isSpam: false,
        auditSwitch: false,
        isLoggedIn: true,
        linksCount: 0,
        hasApprovedHistory: false
      })
    ).toBe("approved")

    // 4. Guest with >= 2 links forced waiting
    expect(
      decideCommentStatus({
        isSpam: false,
        auditSwitch: false,
        isLoggedIn: false,
        linksCount: 2,
        hasApprovedHistory: true
      })
    ).toBe("waiting")

    // 5. Guest trust tier: with approved history -> approved; without -> waiting
    expect(
      decideCommentStatus({
        isSpam: false,
        auditSwitch: false,
        isLoggedIn: false,
        linksCount: 1,
        hasApprovedHistory: true
      })
    ).toBe("approved")

    expect(
      decideCommentStatus({
        isSpam: false,
        auditSwitch: false,
        isLoggedIn: false,
        linksCount: 0,
        hasApprovedHistory: false
      })
    ).toBe("waiting")
  })

  it("computes Gravatar hash and formatted URL with mirror support", () => {
    const email = "Test@Example.com "
    const hash = mailMd5(email)
    // MD5 of "test@example.com" is 55502f40dc8b7c769880b10874abc9d0
    expect(hash).toBe("55502f40dc8b7c769880b10874abc9d0")

    const url = formatGravatarUrl(
      email,
      "Tester",
      "https://cravatar.cn/avatar/"
    )
    expect(url).toContain(
      "https://cravatar.cn/avatar/55502f40dc8b7c769880b10874abc9d0?d=identicon"
    )

    // Without email: fallback to nick seed
    const fallbackUrl = formatGravatarUrl(
      null,
      "GuestNick",
      "https://cravatar.cn/avatar"
    )
    expect(fallbackUrl).toContain("https://cravatar.cn/avatar/")
    expect(fallbackUrl).toContain("?d=identicon")
  })
})
