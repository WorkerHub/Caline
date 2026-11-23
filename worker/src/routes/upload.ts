/**
 * 图片上传路由（POST /api/upload）。
 * 规格约束：
 * - multipart/form-data，文件字段 `file`；
 * - 登录会话或访客均可传；访客须带 turnstileToken（站点开启时），登录用户免 Turnstile；
 * - 每 IP 每分钟至多 5 次限频；
 * - 文件校验：仅 png/jpeg/gif/webp（声明类型 + 文件头双重校验），不收 svg，单文件 ≤ 10MB；
 * - 成功返回 {data:{url}}（url 为 /img/<key> 公开读路径）、失败 {error:{code,message}}；
 * - 错误文案进 i18n（zh/en）。
 */
import { Hono, type Context } from "hono"
import { findSession, readSessionToken } from "../core/session"
import { verifyTurnstile } from "../core/pipeline"
import { enforceRateLimit } from "../core/rate-limit"
import { calineError, calineSuccess, clientIp } from "../lib/http"
import { readCalineSettings, getTurnstileSecretKey } from "../lib/settings"
import { getTablePrefix } from "../lib/table-prefix"
import type { HonoEnv } from "../types"

export const uploadRoutes = new Hono<HonoEnv>()

export type UploadLanguage = "zh" | "en"

export function resolveUploadLanguage(c: Context<HonoEnv>): UploadLanguage {
  const queryLang = c.req.query("lang")?.toLowerCase()
  if (queryLang === "zh" || queryLang === "en") return queryLang

  const accept = c.req.header("accept-language")?.toLowerCase() || ""
  if (accept.includes("zh")) return "zh"
  if (accept.includes("en")) return "en"
  return "zh"
}

export const UPLOAD_ERROR_MESSAGES: Record<
  UploadLanguage,
  Record<string, string>
> = {
  zh: {
    RATE_LIMITED: "上传过于频繁，请稍后再试",
    TURNSTILE_REQUIRED: "缺少人机验证令牌",
    TURNSTILE_FAILED: "人机验证未通过",
    TURNSTILE_NOT_CONFIGURED: "站点人机验证未配置",
    INVALID_REQUEST: "无效的上传请求",
    FILE_REQUIRED: "缺少上传文件 (file 字段)",
    FILE_TOO_LARGE: "文件大小超过限制（最大 10MB）",
    INVALID_FILE_TYPE: "不支持的文件类型，仅支持 png/jpeg/gif/webp",
    STORAGE_NOT_CONFIGURED: "对象存储未配置",
    UPLOAD_FAILED: "上传文件失败"
  },
  en: {
    RATE_LIMITED: "Too many upload requests. Please wait before retrying.",
    TURNSTILE_REQUIRED: "Turnstile verification token is required",
    TURNSTILE_FAILED: "Turnstile verification failed",
    TURNSTILE_NOT_CONFIGURED: "Turnstile verification is not configured",
    INVALID_REQUEST: "Invalid upload request",
    FILE_REQUIRED: "Upload file is required in 'file' field",
    FILE_TOO_LARGE: "File size exceeds 10MB limit",
    INVALID_FILE_TYPE:
      "Unsupported file type. Only png, jpeg, gif, and webp are allowed",
    STORAGE_NOT_CONFIGURED: "Object storage is not configured",
    UPLOAD_FAILED: "Failed to upload file"
  }
}

export interface DetectedImageInfo {
  type: "png" | "jpeg" | "gif" | "webp"
  ext: string
  mimeType: string
}

export function detectImageMagicNumbers(
  bytes: Uint8Array
): "png" | "jpeg" | "gif" | "webp" | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png"
  }
  // JPEG: FF D8 FF
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "jpeg"
  }
  // GIF: GIF87a or GIF89a (47 49 46 38 37/39 61)
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "gif"
  }
  // WebP: RIFF .... WEBP (52 49 46 46 xx xx xx xx 57 45 42 50)
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp"
  }
  return null
}

const ALLOWED_MIME_TYPES: Record<
  string,
  { type: "png" | "jpeg" | "gif" | "webp"; ext: string; mimeType: string }
> = {
  "image/png": { type: "png", ext: "png", mimeType: "image/png" },
  "image/jpeg": { type: "jpeg", ext: "jpg", mimeType: "image/jpeg" },
  "image/jpg": { type: "jpeg", ext: "jpg", mimeType: "image/jpeg" },
  "image/gif": { type: "gif", ext: "gif", mimeType: "image/gif" },
  "image/webp": { type: "webp", ext: "webp", mimeType: "image/webp" }
}

export function validateImage(
  declaredMimeType: string,
  bytes: Uint8Array
): DetectedImageInfo | null {
  const normMime = declaredMimeType.trim().toLowerCase()
  const allowed = ALLOWED_MIME_TYPES[normMime]
  if (!allowed) {
    return null
  }
  const detected = detectImageMagicNumbers(bytes)
  if (!detected || detected !== allowed.type) {
    return null
  }
  return allowed
}

