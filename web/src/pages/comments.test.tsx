import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api"
import { commentItem, me } from "@/test/fixtures"
import { CommentsPage } from "@/pages/comments/comments-page"
import { useAuthStore } from "@/stores/auth"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    adminApi: {
      ...actual.adminApi,
      comments: vi.fn(),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
      batchComments: vi.fn()
    }
  }
})

const { adminApi } = await import("@/lib/api")

function renderComments() {
  return render(
    <MemoryRouter>
      <CommentsPage />
    </MemoryRouter>
  )
}

function menuUser() {
  return userEvent.setup({ pointerEventsCheck: 0 })
}

beforeEach(() => {
  useAuthStore.setState({ user: me(), status: "ready" })
  vi.mocked(adminApi.comments).mockReset()
  vi.mocked(adminApi.updateComment).mockReset()
  vi.mocked(adminApi.deleteComment).mockReset()
  vi.mocked(adminApi.batchComments).mockReset()
})

describe("评论管理页", () => {
  it("默认加载评论列表，展示昵称、邮箱、所属页面、IP、UA、正文和状态", async () => {
    vi.mocked(adminApi.comments).mockResolvedValue({
      items: [
        commentItem({
          id: 1,
          nick: "Bob",
          mail: "bob@example.com",
          url: "/posts/hello",
          ip: "1.2.3.4",
          ua: "Chrome/120.0",
          contentRaw: "测试正文一",
          status: "approved",
          sticky: true
        })
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1
    })

    renderComments()

    expect(await screen.findByText("Bob")).toBeInTheDocument()
    expect(screen.getByText("bob@example.com")).toBeInTheDocument()
    expect(screen.getByText("/posts/hello")).toBeInTheDocument()
    expect(screen.getByText("1.2.3.4")).toBeInTheDocument()
    expect(screen.getByText("Chrome/120.0")).toBeInTheDocument()
    expect(screen.getByText("测试正文一")).toBeInTheDocument()
    expect(screen.getByText("置顶")).toBeInTheDocument()
    expect(screen.getAllByText("已通过").length).toBeGreaterThanOrEqual(2)
  })

  it("切换状态分段触发带 status 参数的查询", async () => {
    vi.mocked(adminApi.comments).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1
    })

    const user = userEvent.setup()
    renderComments()

    await user.click(await screen.findByRole("tab", { name: "待审" }))
    expect(adminApi.comments).toHaveBeenCalledWith(
      expect.objectContaining({ status: "waiting" })
    )

    await user.click(screen.getByRole("tab", { name: "垃圾" }))
    expect(adminApi.comments).toHaveBeenCalledWith(
      expect.objectContaining({ status: "spam" })
    )
  })

  it("搜索框回车触发关键词搜索，支持清空重置", async () => {
    vi.mocked(adminApi.comments).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1
    })

    const user = userEvent.setup()
    renderComments()

    const searchInput = await screen.findByPlaceholderText(
      "搜索评论、昵称、邮箱或网址…"
    )
    await user.type(searchInput, "关键词{enter}")

    expect(adminApi.comments).toHaveBeenCalledWith(
      expect.objectContaining({ q: "关键词" })
    )

    await user.click(screen.getByRole("button", { name: "清空搜索" }))
    expect(adminApi.comments).toHaveBeenCalledWith(
      expect.objectContaining({ q: undefined })
    )
  })

  it("行内操作：通过、标为垃圾、切换置顶", async () => {
    vi.mocked(adminApi.comments).mockResolvedValue({
      items: [
        commentItem({
          id: 10,
          nick: "Charlie",
          status: "waiting",
          sticky: false
        })
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1
    })
    vi.mocked(adminApi.updateComment).mockResolvedValue(
      commentItem({ id: 10, status: "approved" })
    )

    const user = menuUser()
    renderComments()

    await user.click(await screen.findByRole("button", { name: "操作" }))
    const menu = await screen.findByRole("menu")
    await user.click(within(menu).getByRole("menuitem", { name: "通过" }))

    expect(adminApi.updateComment).toHaveBeenCalledWith(10, {
      status: "approved"
    })
  })

  it("编辑正文：弹窗修改正文后保存提交", async () => {
    vi.mocked(adminApi.comments).mockResolvedValue({
      items: [commentItem({ id: 20, contentRaw: "原有正文" })],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1
    })
    vi.mocked(adminApi.updateComment).mockResolvedValue(
      commentItem({ id: 20, contentRaw: "更新后的正文" })
    )

    const user = menuUser()
    renderComments()

    await user.click(await screen.findByRole("button", { name: "操作" }))
    const menu = await screen.findByRole("menu")
    await user.click(within(menu).getByRole("menuitem", { name: "编辑" }))

    const dialog = await screen.findByRole("dialog")
    const textarea = within(dialog).getByRole("textbox")
    expect(textarea).toHaveValue("原有正文")

    await user.clear(textarea)
    await user.type(textarea, "更新后的正文")
    await user.click(within(dialog).getByRole("button", { name: "保存" }))

    await waitFor(() =>
      expect(adminApi.updateComment).toHaveBeenCalledWith(20, {
        content: "更新后的正文"
      })
    )
  })

  it("删除评论：弹窗确认后调用 deleteComment", async () => {
    vi.mocked(adminApi.comments).mockResolvedValue({
      items: [commentItem({ id: 30, nick: "Dave" })],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1
    })
    vi.mocked(adminApi.deleteComment).mockResolvedValue({
      success: true,
      deletedId: 30,
      deletedCount: 1,
      deletedIds: [30]
    })

    const user = menuUser()
    renderComments()

    await user.click(await screen.findByRole("button", { name: "操作" }))
    const menu = await screen.findByRole("menu")
    await user.click(within(menu).getByRole("menuitem", { name: "删除" }))

    const dialog = await screen.findByRole("dialog")
    expect(
      within(dialog).getByText("确定删除该评论及其回复？此操作无法撤销。")
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole("button", { name: "删除" }))

    await waitFor(() => expect(adminApi.deleteComment).toHaveBeenCalledWith(30))
  })

  it("勾选后浮出批量操作条，支持批量审批与批量删除", async () => {
    vi.mocked(adminApi.comments).mockResolvedValue({
      items: [
        commentItem({ id: 1, nick: "Alice" }),
        commentItem({ id: 2, nick: "Bob" })
      ],
      total: 2,
      page: 1,
      pageSize: 20,
      totalPages: 1
    })
    vi.mocked(adminApi.batchComments).mockResolvedValue({
      success: true,
      affectedCount: 2
    })

    const user = userEvent.setup()
    renderComments()

    const checkboxes = await screen.findAllByRole("checkbox")
    // 全选
    await user.click(checkboxes[0])

    expect(screen.getByText("已选择 2 项")).toBeInTheDocument()

    // 批量审批
    await user.click(screen.getByRole("button", { name: "通过" }))
    await waitFor(() =>
      expect(adminApi.batchComments).toHaveBeenCalledWith({
        ids: [1, 2],
        action: "approve"
      })
    )
  })

  it("加载失败时展示错误提示", async () => {
    vi.mocked(adminApi.comments).mockRejectedValue(
      new ApiError({ status: 500, message: "Server error" })
    )

    renderComments()

    expect(await screen.findByRole("alert")).toHaveTextContent("操作失败")
  })
})
