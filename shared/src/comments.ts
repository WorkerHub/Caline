/**
 * 公开评论区接口契约（规格 §4、§6、§7）。
 *
 * 遵循原则：
 * - 访客 mail、ip、ua 绝对不出现在公开评论接口响应中（仅返回头像与脱敏信息）；
 * - 根评论分页返回，子回复平铺挂在根评论下，含 replyTo 对应被回复人信息；
 * - 访客发后 15 分钟内改/删评论凭 X-Edit-Token 校验；
 * - 响应统一包在 ApiSuccess<T> 即 `{ data: T }` 信封中。
 */

export type CommentStatus = "approved" | "waiting" | "spam"

export type CommentSortOrder = "newest" | "oldest" | "hottest"

/** 被回复对象摘要（子回复挂靠用） */
export interface CommentReplyTo {
  id: number
  nick: string
  userId: number | null
}

/** 子回复平铺展示项（挂在根评论 replies 下） */
export interface CommentPublicReplyItem {
  id: number
  userId: number | null
  nick: string
  avatar: string
  link: string
  url: string
  pid: number
  rid: number
  replyTo: CommentReplyTo | null
  contentHtml: string
  likeCount: number
  createdAt: string
  updatedAt: string
  badge?: "admin"
  level?: number
}

/** 公开评论树根节点项（根评论） */
export interface CommentPublicItem {
  id: number
  userId: number | null
  nick: string
  avatar: string
  link: string
  url: string
  contentHtml: string
  sticky: boolean
  likeCount: number
  createdAt: string
  updatedAt: string
  badge?: "admin"
  level?: number
  replies: CommentPublicReplyItem[]
}

/** 评论项类型别名（对应公开根评论项） */
export type Comment = CommentPublicItem

/** GET /api/comments 查询参数 */
export interface ListCommentsQuery {
  url: string
  page?: number
  pageSize?: number
  sort?: CommentSortOrder
}

/** GET /api/comments 响应 data 形状 */
export interface ListCommentsResult {
  items: CommentPublicItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/** POST /api/comments 请求体（发表/回复） */
export interface CreateCommentInput {
  url: string
  content: string
  pid?: number | null
  rid?: number | null
  /** 访客发表必填，登录用户缺省从会话读取 */
  nick?: string
  /** 访客可选，用于 Gravatar 计算与等级分级 */
  mail?: string
  /** 访客可选个人网站 */
  link?: string
  /** 开启 Cloudflare Turnstile 时必传前端 token */
  turnstileToken?: string
}

/** POST /api/comments 响应 data 形状 */
export interface CreateCommentResult {
  comment: {
    id: number
    url: string
    status: CommentStatus
    contentHtml: string
    createdAt: string
  }
  status: CommentStatus
  /** 访客发表成功时下发一次性令牌，存入本地并在 15 分钟内改/删；登录态评论不返回 */
  editToken?: string
}

/** PATCH /api/comments/:id 请求体（改自己的评论） */
export interface UpdateCommentInput {
  content: string
}

/** PATCH /api/comments/:id 响应 data 形状 */
export interface UpdateCommentResult {
  id: number
  contentHtml: string
  updatedAt: string
  status: CommentStatus
}

/** DELETE /api/comments/:id 响应 data 形状（删自己的评论） */
export interface DeleteCommentResult {
  success: true
  deletedId: number
}

/** POST /api/comments/:id/like 响应 data 形状 */
export interface LikeCommentResult {
  id: number
  likeCount: number
}

/** GET /api/comments/count 多页面评论数响应 data 形状：url 到评论数的映射字典 */
export type CommentCountsResult = Record<string, number>

/** 最近评论挂件展示项（GET /api/comments/recent） */
export interface RecentCommentItem {
  id: number
  url: string
  nick: string
  avatar: string
  link: string
  contentHtml: string
  createdAt: string
  badge?: "admin"
}

/** GET /api/comments/recent 响应 data 形状 */
export type RecentCommentsResult = RecentCommentItem[]

/** GET /api/me/comments 个人评论列表项（不含 ip/ua/mail） */
export interface CommentMeItem {
  id: number
  url: string
  contentRaw: string
  contentHtml: string
  status: CommentStatus
  likeCount: number
  pid: number | null
  rid: number | null
  createdAt: string
  updatedAt: string
  content_raw?: string
  content_html?: string
  like_count?: number
  created_at?: string
  updated_at?: string
}

/** GET /api/me/comments 查询参数 */
export interface ListMeCommentsQuery {
  page?: number
  pageSize?: number
}

/** GET /api/me/comments 响应 data 形状 */
export interface ListMeCommentsResult {
  items: CommentMeItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
