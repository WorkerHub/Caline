import { useTranslation } from "react-i18next"
import {
  MemoryRouter,
  Navigate,
  useInRouterContext,
  useLocation,
  useOutlet
} from "react-router"
import { RoutedTabs, type RoutedTabItem } from "@/components/routed-tabs"
import { PreferencesSection } from "@/pages/settings/preferences-section"
import { SecuritySection } from "@/pages/settings/security-section"

function SettingsPageInner() {
  const { t } = useTranslation()
  const location = useLocation()
  const outlet = useOutlet()

  const tabs: RoutedTabItem[] = [
    { to: "/settings/security", label: t("settings.tabs.security") },
    { to: "/settings/preferences", label: t("settings.tabs.preferences") }
  ]

  // 裸 /settings 或未知子路径重定向回首个 tab
  if (
    location.pathname === "/settings" ||
    location.pathname === "/settings/" ||
    (!location.pathname.startsWith("/settings/security") &&
      !location.pathname.startsWith("/settings/preferences"))
  ) {
    return <Navigate to="/settings/security" replace />
  }

  const isPreferences = location.pathname.startsWith("/settings/preferences")

  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="settings-page">
      <RoutedTabs tabs={tabs} />

      <div className="pt-4">
        {outlet ??
          (isPreferences ? <PreferencesSection /> : <SecuritySection />)}
      </div>
    </div>
  )
}

/**
 * 设置页（技术方案 §5A.3）：安全与偏好两项，全部路径化（/settings/security、/settings/preferences）。
 * 裸路径重定向首 tab，支持刷新、直达与浏览器前进后退。
 */
export function SettingsPage() {
  const inRouter = useInRouterContext()
  if (!inRouter) {
    return (
      <MemoryRouter initialEntries={["/settings/security"]}>
        <SettingsPageInner />
      </MemoryRouter>
    )
  }
  return <SettingsPageInner />
}
