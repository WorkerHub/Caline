/**
 * Caline 轻量 API Client（对接 @caline/shared 契约）。
 */

import type {
  ApiResponse,
  CommentCountsResult,
  CommentSortOrder,
  CreateCommentInput,
  CreateCommentResult,
  DeleteCommentResult,
  LikeCommentResult,
  ListCommentsResult,
  PageReactionInput,
  PageReactionResult,
  PageViewInput,
  PageViewResult,
  RecentCommentsResult,
  UpdateCommentInput,
  UpdateCommentResult
} from "@caline/shared"

export class CalineApiClient {
  private serverUrl: string

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl.replace(/\/+$/, "")
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
    customHeaders: Record<string, string> = {}
  ): Promise<T> {
    const url = `${this.serverUrl}${path}`
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...customHeaders
    }

    if (options.body && typeof options.body === "string") {
      headers["Content-Type"] = "application/json"
    }

    const res = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers as Record<string, string>)
      },
      credentials: "include" // 携带可能存在的 Cookie 登录态
    })

    const json = (await res.json()) as ApiResponse<T>
    if ("error" in json) {
      throw new Error(
        json.error.message || `Request failed with code ${json.error.code}`
      )
    }

    return json.data
  }

  // 1. 获取评论列表 (GET /api/comments)
  async listComments(params: {
    url: string
    page?: number
    pageSize?: number
    sort?: CommentSortOrder
  }): Promise<ListCommentsResult> {
    const query = new URLSearchParams()
    query.set("url", params.url)
    if (params.page) query.set("page", String(params.page))
    if (params.pageSize) query.set("pageSize", String(params.pageSize))
    if (params.sort) query.set("sort", params.sort)

    return this.request<ListCommentsResult>(`/api/comments?${query.toString()}`)
  }

  // 2. 发表/回复评论 (POST /api/comments)
  async createComment(
    input: CreateCommentInput,
    token?: string
  ): Promise<CreateCommentResult> {
    const headers: Record<string, string> = {}
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
    return this.request<CreateCommentResult>("/api/comments", {
      method: "POST",
      body: JSON.stringify(input),
      headers
    })
  }

  // 3. 改自己的评论 (PATCH /api/comments/:id)
  async updateComment(
    id: number,
    input: UpdateCommentInput,
    editToken?: string
  ): Promise<UpdateCommentResult> {
    const headers: Record<string, string> = {}
    if (editToken) {
      headers["X-Edit-Token"] = editToken
    }
    return this.request<UpdateCommentResult>(`/api/comments/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
      headers
    })
  }

  // 4. 删自己的评论 (DELETE /api/comments/:id)
  async deleteComment(
    id: number,
    editToken?: string
  ): Promise<DeleteCommentResult> {
    const headers: Record<string, string> = {}
    if (editToken) {
      headers["X-Edit-Token"] = editToken
    }
    return this.request<DeleteCommentResult>(`/api/comments/${id}`, {
      method: "DELETE",
      headers
    })
  }

  // 5. 点赞评论 (POST /api/comments/:id/like)
  async likeComment(id: number): Promise<LikeCommentResult> {
    return this.request<LikeCommentResult>(`/api/comments/${id}/like`, {
      method: "POST"
    })
  }

  // 6. 多页面评论数 (GET /api/comments/count?urls=...)
  async getCommentCounts(urls: string[]): Promise<CommentCountsResult> {
    return this.request<CommentCountsResult>(
      `/api/comments/count?urls=${encodeURIComponent(urls.join(","))}`
    )
  }

  // 7. 最近评论列表 (GET /api/comments/recent?count=...)
  async getRecentComments(count = 10): Promise<RecentCommentsResult> {
    return this.request<RecentCommentsResult>(
      `/api/comments/recent?count=${count}`
    )
  }

  // 8. 浏览量上报 (POST /api/pages/view)
  async postView(input: PageViewInput): Promise<PageViewResult> {
    return this.request<PageViewResult>("/api/pages/view", {
      method: "POST",
      body: JSON.stringify(input)
    })
  }

  // 9. Reaction 上报 (POST /api/pages/reaction)
  async postReaction(input: PageReactionInput): Promise<PageReactionResult> {
    return this.request<PageReactionResult>("/api/pages/reaction", {
      method: "POST",
      body: JSON.stringify(input)
    })
  }
}
