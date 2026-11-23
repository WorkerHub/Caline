import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach, beforeEach, vi } from "vitest"
import { i18n } from "@/i18n"

/**
 * 测试环境的公共卫生：jsdom 的 matchMedia、语言与 localStorage。
 *
 * 注意：这里不在模块顶层 import 任何 store —— store 会在 import 时抓住当时的
 * api 模块，早于测试文件的 vi.mock 就会拿到真实客户端。改为每个用例动态 import，
 * 保证页面测试注入的 mock 生效。
 */
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
})

// jsdom 未实现 Pointer Capture API，Radix Select 等组件会调用它。
if (typeof Element !== "undefined") {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false)
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = vi.fn()
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = vi.fn()
  }
  // jsdom 未实现 scrollIntoView，Radix Select 打开下拉时会调用。
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn()
  }
}

// jsdom 未实现 ResizeObserver，Radix Popper / Tooltip 测量锚点尺寸时会 new 它。
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

// jsdom 未实现 Image 真实资源加载，Radix AvatarPrimitive.Image 依赖 onload 上报切换 fallback。
if (typeof window !== "undefined") {
  class MockImage extends EventTarget {
    onload: ((event: Event) => void) | null = null
    onerror: ((event: Event) => void) | null = null
    private _src = ""
    complete = true
    naturalWidth = 100
    naturalHeight = 100

    get src() {
      return this._src
    }

    set src(value: string) {
      this._src = value
      queueMicrotask(() => {
        if (value && !value.includes("error") && !value.includes("fail")) {
          this.complete = true
          this.naturalWidth = 100
          this.naturalHeight = 100
          const event = new Event("load")
          this.dispatchEvent(event)
          this.onload?.(event)
        } else {
          this.complete = true
          this.naturalWidth = 0
          this.naturalHeight = 0
          const event = new Event("error")
          this.dispatchEvent(event)
          this.onerror?.(event)
        }
      })
    }
  }
  window.Image = MockImage as unknown as typeof Image
}

async function resetStores() {
  const [
    { useAuthStore },
    { useSetupStore },
    { useSiteStore },
    { useThemeStore }
  ] = await Promise.all([
    import("@/stores/auth"),
    import("@/stores/setup"),
    import("@/stores/site"),
    import("@/stores/theme")
  ])
  useAuthStore.setState({ user: null, status: "ready" })
  useSetupStore.setState({ state: null, loaded: false })
  useSiteStore.setState({ info: null, loaded: false })
  useThemeStore.setState({ theme: "auto" })
}

beforeEach(async () => {
  localStorage.clear()
  document.documentElement.className = ""
  document.documentElement.removeAttribute("style")
  document.documentElement.lang = "zh"
  await i18n.changeLanguage("zh")
  await resetStores()
})

afterEach(async () => {
  cleanup()
  await resetStores()
  localStorage.clear()
})
