import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { me } from "@/test/fixtures"
import { ProfilePage } from "@/pages/profile"
import { useAuthStore } from "@/stores/auth"
import type { Me } from "@/lib/api-types"
import { ApiError, meApi } from "@/lib/api"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    meApi: {
      ...actual.meApi,
      update: vi.fn(),
      uploadAvatar: vi.fn()
    }
  }
})

beforeEach(() => {
  useAuthStore.setState({ user: me(), status: "ready" })
  vi.mocked(meApi.update).mockResolvedValue(me())
  vi.mocked(meApi.uploadAvatar).mockResolvedValue({
    avatar: "https://example.com/new-avatar.png"
  })
})

describe("个人资料页", () => {
  it("默认只读展示昵称，编辑按钮可用", () => {
    useAuthStore.setState({
      user: me({ displayName: "船长" }),
      status: "ready"
    })
    render(<ProfilePage />)

    expect(screen.getByText("船长")).toBeInTheDocument()
    expect(screen.queryByText("用户名")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("昵称")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "编辑" })).toBeEnabled()
  })

  it("点「编辑」后只出现昵称输入框并回填当前值", async () => {
    useAuthStore.setState({
      user: me({ displayName: "Owner" }),
      status: "ready"
    })
    const user = userEvent.setup()
    render(<ProfilePage />)

    await user.click(screen.getByRole("button", { name: "编辑" }))

    expect(screen.getByLabelText("昵称")).toHaveValue("Owner")
    expect(screen.queryByLabelText("用户名")).not.toBeInTheDocument()
  })

  it("改昵称后提交 displayName 并回到只读展示", async () => {
    vi.mocked(meApi.update).mockResolvedValue(me({ displayName: "船长" }))
    const user = userEvent.setup()
    render(<ProfilePage />)

    await user.click(screen.getByRole("button", { name: "编辑" }))
    const input = screen.getByLabelText("昵称")
    await user.clear(input)
    await user.type(input, "船长")
    await user.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() =>
      expect(meApi.update).toHaveBeenCalledWith({ displayName: "船长" })
    )
    expect(await screen.findByText("船长")).toBeInTheDocument()
    expect(screen.queryByLabelText("昵称")).not.toBeInTheDocument()
  })

  it("保存失败时就地显示稳定错误文案并保留输入", async () => {
    vi.mocked(meApi.update).mockRejectedValue(
      new ApiError({
        status: 403,
        code: "DISPLAY_NAME_LOCKED",
        message: "Display name is locked"
      })
    )
    const user = userEvent.setup()
    render(<ProfilePage />)

    await user.click(screen.getByRole("button", { name: "编辑" }))
    await user.type(screen.getByLabelText("昵称"), "船长")
    await user.click(screen.getByRole("button", { name: "保存" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "昵称已被禁止修改"
    )
    expect(screen.getByLabelText("昵称")).toHaveValue("Owner船长")
  })

  it("锁定昵称时编辑按钮置灰", () => {
    useAuthStore.setState({
      user: me({ profileLocks: { displayNameLocked: true } }),
      status: "ready"
    })
    render(<ProfilePage />)

    expect(screen.getByRole("button", { name: "编辑" })).toBeDisabled()
  })

  it("点「取消」回到只读且不调更新接口", async () => {
    const user = userEvent.setup()
    render(<ProfilePage />)

    await user.click(screen.getByRole("button", { name: "编辑" }))
    await user.type(screen.getByLabelText("昵称"), "船长")
    await user.click(screen.getByRole("button", { name: "取消" }))

    expect(meApi.update).not.toHaveBeenCalled()
    expect(screen.queryByLabelText("昵称")).not.toBeInTheDocument()
  })

  it("保存期间取消按钮不可点", async () => {
    let resolveUpdate: (value: Me) => void = () => {}
    const pending = new Promise<Me>((resolve) => {
      resolveUpdate = resolve
    })
    vi.mocked(meApi.update).mockReturnValue(pending)
    const user = userEvent.setup()
    render(<ProfilePage />)

    await user.click(screen.getByRole("button", { name: "编辑" }))
    await user.click(screen.getByRole("button", { name: "保存" }))

    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled()

    await act(async () => {
      resolveUpdate(me())
    })
    await waitFor(() =>
      expect(screen.queryByLabelText("昵称")).not.toBeInTheDocument()
    )
  })
})

