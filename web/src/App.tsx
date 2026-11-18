import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
  RouterProvider
} from "react-router"
import { Toaster } from "@/components/ui/sonner"
import { AppShell } from "@/components/app-shell"
import {
  RootGate,
  GuestOnly,
  RequireAdmin,
  RequireAuth,
  RequirePasswordChanged,
  RoleLandingRedirect
} from "@/components/guards"
import { ThemeProvider } from "@/components/theme-provider"
import { AboutPage } from "@/pages/about"
import {
  AdminEmailTab,
  AdminMaintenanceTab,
  AdminPage,
  AdminRegistrationTab,
  AdminUsersTab,
  CommentSettingsTab,
  ImportExportTab
} from "@/pages/admin/admin-page"
import { ForgotPasswordPage } from "@/pages/auth/forgot-password"
import { LoginPage } from "@/pages/auth/login"
import { RegisterPage } from "@/pages/auth/register"
import { ChangePasswordPage } from "@/pages/change-password"
import { CommentsPage } from "@/pages/comments/comments-page"
import { MyCommentsPage } from "@/pages/my-comments/my-comments-page"
import { NotFoundPage } from "@/pages/not-found"
import { ProfilePage } from "@/pages/profile"
import { SettingsPage } from "@/pages/settings"
import { PreferencesSection } from "@/pages/settings/preferences-section"
import { SecuritySection } from "@/pages/settings/security-section"
import { SetupPage } from "@/pages/setup"

/**
 * 路由表单独导出：测试用 createMemoryRouter(routes, { basename: "/ui" }) 拿到同一份定义。
 *
 * SPA 整体挂载在 /ui 基座下（规格 §8 修订）：
 * - RootGate：首屏拉公开信息/setup/自己，未初始化一律去 /ui/setup；
 * - GuestOnly：公开鉴权页（/ui 默认跳转登录、注册、找回密码，已登录按角色分流）；
 * - SetupPage：初始化页位于 /ui/setup，自带三形态，不进登录壳；
 * - RequireAuth + /change-password：首登强制改密页，不入应用壳；
 * - RequirePasswordChanged + AppShell：带改密标记的账号先被送回改密页；
 * - RequireAdmin：管理员专属路由（/comments 及 /admin/* 六 tab），非管理员直达重定向回 /my-comments，不挂载、不发 admin 请求。
 */
export const routes: RouteObject[] = [
  {
    element: <RootGate />,
    children: [
      {
        element: <GuestOnly />,
        children: [
          { path: "/", element: <Navigate to="/login" replace /> },
          { path: "/login", element: <LoginPage /> },
          { path: "/register", element: <RegisterPage /> },
          { path: "/forgot-password", element: <ForgotPasswordPage /> }
        ]
      },
      { path: "/setup", element: <SetupPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: "/change-password", element: <ChangePasswordPage /> },
          {
            element: <RequirePasswordChanged />,
            children: [
              {
                element: <AppShell />,
                children: [
                  { path: "/", element: <RoleLandingRedirect /> },
                  { path: "/workbench", element: <RoleLandingRedirect /> },
                  { path: "/my-comments", element: <MyCommentsPage /> },
                  {
                    path: "/settings",
                    element: <SettingsPage />,
                    children: [
                      {
                        index: true,
                        element: <Navigate to="security" replace />
                      },
                      { path: "security", element: <SecuritySection /> },
                      { path: "preferences", element: <PreferencesSection /> },
                      { path: "*", element: <Navigate to="security" replace /> }
                    ]
                  },
                  { path: "/profile", element: <ProfilePage /> },
                  { path: "/about", element: <AboutPage /> },
                  // 旧地址兼容重定向（不留 404）
                  {
                    path: "/site-settings",
                    element: <Navigate to="/admin/comment-settings" replace />
                  },
                  {
                    path: "/data",
                    element: <Navigate to="/admin/import-export" replace />
                  },
                  // 管理员专属路由：评论页 + 系统管理六 tab
                  {
                    element: <RequireAdmin />,
                    children: [
                      { path: "/comments", element: <CommentsPage /> },
                      {
                        path: "/admin",
                        element: <AdminPage />,
                        children: [
                          {
                            index: true,
                            element: <Navigate to="email" replace />
                          },
                          { path: "email", element: <AdminEmailTab /> },
                          {
                            path: "registration",
                            element: <AdminRegistrationTab />
                          },
                          { path: "users", element: <AdminUsersTab /> },
                          {
                            path: "comment-settings",
                            element: <CommentSettingsTab />
                          },
                          {
                            path: "import-export",
                            element: <ImportExportTab />
                          },
                          {
                            path: "database",
                            element: <AdminMaintenanceTab />
                          },
                          {
                            path: "maintenance",
                            element: <Navigate to="/admin/database" replace />
                          },
                          {
                            path: "*",
                            element: <Navigate to="email" replace />
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      },
      { path: "*", element: <NotFoundPage /> }
    ]
  }
]

const router = createBrowserRouter(routes, { basename: "/ui" })

export function App() {
  return (
    <ThemeProvider>
      <RouterProvider router={router} />
      <Toaster position="top-center" />
    </ThemeProvider>
  )
}
