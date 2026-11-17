import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api"
import { calineDataDump, me } from "@/test/fixtures"
import { DataPage } from "@/pages/data/data-page"
import { useAuthStore } from "@/stores/auth"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    adminApi: {
      ...actual.adminApi,
      exportData: vi.fn(),
      importData: vi.fn()
    }
  }
})

const { adminApi } = await import("@/lib/api")

function renderData() {
  return render(
    <MemoryRouter>
      <DataPage />
    </MemoryRouter>
  )
}

beforeEach(() => {
  useAuthStore.setState({ user: me(), status: "ready" })
  vi.mocked(adminApi.exportData).mockReset()
  vi.mocked(adminApi.importData).mockReset()
})

describe("数据管理页", () => {
  it("导出数据：点击触发 exportData 契约并生成下载", async () => {
    const dump = calineDataDump()
    vi.mocked(adminApi.exportData).mockResolvedValue(dump)

    // Mock createObjectURL & revokeObjectURL
    const createObjectURL = vi.fn().mockReturnValue("blob:mock-url")
    const revokeObjectURL = vi.fn()
    window.URL.createObjectURL = createObjectURL
    window.URL.revokeObjectURL = revokeObjectURL

    const user = userEvent.setup()
    renderData()

    const exportBtn = await screen.findByRole("button", { name: "导出备份" })
    await user.click(exportBtn)

    await waitFor(() => expect(adminApi.exportData).toHaveBeenCalledTimes(1))
    expect(createObjectURL).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalled()
  })

  it("导出失败时展示错误提示", async () => {
    vi.mocked(adminApi.exportData).mockRejectedValue(
      new ApiError({ status: 500, message: "Export failed" })
    )

    const user = userEvent.setup()
    renderData()

    await user.click(await screen.findByRole("button", { name: "导出备份" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("操作失败")
  })

  it("选择合法备份文件，展示概览，二次确认后触发覆盖导入", async () => {
    const dump = calineDataDump()
    vi.mocked(adminApi.importData).mockResolvedValue({
      success: true,
      importedComments: 1,
      importedCounters: 1,
      importedUsers: 1
    })

    const user = userEvent.setup()
    renderData()

    const fileInput = screen.getByLabelText("选择备份文件")
    const file = new File([JSON.stringify(dump)], "backup.json", {
      type: "application/json"
    })

    fireEvent.change(fileInput, { target: { files: [file] } })

    expect(
      await screen.findByText("含 1 条评论、1 个页面计数、1 个用户")
    ).toBeInTheDocument()
    expect(screen.getByText("版本: 1.0.0")).toBeInTheDocument()

    // 点击导入数据按钮，打开二次确认对话框
    const importBtn = screen.getByRole("button", { name: "导入数据" })
    await user.click(importBtn)

    const dialog = await screen.findByRole("dialog")
    expect(
      within(dialog).getByText(
        "导入将覆盖数据库中的现有数据，此操作不可逆。是否继续？"
      )
    ).toBeInTheDocument()

    // 确认导入
    const confirmBtn = within(dialog).getByRole("button", { name: "确认导入" })
    await user.click(confirmBtn)

    await waitFor(() =>
      expect(adminApi.importData).toHaveBeenCalledWith({
        data: dump,
        overwrite: true
      })
    )
  })

  it("选择非法 JSON 文件时报错且不展示概览", async () => {
    renderData()

    const fileInput = screen.getByLabelText("选择备份文件")
    const file = new File(["not json content"], "broken.json", {
      type: "application/json"
    })

    fireEvent.change(fileInput, { target: { files: [file] } })

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "备份文件格式无效"
    )
    expect(screen.queryByText(/条评论/)).not.toBeInTheDocument()
  })
})