describe("个人设置页头像 UI", () => {
  it("展示选择图片按钮，未选择图片时不展示保存/取消按钮", () => {
    render(<ProfilePage />)
    expect(screen.getByRole("button", { name: "选择图片" })).toBeInTheDocument()
    expect(screen.queryByTestId("avatar-preview-img")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "保存" })
    ).not.toBeInTheDocument()
  })

  it("选择图片后即时展示预览图与保存、取消按钮", async () => {
    const user = userEvent.setup()
    render(<ProfilePage />)

    const file = new File(["dummy content"], "avatar.png", {
      type: "image/png"
    })
    const input = screen.getByLabelText("选择图片")
    await user.upload(input, file)

    expect(await screen.findByTestId("avatar-preview-img")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument()
  })

  it("点击保存调用 POST /api/me/avatar 接口并更新头像", async () => {
    const user = userEvent.setup()
    render(<ProfilePage />)

    const file = new File(["dummy content"], "avatar.png", {
      type: "image/png"
    })
    const input = screen.getByLabelText("选择图片")
    await user.upload(input, file)

    const saveBtn = screen.getByRole("button", { name: "保存" })
    await user.click(saveBtn)

    await waitFor(() => expect(meApi.uploadAvatar).toHaveBeenCalledWith(file))
    await waitFor(() =>
      expect(screen.queryByTestId("avatar-preview-img")).not.toBeInTheDocument()
    )
  })

  it("上传失败时就地显示错误提示（role=alert）", async () => {
    vi.mocked(meApi.uploadAvatar).mockRejectedValueOnce(
      new ApiError({
        status: 400,
        message: "Invalid image format"
      })
    )
    const user = userEvent.setup()
    render(<ProfilePage />)

    const file = new File(["bad content"], "avatar.bad", { type: "image/png" })
    const input = screen.getByLabelText("选择图片")
    await user.upload(input, file)

    const saveBtn = screen.getByRole("button", { name: "保存" })
    await user.click(saveBtn)

    expect(await screen.findByRole("alert")).toBeInTheDocument()
  })

  it("点击取消放弃预览并清空选择", async () => {
    const user = userEvent.setup()
    render(<ProfilePage />)

    const file = new File(["dummy content"], "avatar.png", {
      type: "image/png"
    })
    const input = screen.getByLabelText("选择图片")
    await user.upload(input, file)

    expect(await screen.findByTestId("avatar-preview-img")).toBeInTheDocument()
    const cancelBtn = screen.getByRole("button", { name: "取消" })
    await user.click(cancelBtn)

    expect(screen.queryByTestId("avatar-preview-img")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "保存" })
    ).not.toBeInTheDocument()
    expect(meApi.uploadAvatar).not.toHaveBeenCalled()
  })

  it("再次选图或卸载时及时释放先前的对象 URL（防内存泄漏）", async () => {
    const revokeSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {})
    const user = userEvent.setup()
    const { unmount } = render(<ProfilePage />)

    const file1 = new File(["dummy 1"], "avatar1.png", { type: "image/png" })
    const file2 = new File(["dummy 2"], "avatar2.png", { type: "image/png" })
    const input = screen.getByLabelText("选择图片")
    await user.upload(input, file1)
    await user.upload(input, file2)

    expect(revokeSpy).toHaveBeenCalled()

    unmount()
    expect(revokeSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
    revokeSpy.mockRestore()
  })
})
