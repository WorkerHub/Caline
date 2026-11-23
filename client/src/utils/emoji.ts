/**
 * 表情面板基础集（通用 Unicode Emoji，按笑脸手势、日常两组归类）。
 * 纯原生字符，零网络请求、零额外依赖。
 */

import type { LocaleKey } from "../i18n/locales"

export const EMOJI_BASE_SET = [
  // 笑脸与手势
  "😀",
  "😃",
  "😄",
  "😁",
  "😆",
  "😅",
  "🤣",
  "😂",
  "🙂",
  "🙃",
  "😉",
  "😊",
  "😇",
  "🥰",
  "😍",
  "🤩",
  "😘",
  "😋",
  "😜",
  "🤔",
  "🤫",
  "🤗",
  "🤐",
  "🫡",
  "👍",
  "👎",
  "👏",
  "🙌",
  "🤝",
  "🙏",
  "✌️",
  "🎉",
  // 日常与心情
  "🔥",
  "✨",
  "💯",
  "❤️",
  "💔",
  "🌟",
  "💡",
  "☕",
  "👀",
  "🚀",
  "💪",
  "😎",
  "🥺",
  "😭",
  "😤",
  "😴"
]

export interface EmojiGroupInfo {
  id: string
  nameKey: LocaleKey
  type: "unicode" | "image"
}

export const EMOJI_GROUPS: EmojiGroupInfo[] = [
  { id: "default", nameKey: "emoji_group_default", type: "unicode" },
  { id: "qq", nameKey: "emoji_group_qq", type: "image" },
  { id: "weibo", nameKey: "emoji_group_weibo", type: "image" },
  { id: "bilibili", nameKey: "emoji_group_bilibili", type: "image" },
  { id: "douyin", nameKey: "emoji_group_douyin", type: "image" }
]

const emojiManifestCache = new Map<string, Record<string, string>>()
const inFlightFetches = new Map<string, Promise<Record<string, string>>>()

export async function fetchEmojiManifest(
  serverUrl: string,
  group: string
): Promise<Record<string, string>> {
  const cacheKey = `${serverUrl}:${group}`
  if (emojiManifestCache.has(cacheKey)) {
    return emojiManifestCache.get(cacheKey)!
  }

  const existing = inFlightFetches.get(cacheKey)
  if (existing) {
    return existing
  }

  const base = serverUrl.replace(/\/+$/, "")
  const manifestUrl = `${base}/emoji/${group}/manifest.json`

  const fetchPromise = (async () => {
    const res = await fetch(manifestUrl)
    if (!res.ok) {
      throw new Error(`Failed to load emoji manifest: status ${res.status}`)
    }
    const data = (await res.json()) as Record<string, string>
    emojiManifestCache.set(cacheKey, data)
    return data
  })().finally(() => {
    inFlightFetches.delete(cacheKey)
  })

  inFlightFetches.set(cacheKey, fetchPromise)
  return fetchPromise
}

export async function prefetchEmojiManifests(serverUrl: string): Promise<void> {
  const imageGroups = EMOJI_GROUPS.filter((g) => g.type === "image")
  await Promise.allSettled(
    imageGroups.map((g) => fetchEmojiManifest(serverUrl, g.id))
  )
}

export function resolveCachedEmojiUrl(
  group: string,
  name: string,
  serverUrl?: string
): string | null {
  if (serverUrl) {
    const key = `${serverUrl}:${group}`
    const manifest = emojiManifestCache.get(key)
    if (manifest && Object.hasOwn(manifest, name)) {
      return resolveEmojiImageUrl(serverUrl, group, manifest[name])
    }
  }

  for (const [cacheKey, manifest] of emojiManifestCache.entries()) {
    const lastColon = cacheKey.lastIndexOf(":")
    if (lastColon === -1) continue
    const cachedGroup = cacheKey.slice(lastColon + 1)
    const cachedServerUrl = cacheKey.slice(0, lastColon)

    if (cachedGroup === group && Object.hasOwn(manifest, name)) {
      return resolveEmojiImageUrl(cachedServerUrl, group, manifest[name])
    }
  }

  return null
}

export function resolveEmojiImageUrl(
  serverUrl: string,
  group: string,
  relPath: string
): string {
  if (relPath.startsWith("http://") || relPath.startsWith("https://")) {
    return relPath
  }
  const base = serverUrl.replace(/\/+$/, "")
  if (relPath.startsWith("/")) {
    return `${base}${relPath}`
  }
  return `${base}/emoji/${group}/${relPath}`
}

export function clearEmojiCache(): void {
  emojiManifestCache.clear()
  inFlightFetches.clear()
}
