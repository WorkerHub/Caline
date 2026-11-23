/**
 * Cloudflare Turnstile 官方组件脚本加载与类型封装。
 * 遵循立规：使用官方组件（https://challenges.cloudflare.com/turnstile/v0/api.js），不自研挑战 UI。
 */

export const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js"

export interface TurnstileRenderOptions {
  sitekey: string
  action?: string
  cData?: string
  callback?: (token: string) => void
  "error-callback"?: (errorCode?: string) => void
  "expired-callback"?: () => void
  "timeout-callback"?: () => void
  theme?: "auto" | "light" | "dark"
  size?: "normal" | "compact" | "flexible"
  tabindex?: number
  "response-field"?: boolean
  "response-field-name"?: string
}

export interface TurnstileApi {
  render(
    container: string | HTMLElement,
    options: TurnstileRenderOptions
  ): string
  reset(widgetId?: string): void
  remove(widgetId: string): void
  getResponse(widgetId?: string): string
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptLoadPromise: Promise<TurnstileApi> | null = null

export function loadTurnstileScript(): Promise<TurnstileApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("window is undefined"))
  }

  if (window.turnstile) {
    return Promise.resolve(window.turnstile)
  }

  if (scriptLoadPromise) {
    return scriptLoadPromise
  }

  scriptLoadPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src^="${TURNSTILE_SCRIPT_URL}"]`
    )

    const onScriptReady = () => {
      if (window.turnstile) {
        resolve(window.turnstile)
      } else {
        let attempts = 0
        const interval = setInterval(() => {
          attempts++
          if (window.turnstile) {
            clearInterval(interval)
            resolve(window.turnstile)
          } else if (attempts > 50) {
            clearInterval(interval)
            reject(new Error("Turnstile API failed to initialize"))
          }
        }, 50)
      }
    }

    if (existingScript) {
      existingScript.addEventListener("load", onScriptReady)
      existingScript.addEventListener("error", () => {
        scriptLoadPromise = null
        reject(new Error("Failed to load Turnstile script"))
      })
      return
    }

    const script = document.createElement("script")
    script.src = TURNSTILE_SCRIPT_URL
    script.async = true
    script.defer = true
    script.onload = onScriptReady
    script.onerror = () => {
      scriptLoadPromise = null
      reject(new Error("Failed to load Turnstile script"))
    }
    document.head.appendChild(script)
  })

  return scriptLoadPromise
}

export function resetScriptLoadPromiseForTest(): void {
  scriptLoadPromise = null
}
