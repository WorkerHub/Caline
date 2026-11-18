import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  createMemoryRouter,
  type RouteObject,
  RouterProvider
} from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { routes } from "@/App"
import { ThemeProvider } from "@/components/theme-provider"
import { ApiError } from "@/lib/api"
import {
  SIDEBAR_OPEN_STORAGE_KEY,
  SIDEBAR_WIDTH_STORAGE_KEY
} from "@/lib/sidebar"
import {
  adminSettings,
  calineSiteSettings,
  me,
  PROJECT_NAME,
  publicInfo,
  setupState
} from "@/test/fixtures"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    publicApi: { get: vi.fn() },
    setupApi: { ...actual.setupApi, state: vi.fn() },
    meApi: {
      ...actual.meApi,
      get: vi.fn(),
      update: vi.fn(),
      comments: vi.fn()
    },
    authApi: { ...actual.authApi, logout: vi.fn() },
    adminApi: {
      ...actual.adminApi,
      settings: vi.fn(),
      users: vi.fn(),
      comments: vi.fn()
    }
  }
})

const { publicApi, setupApi, meApi, adminApi } = await import("@/lib/api")

function renderAt(entries: RouteObject[] = routes, path = "/ui") {
  const initialEntry = path.startsWith("/ui")
    ? path
    : `/ui${path === "/" ? "" : path}`
  const router = createMemoryRouter(entries, {
    basename: "/ui",
    initialEntries: [initialEntry]
  })
  return render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  )
}

function accountUser() {
  // Radix 打开菜单时给 body 加 pointer-events: none，默认检查会拒绝点击。
  return userEvent.setup({ pointerEventsCheck: 0 })
}

async function openAccountMenu() {
  const account = accountUser()
  await account.click(await screen.findByRole("button", { name: "账号" }))
  return account
}

beforeEach(() => {
  vi.mocked(publicApi.get).mockResolvedValue(publicInfo())
  vi.mocked(meApi.get).mockRejectedValue(
    new ApiError({ status: 401, message: "Unauthorized" })
  )
  vi.mocked(meApi.comments).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    totalPages: 1
  })
  vi.mocked(adminApi.comments).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    totalPages: 1
  })
  vi.mocked(adminApi.settings).mockReset()
  vi.mocked(adminApi.users).mockReset()
})

