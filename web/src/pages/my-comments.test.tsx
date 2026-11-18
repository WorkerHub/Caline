import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MyCommentsPage } from "@/pages/my-comments/my-comments-page"
import { useAuthStore } from "@/stores/auth"
import { me } from "@/test/fixtures"
import type { CommentMeItem } from "@/lib/api-types"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    meApi: {
      ...actual.meApi,
      comments: vi.fn()
    },
    commentsApi: {
      update: vi.fn(),
      delete: vi.fn()
    }
  }
})

const { meApi, commentsApi } = await import("@/lib/api")

function renderMyComments() {
  return render(
    <MemoryRouter>
      <MyCommentsPage />
    </MemoryRouter>
  )
}

function sampleComment(overrides: Partial<CommentMeItem> = {}): CommentMeItem {
  return {
    id: 1,
    url: "/posts/first-post",
    contentRaw: "第一条个人评论内容",
    contentHtml: "<p>第一条个人评论内容</p>",
    status: "approved",
    likeCount: 5,
    pid: null,
    rid: null,
    createdAt: "2026-11-18T08:00:00.000Z",
    updatedAt: "2026-11-18T08:00:00.000Z",
    ...overrides
  }
}

beforeEach(() => {
  useAuthStore.setState({ user: me({ role: "user" }), status: "ready" })
  vi.mocked(meApi.comments).mockReset()
  vi.mocked(commentsApi.update).mockReset()
  vi.mocked(commentsApi.delete).mockReset()
})

describe("我的评论页", () => {
  it("默认渲染本人评论列表，展示状态徽标、正文、URL、时间，严格脱敏不含 IP/UA", async () => {
    vi.mocked(meApi.comments).mockResolvedValue({
      items: [
        sampleComment({
          id: 1,
          status: "approved",
          contentRaw: "审核通过的评论"
        }),
        sampleComment({ id: 2, status: "waiting", contentRaw: "待审核的评论" }),
        sampleComment({ id: 3, status: "spam", contentRaw: "标记垃圾的评论" })
      ],
      total: 3,
      page: 1,
      pageSize: 20,
      totalPages: 1
    })

    renderMyComments()

    expect(await screen.findByText("审核通过的评论")).toBeInTheDocument()
    expect(screen.getByText("待审核的评论")).toBeInTheDocument()
    expect(screen.getByText("标记垃圾的评论")).toBeInTheDocument()

    // 状态徽标
    expect(screen.getByText("已通过")).toBeInTheDocument()
    expect(screen.getByText("待审核")).toBeInTheDocument()
    expect(screen.getByText("垃圾")).toBeInTheDocument()

    // 页面 URL
    expect(screen.getAllByText("/posts/first-post").length).toBeGreaterThan(0)

    // 严格脱敏：绝不渲染 IP 与 UA
    expect(
      screen.queryByText(/127\.0\.0\.1|192\.168\.|Mozilla|Chrome|Safari/i)
    ).not.toBeInTheDocument()
  })

  it("无评论时渲染正常空状态", async () => {
    vi.mocked(meApi.comments).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1
    })

    renderMyComments()

    expect(await screen.findByText("暂无评论")).toBeInTheDocument()
  })

  it("支持倒序分页导航", async () => {
    vi.mocked(meApi.comments).mockResolvedValue({
      items: [sampleComment({ id: 10 })],
      total: 25,
      page: 1,
      pageSize: 20,
      totalPages: 2
    })

    const user = userEvent.setup()
    renderMyComments()

    expect(await screen.findByText("第 1 / 2 页")).toBeInTheDocument()
    const nextBtn = screen.getByRole("button", { name: "下一页" })
    expect(nextBtn).toBeEnabled()

    vi.mocked(meApi.comments).mockResolvedValue({
      items: [sampleComment({ id: 9 })],
      total: 25,
      page: 2,
      pageSize: 20,
      totalPages: 2
    })

    await user.click(nextBtn)
    await waitFor(() =>
      expect(meApi.comments).toHaveBeenCalledWith({ page: 2, pageSize: 20 })
    )
  })

  it("支持编辑评论：弹窗修改并通过 PATCH /api/comments/:id 保存", async () => {
    vi.mocked(meApi.comments).mockResolvedValue({
      items: [sampleComment({ id: 101, contentRaw: "原有内容" })],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1
    })
    vi.mocked(commentsApi.update).mockResolvedValue({
      id: 101,
      contentHtml: "<p>更新后的内容</p>",
      updatedAt: "2026-11-18T09:00:00.000Z",
      status: "approved"
    })

    const user = userEvent.setup()
    renderMyComments()

    expect(await screen.findByText("原有内容")).toBeInTheDocument()

    const editBtn = screen.getByRole("button", { name: "编辑" })
    await user.click(editBtn)

    expect(
      await screen.findByRole("heading", { name: "编辑评论" })
    ).toBeInTheDocument()
    const textarea = screen.getByLabelText("评论内容")
    expect(textarea).toHaveValue("原有内容")

    await user.clear(textarea)
    await user.type(textarea, "更新后的内容")

    const saveBtn = screen.getByRole("button", { name: "保存" })
    await user.click(saveBtn)

    await waitFor(() =>
      expect(commentsApi.update).toHaveBeenCalledWith(101, {
        content: "更新后的内容"
      })
    )
    expect(await screen.findByText("更新后的内容")).toBeInTheDocument()
  })

  it("支持删除评论：提供二次确认弹窗，确认后调用 DELETE /api/comments/:id", async () => {
    vi.mocked(meApi.comments).mockResolvedValue({
      items: [sampleComment({ id: 202, contentRaw: "即将被删除的评论" })],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1
    })
    vi.mocked(commentsApi.delete).mockResolvedValue({
      success: true,
      deletedId: 202
    })

    const user = userEvent.setup()
    renderMyComments()

    expect(await screen.findByText("即将被删除的评论")).toBeInTheDocument()

    const deleteBtn = screen.getByRole("button", { name: "删除" })
    await user.click(deleteBtn)

    expect(
      await screen.findByRole("heading", { name: "删除评论" })
    ).toBeInTheDocument()
    expect(
      screen.getByText("确定要删除这条评论吗？此操作无法撤销。")
    ).toBeInTheDocument()

    const confirmBtn = screen.getByRole("button", { name: "确认删除" })
    await user.click(confirmBtn)

    await waitFor(() => expect(commentsApi.delete).toHaveBeenCalledWith(202))
  })
})
