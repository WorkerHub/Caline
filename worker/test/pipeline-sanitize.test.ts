import { describe, expect, it } from "vitest"
import { renderAndSanitizeMarkdown } from "../src/core/pipeline"

describe("Markdown Pipeline Sanitize: Image Support & Security", () => {
  it("allows https and http images with alt and title attributes", async () => {
    const md =
      '![Sample Picture](https://example.com/picture.png "Image Title")'
    const html = await renderAndSanitizeMarkdown(md)

    expect(html).toContain("<img")
    expect(html).toContain('src="https://example.com/picture.png"')
    expect(html).toContain('alt="Sample Picture"')
    expect(html).toContain('title="Image Title"')
  })

  it("allows relative /img/<key> paths with alt and title", async () => {
    const md = '![Uploaded Image](/img/2026/11/23/abcdef.webp "Uploaded Title")'
    const html = await renderAndSanitizeMarkdown(md)

    expect(html).toContain("<img")
    expect(html).toContain('src="/img/2026/11/23/abcdef.webp"')
    expect(html).toContain('alt="Uploaded Image"')
    expect(html).toContain('title="Uploaded Title"')
  })

  it("strips javascript: pseudo-protocol from image src", async () => {
    const md = '![Dangerous](javascript:alert("XSS"))'
    const html = await renderAndSanitizeMarkdown(md)

    expect(html).not.toContain("javascript:")
    expect(html).not.toContain("alert")
    expect(html).toContain('<img alt="Dangerous">')
  })

  it("strips data: URI from image src", async () => {
    const md =
      "![Data URI](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)"
    const html = await renderAndSanitizeMarkdown(md)

    expect(html).not.toContain("data:image")
    expect(html).not.toContain("base64")
    expect(html).toContain('<img alt="Data URI">')
  })

  it("strips raw HTML script and dangerous handlers inside img tag", async () => {
    const rawHtml = '<img src="https://example.com/pic.png" onerror="alert(1)">'
    const html = await renderAndSanitizeMarkdown(rawHtml)

    expect(html).not.toContain("onerror")
    expect(html).not.toContain("alert")
  })
})
