import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  MemoryRouter,
  Navigate,
  Outlet,
  useInRouterContext,
  useLocation,
  useOutlet,
  useOutletContext
} from "react-router"
import { adminApi } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import type { AdminSettings } from "@/lib/api-types"
import { RoutedTabs, type RoutedTabItem } from "@/components/routed-tabs"
import { CreateUserSection } from "@/pages/admin/create-user-section"
import { EmailSection } from "@/pages/admin/email-section"
import { MaintenanceSection } from "@/pages/admin/maintenance-section"
import { RegistrationSection } from "@/pages/admin/registration-section"
import { UsersSection } from "@/pages/admin/users-section"
import { SiteSettingsPage } from "@/pages/site-settings/site-settings-page"
import { DataPage } from "@/pages/data/data-page"

export interface AdminOutletContext {
  settings: AdminSettings
  setSettings: (settings: AdminSettings) => void
}

export function AdminEmailTab() {
  const context = useOutletContext<AdminOutletContext>()
  return (
    <EmailSection settings={context.settings} onSaved={context.setSettings} />
  )
}

export function AdminRegistrationTab() {
  const context = useOutletContext<AdminOutletContext>()
  return (
    <RegistrationSection
      settings={context.settings}
      onSaved={context.setSettings}
    />
  )
}

export function AdminUsersTab() {
  return (
    <div className="space-y-4">
      <CreateUserSection />
      <UsersSection />
    </div>
  )
}

export function AdminMaintenanceTab() {
  const context = useOutletContext<AdminOutletContext>()
  return (
    <MaintenanceSection
      settings={context.settings}
      onSaved={context.setSettings}
    />
  )
}

export { SiteSettingsPage as CommentSettingsTab, DataPage as ImportExportTab }

function AdminPageInner() {
  const { t } = useTranslation()
  const location = useLocation()
  const outlet = useOutlet()
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setError("")
    try {
      setSettings(await adminApi.settings())
    } catch (loadError) {
      setError(describeApiError(t, loadError))
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const tabs: RoutedTabItem[] = [
    { to: "/admin/email", label: t("admin.tabs.email") },
    { to: "/admin/registration", label: t("admin.tabs.registration") },
    { to: "/admin/users", label: t("admin.tabs.users") },
    { to: "/admin/comment-settings", label: t("admin.tabs.commentSettings") },
    { to: "/admin/import-export", label: t("admin.tabs.importExport") },
    { to: "/admin/database", label: t("admin.tabs.maintenance") }
  ]

  const isKnownTab =
    location.pathname.startsWith("/admin/email") ||
    location.pathname.startsWith("/admin/registration") ||
    location.pathname.startsWith("/admin/users") ||
    location.pathname.startsWith("/admin/comment-settings") ||
    location.pathname.startsWith("/admin/import-export") ||
    location.pathname.startsWith("/admin/database")

  if (location.pathname.startsWith("/admin/maintenance")) {
    return <Navigate to="/admin/database" replace />
  }

  if (
    location.pathname === "/admin" ||
    location.pathname === "/admin/" ||
    !isKnownTab
  ) {
    return <Navigate to="/admin/email" replace />
  }

  const renderFallbackContent = (loadedSettings: AdminSettings) => {
    if (location.pathname.startsWith("/admin/registration")) {
      return (
        <RegistrationSection settings={loadedSettings} onSaved={setSettings} />
      )
    }
    if (location.pathname.startsWith("/admin/users")) {
      return (
        <div className="space-y-4">
          <CreateUserSection />
          <UsersSection />
        </div>
      )
    }
    if (location.pathname.startsWith("/admin/comment-settings")) {
      return <SiteSettingsPage />
    }
    if (location.pathname.startsWith("/admin/import-export")) {
      return <DataPage />
    }
    if (
      location.pathname.startsWith("/admin/database") ||
      location.pathname.startsWith("/admin/maintenance")
    ) {
      return (
        <MaintenanceSection settings={loadedSettings} onSaved={setSettings} />
      )
    }
    return <EmailSection settings={loadedSettings} onSaved={setSettings} />
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4" data-testid="admin-page">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {!settings && !error ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : null}

      {settings ? (
        <>
          <RoutedTabs tabs={tabs} />
          <div className="pt-4">
            {outlet ? (
              <Outlet
                context={{ settings, setSettings } satisfies AdminOutletContext}
              />
            ) : (
              renderFallbackContent(settings)
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}

/**
 * 系统管理页（规格 §6.1，仅管理员）：
 * 六 tab 路径段子路由（/admin/email、/admin/registration、/admin/users、
 * /admin/comment-settings、/admin/import-export、/admin/database）。
 * 裸路径重定向首 tab，全站无状态切换式 tab 残留。
 */
export function AdminPage() {
  const inRouter = useInRouterContext()
  if (!inRouter) {
    return (
      <MemoryRouter initialEntries={["/admin/email"]}>
        <AdminPageInner />
      </MemoryRouter>
    )
  }
  return <AdminPageInner />
}
