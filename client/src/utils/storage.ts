/**
 * Caline 访客本地缓存管理：
 * 1. 访客三件套（nick / mail / link）记忆与预填；
 * 2. 访客评论 15 分钟编辑/删除 token 管理（caline_edit_tokens）；
 * 3. 访客本地点赞状态记录（caline_liked_comments）。
 */

const GUEST_PROFILE_KEY = "caline_guest_profile"
const EDIT_TOKENS_KEY = "caline_edit_tokens"
const LIKED_COMMENTS_KEY = "caline_liked_comments"

export interface GuestProfile {
  nick: string
  mail?: string
  link?: string
}

export interface StoredEditToken {
  token: string
  expiresAt: number // timestamp ms
}

export function getGuestProfile(): GuestProfile {
  if (typeof window === "undefined" || !window.localStorage) {
    return { nick: "", mail: "", link: "" }
  }
  try {
    const raw = localStorage.getItem(GUEST_PROFILE_KEY)
    if (!raw) return { nick: "", mail: "", link: "" }
    return JSON.parse(raw) as GuestProfile
  } catch {
    return { nick: "", mail: "", link: "" }
  }
}

export function saveGuestProfile(profile: GuestProfile): void {
  if (typeof window === "undefined" || !window.localStorage) return
  try {
    localStorage.setItem(GUEST_PROFILE_KEY, JSON.stringify(profile))
  } catch {
    // ignore
  }
}

export function getEditToken(commentId: number): string | null {
  if (typeof window === "undefined" || !window.localStorage) return null
  try {
    const raw = localStorage.getItem(EDIT_TOKENS_KEY)
    if (!raw) return null
    const tokens = JSON.parse(raw) as Record<string, StoredEditToken>
    const item = tokens[commentId]
    if (!item) return null
    if (Date.now() > item.expiresAt) {
      delete tokens[commentId]
      localStorage.setItem(EDIT_TOKENS_KEY, JSON.stringify(tokens))
      return null
    }
    return item.token
  } catch {
    return null
  }
}

export function saveEditToken(commentId: number, token: string): void {
  if (typeof window === "undefined" || !window.localStorage) return
  try {
    const raw = localStorage.getItem(EDIT_TOKENS_KEY)
    const tokens = raw
      ? (JSON.parse(raw) as Record<string, StoredEditToken>)
      : {}
    // 15 分钟窗口
    tokens[commentId] = {
      token,
      expiresAt: Date.now() + 15 * 60 * 1000
    }
    // 清理过期 tokens
    const now = Date.now()
    for (const id of Object.keys(tokens)) {
      if (tokens[id].expiresAt < now) {
        delete tokens[id]
      }
    }
    localStorage.setItem(EDIT_TOKENS_KEY, JSON.stringify(tokens))
  } catch {
    // ignore
  }
}

export function removeEditToken(commentId: number): void {
  if (typeof window === "undefined" || !window.localStorage) return
  try {
    const raw = localStorage.getItem(EDIT_TOKENS_KEY)
    if (!raw) return
    const tokens = JSON.parse(raw) as Record<string, StoredEditToken>
    delete tokens[commentId]
    localStorage.setItem(EDIT_TOKENS_KEY, JSON.stringify(tokens))
  } catch {
    // ignore
  }
}

export function isCommentLiked(commentId: number): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false
  try {
    const raw = localStorage.getItem(LIKED_COMMENTS_KEY)
    if (!raw) return false
    const set = JSON.parse(raw) as number[]
    return set.includes(commentId)
  } catch {
    return false
  }
}

export function markCommentLiked(commentId: number): void {
  if (typeof window === "undefined" || !window.localStorage) return
  try {
    const raw = localStorage.getItem(LIKED_COMMENTS_KEY)
    const set: number[] = raw ? JSON.parse(raw) : []
    if (!set.includes(commentId)) {
      set.push(commentId)
      localStorage.setItem(LIKED_COMMENTS_KEY, JSON.stringify(set))
    }
  } catch {
    // ignore
  }
}
