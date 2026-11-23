/**
 * 登录弹窗辅助工具：居中弹出独立窗口，支持 postMessage 校验与轮询关闭兜底。
 */

export interface OpenLoginPopupOptions {
  serverUrl: string
  onAuthRefresh: () => unknown
}

export function openLoginPopup(options: OpenLoginPopupOptions): Window | null {
  const { serverUrl, onAuthRefresh } = options
  const width = 480
  const height = 640

  let screenLeft = 0
  let screenTop = 0
  let outerWidth = 1024
  let outerHeight = 768

  if (typeof window !== "undefined") {
    screenLeft =
      typeof window.screenX !== "undefined"
        ? window.screenX
        : window.screenLeft || 0
    screenTop =
      typeof window.screenY !== "undefined"
        ? window.screenY
        : window.screenTop || 0
    outerWidth = window.outerWidth || window.innerWidth || 1024
    outerHeight = window.outerHeight || window.innerHeight || 768
  }

  const left = Math.max(0, Math.round(screenLeft + (outerWidth - width) / 2))
  const top = Math.max(0, Math.round(screenTop + (outerHeight - height) / 2))
  const features = `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`

  const popupUrl = `${serverUrl}/ui/login?popup=1`
  let popup: Window | null = null

  try {
    popup = window.open(popupUrl, "caline-login", features)
  } catch {
    popup = null
  }

  // 弹窗被拦截/打开失败回落现行新标签，不许无反应
  if (!popup || popup.closed || typeof popup.closed === "undefined") {
    try {
      window.open(`${serverUrl}/ui/login`, "_blank", "noopener")
    } catch {
      // ignore
    }
    return null
  }

  // 获取 serverUrl 的 origin
  let targetOrigin = ""
  try {
    targetOrigin = new URL(serverUrl, window.location.href).origin
  } catch {
    targetOrigin = typeof window !== "undefined" ? window.location.origin : ""
  }

  let triggered = false
  let checkTimer: ReturnType<typeof setInterval> | null = null

  const cleanup = () => {
    if (checkTimer) {
      clearInterval(checkTimer)
      checkTimer = null
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("message", handleMessage)
    }
  }

  const handleTrigger = () => {
    if (triggered) return
    triggered = true
    cleanup()
    void onAuthRefresh()
  }

  const handleMessage = (event: MessageEvent) => {
    if (targetOrigin && event.origin !== targetOrigin) {
      return
    }
    handleTrigger()
  }

  if (typeof window !== "undefined") {
    window.addEventListener("message", handleMessage)
  }

  // 轮询弹窗关闭兜底
  checkTimer = setInterval(() => {
    try {
      if (popup?.closed) {
        handleTrigger()
      }
    } catch {
      // ignore
    }
  }, 500)

  return popup
}
