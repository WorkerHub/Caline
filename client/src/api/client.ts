/**
 * Caline 轻量 API Client（对接 @caline/shared 契约）。
 */

import type {
  ApiResponse,
  AuthMe,
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

    const json = (await res.json().catch(() => ({}))) as
      | ApiResponse<T>
      | Record<string, unknown>
    const isError =
      res.ok === false ||
      (typeof res.status === "number" && res.status >= 400) ||
      Boolean(json && typeof json === "object" && "error" in json)

    if (isError) {
      const err = (json as { error?: { message?: string; code?: string } })
        ?.error
      throw new Error(
        err?.message ||
          (err?.code ? `Request failed with code ${err.code}` : undefined) ||
          `Request failed with status ${res.status}`
      )
    }

    if (json && typeof json === "object" && "data" in json) {
      return (json as { data: T }).data
    }

    return json as T
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

  // 10. 获取当前登录用户 (GET /api/auth/me)
  async getMe(): Promise<AuthMe | null> {
    try {
      const res = await this.request<AuthMe>("/api/auth/me")
      if (res && typeof res === "object" && "id" in res) {
        return res
      }
      return null
    } catch {
      return null
    }
  }

  // 11. 退出登录 (POST /api/auth/logout)
  async logout(): Promise<void> {
    await this.request<{ success: true }>("/api/auth/logout", {
      method: "POST"
    })
  }

  // 12. 上传图片 (POST /api/upload)
  async uploadImage(
    file: File,
    turnstileToken?: string
  ): Promise<{ url: string }> {
    const formData = new FormData()
    formData.append("file", file)
    if (turnstileToken) {
      formData.append("turnstileToken", turnstileToken)
    }
    return this.request<{ url: string }>("/api/upload", {
      method: "POST",
      body: formData
    })
  }
}
