/**
 * 评论发表与审核流水线（规格 §5、§6、§9）。
 *
 * 核心流程：
 * 1. 安全域名校验（Origin/Referer 白名单）
 * 2. Turnstile 校验（开启时）
 * 3. IP 频率限制（默认 60 秒 1 条，D1 计数）
 * 4. 内容处理（unified 渲染+清洗链）
 * 5. 违禁词、IP 黑名单、访客反冒充与反垃圾
 * 6. 定 status（信任分级、审核总开关、违禁词优先）
 * 7. 入库后异步（waitUntil）给管理员发 eNotify 通知
 */
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import rehypeHighlight from "rehype-highlight"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import rehypeStringify from "rehype-stringify"
import type { CommentStatus } from "@caline/shared"

// 扩展 GitHub 默认 schema，放行 hljs 与 language-* 类名，并放行 img 及其属性（alt, title, src），协议严格限 http(s)
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code || []),
      ["className", /^language-./, "hljs"]
    ],
    span: [...(defaultSchema.attributes?.span || []), ["className", /^hljs-./]],
    img: [
      ...(defaultSchema.attributes?.img || []),
      "alt",
      "title",
      "src",
      "loading",
      "width",
      "height"
    ]
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ["http", "https"]
  }
}

/** 统一 Markdown 渲染与清洗处理链（纯 ESM、原生无 jsdom 依赖） */
export async function renderAndSanitizeMarkdown(
  markdown: string
): Promise<string> {
  const result = await unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeHighlight)
    .use(rehypeSanitize as any, SANITIZE_SCHEMA)
    .use(rehypeStringify)
    .process(markdown)

  return String(result)
}

function extractHostnameAndOrigin(urlOrHost: string): {
  hostname: string
  origin: string | null
} {
  const trimmed = urlOrHost.trim().toLowerCase()
  try {
    const parsed = new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`
    )
    return {
      hostname: parsed.hostname.toLowerCase(),
      origin: trimmed.includes("://") ? parsed.origin.toLowerCase() : null
    }
  } catch {
    const hostOnly = trimmed.split("/")[0].split(":")[0].toLowerCase()
    return { hostname: hostOnly, origin: null }
  }
}

/** 安全域名比对（支持纯主机名或带协议前缀比对，仅允许完全匹配或合法子域名） */
export function isDomainAllowed(
  headerVal: string | null | undefined,
  safeDomains: string[]
): boolean {
  if (!safeDomains || safeDomains.length === 0) return true
  if (!headerVal) return false

  const candidate = extractHostnameAndOrigin(headerVal)
  if (!candidate.hostname) return false

  for (const domain of safeDomains) {
    const trimmed = domain.trim().toLowerCase()
    if (!trimmed) continue

    const allowed = extractHostnameAndOrigin(trimmed)
    if (!allowed.hostname) continue

    // 双方均提供了协议来源且完全相等（例如 https://example.com）
    if (
      candidate.origin &&
      allowed.origin &&
      candidate.origin === allowed.origin
    ) {
      return true
    }

    // 主机名精确比对或合法子域名比对（如 sub.myblog.org 属于 myblog.org）
    if (
      candidate.hostname === allowed.hostname ||
      candidate.hostname.endsWith(`.${allowed.hostname}`)
    ) {
      return true
    }
  }
  return false
}

/** 校验 Cloudflare Turnstile token */
export async function verifyTurnstile(
  secretKey: string,
  token: string,
  remoteIp?: string
): Promise<boolean> {
  try {
    const formData = new FormData()
    formData.append("secret", secretKey)
    formData.append("response", token)
    if (remoteIp) formData.append("remoteip", remoteIp)

    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: formData
      }
    )
    if (!res.ok) return false
    const data = (await res.json()) as { success: boolean }
    return Boolean(data.success)
  } catch (err) {
    console.error("Turnstile verification error:", err)
    return false
  }
}

/** 统计正文中的链接数（http/https 或 a 标签） */
export function countLinks(raw: string, html: string): number {
  const rawMatches = raw.match(/https?:\/\/[^\s)]+/gi) || []
  const htmlMatches = html.match(/<a\s+[^>]*href=/gi) || []
  return Math.max(rawMatches.length, htmlMatches.length)
}

/** 检查违禁词命中 */
export function hasDisallowedWords(
  text: string,
  disallowedWords: string[]
): boolean {
  if (!disallowedWords || disallowedWords.length === 0) return false
  const lower = text.toLowerCase()
  for (const word of disallowedWords) {
    const trimmed = word.trim().toLowerCase()
    if (trimmed && lower.includes(trimmed)) return true
  }
  return false
}

/** 检查昵称是否命中保留词（管理员昵称 + 自定义保留词） */
export function isNickReserved(
  nick: string,
  reservedNicks: string[],
  adminNicks: string[]
): boolean {
  const normalized = nick.trim().toLowerCase()
  if (!normalized) return false

  const allReserved = [...reservedNicks, ...adminNicks]
  for (const word of allReserved) {
    const trimmed = word.trim().toLowerCase()
    if (trimmed && normalized === trimmed) return true
  }
  return false
}

export interface StatusDecisionParams {
  isSpam: boolean
  auditSwitch: boolean
  isLoggedIn: boolean
  linksCount: number
  hasApprovedHistory: boolean
}

/** 定 status：违禁词 spam > 审核总开关 waiting > 访客多链接 waiting > 信任分级 */
export function decideCommentStatus(
  params: StatusDecisionParams
): CommentStatus {
  if (params.isSpam) return "spam"
  if (params.auditSwitch) return "waiting"

  if (params.isLoggedIn) {
    return "approved"
  }

  // 访客专属规则：链接数 ≥ 2 强制 waiting
  if (params.linksCount >= 2) {
    return "waiting"
  }

  // 信任分级：有 approved 历史直接 approved；无历史（首次）waiting
  return params.hasApprovedHistory ? "approved" : "waiting"
}

/** 发送 eNotify 管理员异步通知 */
export async function sendEnotifyNotification(
  keyOrUrl: string,
  notification: { title: string; content: string }
): Promise<void> {
  try {
    const trimmed = keyOrUrl.trim()
    let endpoint = trimmed
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      endpoint = `https://api.enotify.app/send/${encodeURIComponent(trimmed)}`
    }

    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: notification.title,
        content: notification.content
      })
    })
  } catch (err) {
    console.error("eNotify dispatch failed:", err)
  }
}
