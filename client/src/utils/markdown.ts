/**
 * 客户端轻量实时预览 Markdown 解析器（规格 §7、用户裁决附带约束）。
 *
 * 【约束准则】：
 * 1. 本渲染器只保留最小子集：段落 / 换行 / 行内代码 / 多行代码块 / 粗斜体 / 引用 / 安全链接 / @用户高亮；
 * 2. 严禁向完整 Markdown 解析能力演进；若日后需要完整能力改用成熟依赖；
 * 3. 预览前先严格进行纯文本实体转义，再彻底过滤 javascript: / data: / vbscript: 伪协议链接；
 * 4. 预览 ≠ 最终，最终展示的 contentHtml 恒由服务端 unified 链安全产出。
 */

import { resolveCachedEmojiUrl } from "./emoji"

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function sanitizeUrl(url: string): string {
  const clean = url.trim().replace(/\s+/g, "")
  if (/^(?:javascript|data|vbscript):/i.test(clean)) {
    return "#"
  }
  return clean
}

export function isSafeHttpUrl(url?: string): boolean {
  if (!url) return false
  const clean = url.trim().replace(/\s+/g, "")
  return /^https?:\/\//i.test(clean)
}

export function renderMarkdownPreview(
  markdown: string,
  options?: { serverUrl?: string }
): string {
  if (!markdown?.trim()) return ""

  // 1. 全文 HTML 实体转义，扼杀任何嵌入的 <script>、<iframe>、<img onerror> 等
  let text = escapeHtml(markdown)

  // 2. 多行代码块 ```code```
  const codeBlocks: string[] = []
  text = text.replace(
    /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g,
    (_, lang, code) => {
      const idx = codeBlocks.length
      codeBlocks.push(
        `<pre class="cl-code-block"><code class="${lang ? `language-${lang}` : ""}">${code.trim()}</code></pre>`
      )
      return `§§§CODEBLOCK${idx}§§§`
    }
  )

  // 3. 行内代码 `code`
  text = text.replace(/`([^`\n]+)`/g, '<code class="cl-inline-code">$1</code>')

  // 4. @用户高亮 (例如: @张三 )
  text = text.replace(
    /(?:^|\s)@([a-zA-Z0-9_\u4e00-\u9fa5]+)/g,
    (_match, username) => {
      return ` <span class="cl-at-user">@${username}</span>`
    }
  )

  // 5. 图片 ![alt](url) - 严格仅允许 http/https 协议
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, rawUrl) => {
    if (!isSafeHttpUrl(rawUrl)) {
      return ""
    }
    const safe = sanitizeUrl(rawUrl)
    return `<img src="${safe}" alt="${alt}" class="cl-md-img" loading="lazy">`
  })

  // 6. 链接 [text](url) - 过滤危险伪协议
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, rawUrl) => {
    const safe = sanitizeUrl(rawUrl)
    return `<a href="${safe}" target="_blank" rel="nofollow ugc noopener" class="cl-link">${label}</a>`
  })

  // 7. 短码 :<group>_<key>: -> 行内小图（仅限启用贴纸组：qq/weibo/bilibili/douyin）
  text = text.replace(
    /:(qq|weibo|bilibili|douyin)_([^:\s]+):/g,
    (fullMatch, group, name) => {
      const url = resolveCachedEmojiUrl(group, name, options?.serverUrl)
      if (!url) {
        return fullMatch
      }
      return `<img src="${url}" alt=":${group}_${name}:" class="cl-emoji-inline-img" loading="lazy" style="height:1.25em;width:1.25em;vertical-align:-0.2em;display:inline-block;object-fit:contain;">`
    }
  )

  // 8. 粗体 **bold**
  text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")

  // 9. 斜体 *italic*
  text = text.replace(/\*(.*?)\*/g, "<em>$1</em>")

  // 10. 引用块 > quote (按行解析)
  const lines = text.split("\n")
  const processedLines: string[] = []
  let inBlockquote = false
  let quoteBuffer: string[] = []

  for (const line of lines) {
    if (line.startsWith("&gt; ")) {
      inBlockquote = true
      quoteBuffer.push(line.slice(5))
    } else {
      if (inBlockquote) {
        processedLines.push(
          `<blockquote class="cl-blockquote">${quoteBuffer.join("<br>")}</blockquote>`
        )
        quoteBuffer = []
        inBlockquote = false
      }
      processedLines.push(line)
    }
  }

  if (inBlockquote) {
    processedLines.push(
      `<blockquote class="cl-blockquote">${quoteBuffer.join("<br>")}</blockquote>`
    )
  }

  let html = processedLines.join("\n")

  // 11. 段落与空行处理：双换行视作段落，单换行视作 <br>
  html = html
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("")

  // 12. 还原多行代码块占位符
  html = html.replace(/<p>§§§CODEBLOCK(\d+)§§§<\/p>/g, (_, idx) => {
    return codeBlocks[Number(idx)] || ""
  })
  html = html.replace(/§§§CODEBLOCK(\d+)§§§/g, (_, idx) => {
    return codeBlocks[Number(idx)] || ""
  })

  return html
}