describe("路由与根门", () => {
  it("未初始化时打开任意页面都被引导到 setup", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(setupState())
    renderAt(routes, "/ui")

    expect(await screen.findByLabelText("部署密钥")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "初始化" })).toBeInTheDocument()
  })

  it("已初始化时访客进入 /ui 基座自动引导到登录页", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    renderAt(routes, "/ui")

    expect(
      await screen.findByRole("button", { name: "登录" })
    ).toBeInTheDocument()
  })

  it("后台各子路由在 /ui 下正常可达", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    renderAt(routes, "/ui/login")

    expect(
      await screen.findByRole("button", { name: "登录" })
    ).toBeInTheDocument()
  })

  it("迁移完成但尚无所有者时不再弹回 setup，注册页可达", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: false, enabled: false })
    )
    renderAt(routes, "/register")

    expect(await screen.findByLabelText("邮箱")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "注册" })).toBeInTheDocument()
  })

  it("会话失效时不留在空白工作台，回到登录页", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    renderAt(routes, "/workbench")

    expect(
      await screen.findByRole("heading", { name: "登录" })
    ).toBeInTheDocument()
  })

  it("首登改密标记会拦住工作台，先进改密页", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me({ mustChangePassword: true }))

    renderAt(routes, "/workbench")

    expect(
      await screen.findByRole("heading", { name: "修改密码" })
    ).toBeInTheDocument()
    expect(screen.getByLabelText("当前密码")).toBeInTheDocument()
    expect(screen.queryByTestId("workbench-page")).not.toBeInTheDocument()
  })

  it("管理员能在账号菜单里看到「系统管理」，普通成员看不到", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me())

    const view = renderAt(routes, "/workbench")
    await openAccountMenu()
    expect(
      screen.getByRole("menuitem", { name: "系统管理" })
    ).toBeInTheDocument()
    view.unmount()

    vi.mocked(meApi.get).mockResolvedValue(me({ role: "user" }))
    renderAt(routes, "/workbench")
    await openAccountMenu()
    expect(
      screen.getByRole("menuitem", { name: "个人资料" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("menuitem", { name: "系统管理" })
    ).not.toBeInTheDocument()
  })

  it("侧栏终局仅两项：管理员看到「评论」与「我的评论」，普通成员仅看到「我的评论」", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me({ role: "admin" }))

    const adminView = renderAt(routes, "/comments")
    const adminNav = await screen.findByRole("navigation")
    expect(
      within(adminNav)
        .getAllByRole("link")
        .map((link) => link.textContent)
    ).toEqual(["评论", "我的评论"])
    expect(within(adminNav).getByRole("link", { name: "评论" })).toHaveAttribute(
      "data-active",
      "true"
    )
    adminView.unmount()

    vi.mocked(meApi.get).mockResolvedValue(me({ role: "user" }))
    renderAt(routes, "/my-comments")
    const memberNav = await screen.findByRole("navigation")
    expect(
      within(memberNav)
        .getAllByRole("link")
        .map((link) => link.textContent)
    ).toEqual(["我的评论"])
    expect(within(memberNav).queryByRole("link", { name: "评论" })).not.toBeInTheDocument()
    expect(within(memberNav).queryByRole("link", { name: "系统设置" })).not.toBeInTheDocument()
    expect(within(memberNav).queryByRole("link", { name: "数据" })).not.toBeInTheDocument()
  })

  it("登录落点分流：管理员定向至 /comments，普通成员定向至 /my-comments", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )

    // 管理员进入 /workbench 分流至 /comments
    vi.mocked(meApi.get).mockResolvedValue(me({ role: "admin" }))
    const adminView = renderAt(routes, "/workbench")
    expect(await screen.findByRole("heading", { name: "评论" })).toBeInTheDocument()
    adminView.unmount()

    // 普通成员进入 /workbench 分流至 /my-comments
    vi.mocked(meApi.get).mockResolvedValue(me({ role: "user" }))
    const memberView = renderAt(routes, "/workbench")
    expect(await screen.findByRole("heading", { name: "我的评论" })).toBeInTheDocument()
    memberView.unmount()

    // 未登录页进入根路径 / 登录后分流
    vi.mocked(meApi.get).mockResolvedValue(me({ role: "user" }))
    renderAt(routes, "/")
    expect(await screen.findByRole("heading", { name: "我的评论" })).toBeInTheDocument()
  })

  it("管理员专属路由守卫：普通成员直达 /comments 或系统管理任一 tab 直接被重定向至 /my-comments，不挂载且不发 admin 请求", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me({ role: "user" }))

    // 试图直达管理员评论页
    const view1 = renderAt(routes, "/comments")
    expect(await screen.findByRole("heading", { name: "我的评论" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "评论" })).not.toBeInTheDocument()
    expect(adminApi.comments).not.toHaveBeenCalled()
    view1.unmount()

    // 试图直达系统管理各 tab
    const view2 = renderAt(routes, "/admin/email")
    expect(await screen.findByRole("heading", { name: "我的评论" })).toBeInTheDocument()
    expect(adminApi.settings).not.toHaveBeenCalled()
    view2.unmount()

    const view3 = renderAt(routes, "/admin/users")
    expect(await screen.findByRole("heading", { name: "我的评论" })).toBeInTheDocument()
    expect(adminApi.users).not.toHaveBeenCalled()
    view3.unmount()

    const view4 = renderAt(routes, "/admin")
    expect(await screen.findByRole("heading", { name: "我的评论" })).toBeInTheDocument()
    expect(adminApi.settings).not.toHaveBeenCalled()
    view4.unmount()
  })

  it("旧地址兼容重定向：/site-settings 与 /data 分别重定向至评论设置与导入导出 tab", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me({ role: "admin" }))
    vi.mocked(adminApi.settings).mockResolvedValue(
      adminSettings({
        site: calineSiteSettings({
          auditSwitch: false,
          guestMode: "open"
        })
      })
    )

    const view1 = renderAt(routes, "/site-settings")
    expect(await screen.findByText("全站评论审核")).toBeInTheDocument()
    view1.unmount()

    const view2 = renderAt(routes, "/data")
    expect(await screen.findByRole("button", { name: "导出备份" })).toBeInTheDocument()
    view2.unmount()
  })

  it("系统管理六 tab 路径化：裸路径重定向首 tab，各 tab 直达与刷新保持", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me({ role: "admin" }))
    vi.mocked(adminApi.settings).mockResolvedValue(
      adminSettings({
        site: calineSiteSettings({
          auditSwitch: false,
          guestMode: "open"
        })
      })
    )

    // 裸 /admin 重定向到首 tab /admin/email
    const view1 = renderAt(routes, "/admin")
    expect(await screen.findByRole("tab", { name: "邮件配置" })).toHaveAttribute(
      "data-state",
      "active"
    )
    view1.unmount()

    // 直达 registration tab
    const view2 = renderAt(routes, "/admin/registration")
    expect(await screen.findByRole("tab", { name: "注册与审核" })).toHaveAttribute(
      "data-state",
      "active"
    )
    view2.unmount()

    // 直达 comment-settings tab
    const view3 = renderAt(routes, "/admin/comment-settings")
    expect(await screen.findByRole("tab", { name: "评论设置" })).toHaveAttribute(
      "data-state",
      "active"
    )
    expect(await screen.findByText("全站评论审核")).toBeInTheDocument()
    view3.unmount()

    // 直达 import-export tab
    const view4 = renderAt(routes, "/admin/import-export")
    expect(await screen.findByRole("tab", { name: "导入导出" })).toHaveAttribute(
      "data-state",
      "active"
    )
    expect(screen.getByRole("button", { name: "导出备份" })).toBeInTheDocument()
    view4.unmount()
  })

  it("设置页全 tab 路径化：裸路径重定向首 tab，各 tab 直达与刷新保持", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me({ role: "user" }))

    // 裸 /settings 重定向到 /settings/security
    const view1 = renderAt(routes, "/settings")
    expect(await screen.findByRole("tab", { name: "安全" })).toHaveAttribute(
      "data-state",
      "active"
    )
    view1.unmount()

    // 直达 preferences tab
    const view2 = renderAt(routes, "/settings/preferences")
    expect(await screen.findByRole("tab", { name: "偏好" })).toHaveAttribute(
      "data-state",
      "active"
    )
    expect(screen.getByText("时区")).toBeInTheDocument()
    view2.unmount()
  })

  it("账号菜单里的个人资料跳到独立页", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me())

    renderAt(routes, "/workbench")
    const account = await openAccountMenu()
    await account.click(screen.getByRole("menuitem", { name: "个人资料" }))

    expect(
      await screen.findByRole("heading", { level: 1, name: "个人资料" })
    ).toBeInTheDocument()
  })

  it("头像显示昵称首字", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me({ displayName: "水手" }))

    renderAt(routes, "/workbench")
    const trigger = await screen.findByRole("button", { name: "账号" })
    expect(within(trigger).getByText("水")).toBeInTheDocument()
  })
  it("标签页 title 跟随页面并带站名后缀", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    renderAt(routes, "/login")
    await screen.findByRole("heading", { name: "登录" })
    expect(document.title).toBe(`登录 · ${PROJECT_NAME}`)
  })

  it("登录态默认页标签页 title 为「评论 · 站名」", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me())

    renderAt(routes, "/comments")
    await screen.findByRole("heading", { name: "评论" })
    expect(document.title).toBe(`评论 · ${PROJECT_NAME}`)
  })

  it("侧栏站名是回评论默认页的链接，底部显示三段式版本号", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me())

    renderAt(routes, "/comments")
    await screen.findByRole("heading", { name: "评论" })

    const brand = screen.getByRole("link", { name: PROJECT_NAME })
    expect(brand.getAttribute("href")).toBe("/ui/comments")
    // 站点标是装饰性图形：带在链接里，但不进可访问名（名仍只是站名）。
    const mark = brand.querySelector("svg")
    expect(mark).not.toBeNull()
    expect(mark).toHaveAttribute("aria-hidden", "true")
    expect(
      screen.getByText(
        new RegExp(
          `${PROJECT_NAME} · \\d+\\.\\d+\\.\\d+ · [0-9a-f]+\\+build\\.\\d+`
        )
      )
    ).toBeInTheDocument()
  })

  it("移动抽屉页头的站名同样带站点标", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me())

    renderAt(routes, "/comments")
    await screen.findByRole("heading", { name: "评论" })

    await accountUser().click(screen.getByRole("button", { name: "菜单" }))

    const dialog = await screen.findByRole("dialog")
    const brand = within(dialog).getByRole("link", { name: PROJECT_NAME })
    expect(brand.getAttribute("href")).toBe("/ui/comments")
    expect(brand.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
  })

  it("侧栏宽度与收起状态从 localStorage 恢复，展开后写回", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me())
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, "320")
    localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, "false")

    const view = renderAt(routes, "/comments")
    await screen.findByRole("heading", { name: "评论" })

    const sidebar = view.container.querySelector('[data-slot="sidebar"]')
    expect(sidebar).toHaveAttribute("data-state", "collapsed")
    expect(sidebar).toHaveAttribute("data-collapsible", "icon")

    const wrapper = view.container.querySelector(
      '[data-slot="sidebar-wrapper"]'
    ) as HTMLElement
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("320px")

    await userEvent.click(screen.getByRole("button", { name: "展开侧栏" }))

    expect(sidebar).toHaveAttribute("data-state", "expanded")
    expect(localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBe("true")
    // 收起 / 展开不覆盖用户调好的宽度。
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("320")
  })

  it("拖动右缘改宽、夹到上限，拖动后的尾随 click 不收起", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me())

    const view = renderAt(routes, "/comments")
    await screen.findByRole("heading", { name: "评论" })

    const wrapper = view.container.querySelector(
      '[data-slot="sidebar-wrapper"]'
    ) as HTMLElement
    const sidebar = view.container.querySelector('[data-slot="sidebar"]')
    const rail = screen.getByRole("button", { name: "切换侧栏" })
    expect(rail).toHaveClass("touch-none")

    fireEvent.pointerDown(rail, { pointerId: 1, button: 0, clientX: 500 })
    fireEvent.pointerMove(rail, { pointerId: 1, clientX: 560 })
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("300px")
    expect(wrapper).toHaveAttribute("data-resizing", "true")

    // 越过上限夹到 360，松手才落盘。
    fireEvent.pointerMove(rail, { pointerId: 1, clientX: 900 })
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("360px")
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBeNull()

    fireEvent.pointerUp(rail, { pointerId: 1, clientX: 900 })
    expect(wrapper).not.toHaveAttribute("data-resizing")
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("360")

    // 拖动过：尾随 click 被吞掉，侧栏保持展开。
    fireEvent.click(rail)
    expect(sidebar).toHaveAttribute("data-state", "expanded")

    // 原地点击（位移 ≤ 3px）仍走 SidebarRail 原生切换。
    fireEvent.pointerDown(rail, { pointerId: 2, button: 0, clientX: 500 })
    fireEvent.pointerUp(rail, { pointerId: 2, clientX: 501 })
    fireEvent.click(rail)
    expect(sidebar).toHaveAttribute("data-state", "collapsed")
    expect(localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBe("false")
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("360px")
  })

  it("收起态顶部只留站点标，站名转 sr-only", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me())
    localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, "false")

    const view = renderAt(routes, "/comments")
    await screen.findByRole("heading", { name: "评论" })

    const sidebar = view.container.querySelector('[data-slot="sidebar"]')
    expect(sidebar).toHaveAttribute("data-state", "collapsed")

    const brand = screen.getByRole("link", { name: PROJECT_NAME })
    expect(brand.className).not.toContain(
      "group-data-[collapsible=icon]:hidden"
    )
    expect(brand.querySelector("svg")).not.toBeNull()
    expect(within(brand).getByText(PROJECT_NAME).className).toContain(
      "group-data-[collapsible=icon]:sr-only"
    )
  })

  it("收起/展开按钮只留图标，与版本文字同排靠右，悬停出两态提示", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me())

    renderAt(routes, "/comments")
    await screen.findByRole("heading", { name: "评论" })

    const collapse = screen.getByRole("button", { name: "收起侧栏" })
    expect(collapse.textContent).toBe("")

    const version = screen.getByText(
      new RegExp(
        `${PROJECT_NAME} · \\d+\\.\\d+\\.\\d+ · [0-9a-f]+\\+build\\.\\d+`
      )
    )
    expect(version.parentElement).toBe(collapse.parentElement)
    expect(collapse.parentElement?.className).toContain("justify-between")

    const user = accountUser()
    await user.hover(collapse)
    expect(await screen.findByRole("tooltip")).toHaveTextContent("收起侧栏")
    await user.unhover(collapse)

    await user.click(collapse)
    const expand = screen.getByRole("button", { name: "展开侧栏" })
    // 点击后指针仍停在按钮上，先移开再进入，确保触发新的 pointerenter。
    await user.unhover(expand)
    await user.hover(expand)
    expect(await screen.findByRole("tooltip")).toHaveTextContent("展开侧栏")
  })
})
