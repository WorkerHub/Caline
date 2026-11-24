import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api"
import { adminSettings, calineSiteSettings, me } from "@/test/fixtures"
import { SiteSettingsPage } from "@/pages/site-settings/site-settings-page"
import { useAuthStore } from "@/stores/auth"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    adminApi: {
      ...actual.adminApi,
      settings: vi.fn(),
      updateSettings: vi.fn()
    }
  }
})

const { adminApi } = await import("@/lib/api")

function renderSiteSettings() {
  return render(
    <MemoryRouter>
      <SiteSettingsPage />
    </MemoryRouter>
  )
}

beforeEach(() => {
  useAuthStore.setState({ user: me(), status: "ready" })
  vi.mocked(adminApi.settings).mockReset()
  vi.mocked(adminApi.updateSettings).mockReset()
})

describe("站点系统设置页", () => {
  it("回显已保存的配置项，脱敏密钥显示已配置占位符", async () => {
    vi.mocked(adminApi.settings).mockResolvedValue(
      adminSettings({
        site: calineSiteSettings({
          auditSwitch: true,
          reservedNicks: ["root", "admin"],
          disallowedWords: ["badword"],
          ipBlacklist: ["1.2.3.4"],
          maxContentLength: 500,
          ipRateLimitSeconds: 30,
          levelThresholds: [0, 5, 20],
          gravatarMirror: "https://cravatar.cn/avatar/",
          safeDomains: ["mysite.com"],
          turnstileEnabled: true,
          turnstileSiteKey: "my-site-key",
          turnstileSecretKeySet: true,
          enotifyEnabled: false,
          enotifyKeySet: false,
          orphanCleanupEnabled: true
        })
      })
    )

    renderSiteSettings()

    expect(await screen.findByLabelText("全站评论审核")).toBeChecked()
    expect(screen.getByLabelText("保留昵称")).toHaveValue("root\nadmin")
    expect(screen.getByLabelText("违禁词")).toHaveValue("badword")
    expect(screen.getByLabelText("IP 黑名单")).toHaveValue("1.2.3.4")
    expect(screen.getByLabelText("评论最大字数")).toHaveValue(500)
    expect(screen.getByLabelText("IP 限频间隔（秒）")).toHaveValue(30)
    expect(screen.getByLabelText("等级阈值")).toHaveValue("0, 5, 20")
    expect(screen.getByLabelText("Gravatar 镜像地址")).toHaveValue(
      "https://cravatar.cn/avatar/"
    )
    expect(screen.getByLabelText("安全域名")).toHaveValue("mysite.com")
    expect(screen.getByLabelText("Turnstile 验证码")).toBeChecked()
    expect(screen.getByLabelText("Turnstile Site Key")).toHaveValue(
      "my-site-key"
    )

    const turnstileSecret = screen.getByLabelText("Turnstile Secret Key")
    expect(turnstileSecret).toHaveValue("")
    expect(turnstileSecret).toHaveAttribute(
      "placeholder",
      "已配置，留空保持不变"
    )

    const enotifyKey = screen.getByLabelText("eNotify Key")
    expect(enotifyKey).toHaveValue("")
    expect(enotifyKey).toHaveAttribute("placeholder", "未配置")

    expect(screen.queryByLabelText("孤儿图片定期清理")).not.toBeInTheDocument()
    expect(screen.queryByText("系统维护")).not.toBeInTheDocument()
  })

  it("保存设置：提交更新的字段，留空的密钥不提交", async () => {
    const initialSite = calineSiteSettings({
      auditSwitch: false,
      turnstileSecretKeySet: true
    })
    vi.mocked(adminApi.settings).mockResolvedValue(
      adminSettings({ site: initialSite })
    )
    vi.mocked(adminApi.updateSettings).mockResolvedValue(
      adminSettings({
        site: { ...initialSite, auditSwitch: true }
      })
    )

    const user = userEvent.setup()
    renderSiteSettings()

    const auditSwitch = await screen.findByLabelText("全站评论审核")
    await user.click(auditSwitch)

    await user.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() =>
      expect(adminApi.updateSettings).toHaveBeenCalledWith({
        site: expect.objectContaining({
          auditSwitch: true
        })
      })
    )

    // turnstileSecretKey 留空时不在 payload 中，表单提交也不再携带 orphanCleanupEnabled
    const callArgs = vi.mocked(adminApi.updateSettings).mock.calls[0][0]
    expect(callArgs.site?.turnstileSecretKey).toBeUndefined()
    expect(callArgs.site?.orphanCleanupEnabled).toBeUndefined()
  })

  it("填入新密钥时，保存请求携带新密钥", async () => {
    const initialSite = calineSiteSettings({ turnstileSecretKeySet: true })
    vi.mocked(adminApi.settings).mockResolvedValue(
      adminSettings({ site: initialSite })
    )
    vi.mocked(adminApi.updateSettings).mockResolvedValue(
      adminSettings({ site: initialSite })
    )

    const user = userEvent.setup()
    renderSiteSettings()

    const secretInput = await screen.findByLabelText("Turnstile Secret Key")
    await user.type(secretInput, "new-turnstile-secret")

    await user.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() =>
      expect(adminApi.updateSettings).toHaveBeenCalledWith({
        site: expect.objectContaining({
          turnstileSecretKey: "new-turnstile-secret"
        })
      })
    )
  })

  it("清空等级阈值时提交空数组 []，不产生 [0]", async () => {
    const initialSite = calineSiteSettings({ levelThresholds: [0, 10, 50] })
    vi.mocked(adminApi.settings).mockResolvedValue(
      adminSettings({ site: initialSite })
    )
    vi.mocked(adminApi.updateSettings).mockResolvedValue(
      adminSettings({ site: { ...initialSite, levelThresholds: [] } })
    )

    const user = userEvent.setup()
    renderSiteSettings()

    const thresholdsInput = await screen.findByLabelText("等级阈值")
    await user.clear(thresholdsInput)

    await user.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() =>
      expect(adminApi.updateSettings).toHaveBeenCalledWith({
        site: expect.objectContaining({
          levelThresholds: []
        })
      })
    )
  })

  it("加载失败或保存失败时展示错误提示", async () => {
    vi.mocked(adminApi.settings).mockRejectedValue(
      new ApiError({ status: 500, message: "Load failed" })
    )

    renderSiteSettings()

    expect(await screen.findByRole("alert")).toHaveTextContent("操作失败")
  })
})
