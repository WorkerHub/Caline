import { NavLink, useLocation } from "react-router"
import { cn } from "cn"

export interface RoutedTabItem {
  to: string
  label: string
}

function TabLink({ tab }: { tab: RoutedTabItem }) {
  const location = useLocation()
  const isActive =
    location.pathname === tab.to || location.pathname.startsWith(`${tab.to}/`)

  return (
    <NavLink
      to={tab.to}
      role="tab"
      aria-selected={isActive}
      data-state={isActive ? "active" : "inactive"}
      className={cn(
        "inline-flex h-full items-center justify-center rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap transition-all",
        isActive
          ? "bg-background text-foreground shadow-sm font-medium"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {tab.label}
    </NavLink>
  )
}

/**
 * 路径化 Tab 导航栏：
 * 替代 useState 切换式 Tab，每个 Tab 对应真实路径段子路由。
 * 遵循 shadcn/ui TabsList/TabsTrigger 视觉标准与无障碍角色（role="tab", data-state="active|inactive"）。
 */
export function RoutedTabs({
  tabs,
  className
}: {
  tabs: RoutedTabItem[]
  className?: string
}) {
  return (
    <div
      className={cn(
        "inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
        className
      )}
      role="tablist"
      aria-label="tabs"
    >
      {tabs.map((tab) => (
        <TabLink key={tab.to} tab={tab} />
      ))}
    </div>
  )
}