export function generateImageKey(ext: string): string {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, "0")
  const day = String(now.getUTCDate()).padStart(2, "0")
  const randomPart = crypto.randomUUID().replace(/-/g, "")
  return `${year}/${month}/${day}/${randomPart}.${ext}`
}

uploadRoutes.post("/", async (c) => {
  const lang = resolveUploadLanguage(c)
  const getMsg = (code: string) =>
    UPLOAD_ERROR_MESSAGES[lang][code] ||
    UPLOAD_ERROR_MESSAGES.zh[code] ||
    "Error"

  const ip = clientIp(c)
  const prefix = getTablePrefix(c.env)

  // 1. 每 IP 每分钟至多 5 次限频
  const limitRule = {
    action: "upload_image",
    ip,
    windowSeconds: 60,
    max: 5
  }
  const limit = await enforceRateLimit(c.env.DB, prefix, limitRule)
  if (!limit.allowed) {
    return calineError(c, 429, "RATE_LIMITED", getMsg("RATE_LIMITED"), {
      retryAfter: limit.retryAfter
    })
  }

  // 2. 早期 Content-Length 头校验（粗筛只拦真正的内存放大，放宽 64KB 容纳 multipart headers/token）
  const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
  const MAX_BODY_PREFILTER_SIZE = MAX_FILE_SIZE + 64 * 1024
  const contentLength = c.req.header("content-length")
  if (contentLength) {
    const parsedLength = Number.parseInt(contentLength, 10)
    if (!Number.isNaN(parsedLength) && parsedLength > MAX_BODY_PREFILTER_SIZE) {
      return calineError(c, 400, "FILE_TOO_LARGE", getMsg("FILE_TOO_LARGE"))
    }
  }

  // 3. 解析 multipart/form-data
  let formData: FormData
  try {
    formData = await c.req.formData()
  } catch {
    return calineError(c, 400, "INVALID_REQUEST", getMsg("INVALID_REQUEST"))
  }

  // 4. 鉴权态判定（登录会话免 Turnstile，访客须验 Turnstile）
  const token = readSessionToken(c)
  const session = token ? await findSession(c.env.DB, prefix, token) : null
  const isLoggedIn = Boolean(session)

  if (!isLoggedIn) {
    const settings = await readCalineSettings(c.env)
    if (settings.turnstileEnabled) {
      const turnstileSecret = await getTurnstileSecretKey(c.env)
      if (!turnstileSecret) {
        return calineError(
          c,
          500,
          "TURNSTILE_NOT_CONFIGURED",
          getMsg("TURNSTILE_NOT_CONFIGURED")
        )
      }
      const turnstileToken = formData.get("turnstileToken")
      if (!turnstileToken || typeof turnstileToken !== "string") {
        return calineError(
          c,
          403,
          "TURNSTILE_REQUIRED",
          getMsg("TURNSTILE_REQUIRED")
        )
      }
      const verified = await verifyTurnstile(
        turnstileSecret,
        turnstileToken,
        ip
      )
      if (!verified) {
        return calineError(
          c,
          403,
          "TURNSTILE_FAILED",
          getMsg("TURNSTILE_FAILED")
        )
      }
    }
  }

  // 5. 文件提取与校验
  const file = formData.get("file")
  if (!file || typeof file === "string" || !(file instanceof File)) {
    return calineError(c, 400, "FILE_REQUIRED", getMsg("FILE_REQUIRED"))
  }

  if (file.size === 0) {
    return calineError(c, 400, "FILE_REQUIRED", getMsg("FILE_REQUIRED"))
  }
  if (file.size > MAX_FILE_SIZE) {
    return calineError(c, 400, "FILE_TOO_LARGE", getMsg("FILE_TOO_LARGE"))
  }

  const headerBuffer = await file.slice(0, 16).arrayBuffer()
  const headerBytes = new Uint8Array(headerBuffer)
  const validated = validateImage(file.type, headerBytes)
  if (!validated) {
    return calineError(c, 400, "INVALID_FILE_TYPE", getMsg("INVALID_FILE_TYPE"))
  }

  if (!c.env.IMAGES) {
    return calineError(
      c,
      500,
      "STORAGE_NOT_CONFIGURED",
      getMsg("STORAGE_NOT_CONFIGURED")
    )
  }

  const key = generateImageKey(validated.ext)
  const fileBuffer = await file.arrayBuffer()
  await c.env.IMAGES.put(key, fileBuffer, {
    httpMetadata: {
      contentType: validated.mimeType
    }
  })

  return calineSuccess(c, {
    url: `/img/${key}`
  })
})
