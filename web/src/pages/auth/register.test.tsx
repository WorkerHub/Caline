import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { changeLanguage } from "@/i18n"
import { me, publicInfo } from "@/test/fixtures"
import { RegisterPage } from "@/pages/auth/register"
import { useSiteStore } from "@/stores/site"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      login: vi.fn(),
      register: vi.fn(),
      verifyEmail: vi.fn(),
      resendEmail: vi.fn()
    },
    meApi: { ...actual.meApi, get: vi.fn(), update: vi.fn() }
  }
})

const { authApi } = await import("@/lib/api")

const AUTH_SUCCESS_TYPE = `${"cal"}${"ine"}:auth-success`

function renderRegister(initialEntries = ["/register"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
      </Routes>
    </MemoryRouter>
  )
}

async function enterCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("邮箱"), "new@example.com")
  await user.type(screen.getByLabelText("密码"), "long-enough-password")
  if (screen.queryByRole("button", { name: "注册" })) {
    await user.click(screen.getByRole("button", { name: "注册" }))
  }
}

beforeEach(() => {
  useSiteStore.setState({ info: publicInfo(), loaded: true })
})

describe("注册", () => {
  it("请求体带注册页当前语言", async () => {
    await changeLanguage("en")
    vi.mocked(authApi.register).mockResolvedValue({
      requiresApproval: false,
      requiresEmailVerification: false
    })

    const user = userEvent.setup()
    renderRegister()
    await user.type(screen.getByLabelText("Email"), "new@example.com")
    await user.type(screen.getByLabelText("Password"), "long-enough-password")
    await user.click(screen.getByRole("button", { name: "Create account" }))

    expect(authApi.register).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "long-enough-password",
      language: "en"
    })
  })

  it("需要邮箱验证时换成验证码步，验证后进入待批准态", async () => {
    vi.mocked(authApi.register).mockResolvedValue({
      requiresApproval: true,
      requiresEmailVerification: true
    })
    vi.mocked(authApi.verifyEmail).mockResolvedValue({ success: true })

    const user = userEvent.setup()
    renderRegister()
    await enterCredentials(user)

    const code = await screen.findByLabelText("验证码")
    await user.type(code, "123456")
    await user.click(screen.getByRole("button", { name: "验证" }))

    expect(await screen.findByText("已提交注册")).toBeInTheDocument()
    expect(screen.getByText("账号需管理员批准后才能登录。")).toBeInTheDocument()
    expect(authApi.verifyEmail).toHaveBeenCalledWith({
      email: "new@example.com",
      code: "123456"
    })
  })

  it("只需要审核时直接显示待批准态", async () => {
    vi.mocked(authApi.register).mockResolvedValue({
      requiresApproval: true,
      requiresEmailVerification: false
    })

    const user = userEvent.setup()
    renderRegister()
    await enterCredentials(user)

    expect(await screen.findByText("已提交注册")).toBeInTheDocument()
    expect(screen.queryByLabelText("验证码")).not.toBeInTheDocument()
  })

  it("单人档不渲染注册表单", () => {
    useSiteStore.setState({
      info: publicInfo({ appMode: "single" }),
      loaded: true
    })
    renderRegister()
    expect(screen.queryByLabelText("邮箱")).not.toBeInTheDocument()
  })

  it("注册关闭时不渲染表单", () => {
    useSiteStore.setState({
      info: publicInfo({ registrationEnabled: false }),
      loaded: true
    })
    renderRegister()
    expect(screen.queryByLabelText("邮箱")).not.toBeInTheDocument()
    expect(screen.getByText("本站未开放注册")).toBeInTheDocument()
  })
})

describe("注册页弹窗模式（?popup=1）", () => {
  const originalOpener = window.opener

  afterEach(() => {
    Object.defineProperty(window, "opener", {
      value: originalOpener,
      writable: true,
      configurable: true
    })
    vi.restoreAllMocks()
  })

  it("注册成功若自动登录，同口径向 opener 发送 postMessage 并关窗", async () => {
    const postMessage = vi.fn()
    Object.defineProperty(window, "opener", {
      value: { postMessage },
      writable: true,
      configurable: true
    })
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {})

    vi.mocked(authApi.register).mockResolvedValue({
      requiresApproval: false,
      requiresEmailVerification: false
    })
    vi.mocked(authApi.login).mockResolvedValue({
      success: true,
      user: me()
    })

    const user = userEvent.setup()
    renderRegister(["/register?popup=1"])
    await enterCredentials(user)

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        { type: AUTH_SUCCESS_TYPE },
        window.location.origin
      )
    })
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it("注册成功自动登录但无 opener 时回现行行为（展示已完成提示）", async () => {
    Object.defineProperty(window, "opener", {
      value: null,
      writable: true,
      configurable: true
    })
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {})

    vi.mocked(authApi.register).mockResolvedValue({
      requiresApproval: false,
      requiresEmailVerification: false
    })
    vi.mocked(authApi.login).mockResolvedValue({
      success: true,
      user: me()
    })

    const user = userEvent.setup()
    renderRegister(["/register?popup=1"])
    await enterCredentials(user)

    expect(await screen.findByText("注册成功")).toBeInTheDocument()
    expect(closeSpy).not.toHaveBeenCalled()
    // 完成界面的去登录按钮携带 ?popup=1
    const goLoginLink = screen.getByRole("link", { name: "去登录" })
    expect(goLoginLink).toHaveAttribute("href", "/login?popup=1")
  })

  it("弹窗模式内已有账号登录链接携带 ?popup=1", () => {
    renderRegister(["/register?popup=1"])
    const signinLink = screen.getByRole("link", { name: "登录" })
    expect(signinLink).toHaveAttribute("href", "/login?popup=1")
  })

  it("非弹窗模式内已有账号登录链接不携带 ?popup=1", () => {
    renderRegister(["/register"])
    const signinLink = screen.getByRole("link", { name: "登录" })
    expect(signinLink).toHaveAttribute("href", "/login")
  })

  it("注册关闭时登录链接在弹窗模式下携带 ?popup=1", () => {
    useSiteStore.setState({
      info: publicInfo({ registrationEnabled: false }),
      loaded: true
    })
    renderRegister(["/register?popup=1"])
    const loginLink = screen.getByRole("link", { name: "登录" })
    expect(loginLink).toHaveAttribute("href", "/login?popup=1")
  })
})
