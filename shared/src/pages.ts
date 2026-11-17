/**
 * 页面浏览量与 Reaction 接口契约（规格 §4、§7）。
 */

export type ReactionIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

/** POST /api/pages/view 请求体 */
export interface PageViewInput {
  url: string
}

/** POST /api/pages/view 响应 data 形状 */
export interface PageViewResult {
  url: string
  pageview: number
}

/** POST /api/pages/reaction 请求体 */
export interface PageReactionInput {
  url: string
  type: ReactionIndex | number
}

/** 页面 reaction0..8 计数完整结构 */
export interface PageReactions {
  reaction0: number
  reaction1: number
  reaction2: number
  reaction3: number
  reaction4: number
  reaction5: number
  reaction6: number
  reaction7: number
  reaction8: number
}

/** POST /api/pages/reaction 响应 data 形状 */
export interface PageReactionResult {
  url: string
  pageview: number
  reactions: PageReactions
}
