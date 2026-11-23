import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  activePrefix,
  initializedContext,
  request,
  seedSession,
  type TestContext
} from "./support/app"
import { consumeCounter, readCounter } from "../src/core/counters"
import { isAllowedReferer } from "../src/routes/img"
import { writeCalineSettings } from "../src/lib/settings"

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52
])

const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x01, 0x00, 0x60
])

const GIF_BYTES = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0xff, 0xff, 0xff
])

const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56,
  0x50, 0x38, 0x20
])

describe("R2 Image Upload & Public Serving", () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await initializedContext()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeUploadRequest(
    formData: FormData,
    options: {
      headers?: Record<string, string>
      cookie?: string
      query?: string
    } = {}
  ) {
    const headers: Record<string, string> = {
      ...(options.headers ?? {})
    }
    if (options.cookie) {
      headers.Cookie = options.cookie
    }
    const path = options.query ? `/api/upload?${options.query}` : "/api/upload"
    return request(ctx.env, path, {
      method: "POST",
      headers,
      body: formData
    })
  }

  describe("File validation & Upload success", () => {
    it("successfully uploads a valid PNG image and serves it through /img/<key>", async () => {
      const formData = new FormData()
      const blob = new Blob([PNG_BYTES], { type: "image/png" })
      formData.append("file", blob, "test.png")

      const res = await makeUploadRequest(formData)
      expect(res.status).toBe(200)

      const body = (await res.json()) as { data: { url: string } }
      expect(body.data).toBeDefined()
      expect(body.data.url).toMatch(
        /^\/img\/\d{4}\/\d{2}\/\d{2}\/[a-f0-9]+\.png$/
      )

      const key = body.data.url.replace(/^\/img\//, "")
      const stored = await ctx.images.get(key)
      expect(stored).not.toBeNull()
      expect(stored?.httpMetadata?.contentType).toBe("image/png")

      // 读取 GET /img/<key>
      const imgRes = await request(ctx.env, body.data.url)
      expect(imgRes.status).toBe(200)
      expect(imgRes.headers.get("Cache-Control")).toBe(
        "public, max-age=31536000, immutable"
      )
      expect(imgRes.headers.get("Content-Type")).toBe("image/png")
      expect(imgRes.headers.get("Access-Control-Allow-Origin")).toBe("*")

      // ETag 304 缓存重用
      const etag = imgRes.headers.get("ETag")
      if (etag) {
        // 精确匹配
        const cachedRes = await request(ctx.env, body.data.url, {
          headers: { "If-None-Match": etag }
        })
        expect(cachedRes.status).toBe(304)

        // 弱校验 W/ 前缀匹配
        const weakCachedRes = await request(ctx.env, body.data.url, {
          headers: { "If-None-Match": `W/${etag}` }
        })
        expect(weakCachedRes.status).toBe(304)

        // 逗号分隔列表匹配
        const multiCachedRes = await request(ctx.env, body.data.url, {
          headers: { "If-None-Match": `"other-etag", ${etag}` }
        })
        expect(multiCachedRes.status).toBe(304)
      }
    })

    it("successfully uploads JPEG, GIF, and WebP images", async () => {
      // JPEG
      const fdJpeg = new FormData()
      fdJpeg.append(
        "file",
        new Blob([JPEG_BYTES], { type: "image/jpeg" }),
        "photo.jpg"
      )
      const resJpeg = await makeUploadRequest(fdJpeg)
      expect(resJpeg.status).toBe(200)
      const dataJpeg = (await resJpeg.json()) as { data: { url: string } }
      expect(dataJpeg.data.url).toMatch(/\.jpg$/)

      // GIF
      const fdGif = new FormData()
      fdGif.append(
        "file",
        new Blob([GIF_BYTES], { type: "image/gif" }),
        "ani.gif"
      )
      const resGif = await makeUploadRequest(fdGif)
      expect(resGif.status).toBe(200)
      const dataGif = (await resGif.json()) as { data: { url: string } }
      expect(dataGif.data.url).toMatch(/\.gif$/)

      // WebP
      const fdWebp = new FormData()
      fdWebp.append(
        "file",
        new Blob([WEBP_BYTES], { type: "image/webp" }),
        "pic.webp"
      )
      const resWebp = await makeUploadRequest(fdWebp)
      expect(resWebp.status).toBe(200)
      const dataWebp = (await resWebp.json()) as { data: { url: string } }
      expect(dataWebp.data.url).toMatch(/\.webp$/)
    })

    it("returns 404 for nonexistent, path traversal, or malformed percent-encoded images", async () => {
      const res404 = await request(ctx.env, "/img/2026/01/01/not-found.png")
      expect(res404.status).toBe(404)

      const resTraversal = await request(ctx.env, "/img/../secret.png")
      expect(resTraversal.status).toBe(404)

      // 畸形百分号编码不会导致 500 异常崩溃，如实回 404
      const resPercent = await request(ctx.env, "/img/%")
      expect(resPercent.status).toBe(404)

      const resMalformed = await request(ctx.env, "/img/%zz")
      expect(resMalformed.status).toBe(404)
    })

    it("rejects request without file field or empty file", async () => {
      const formData = new FormData()
      formData.append("other", "field")

      const res = await makeUploadRequest(formData)
      expect(res.status).toBe(400)
      const body = (await res.json()) as {
        error: { code: string; message: string }
      }
      expect(body.error.code).toBe("FILE_REQUIRED")

      // 空文件 (0 字节) 给出明确的 FILE_REQUIRED
      const fdEmpty = new FormData()
      fdEmpty.append("file", new Blob([], { type: "image/png" }), "empty.png")
      const resEmpty = await makeUploadRequest(fdEmpty)
      expect(resEmpty.status).toBe(400)
      const bodyEmpty = (await resEmpty.json()) as {
        error: { code: string; message: string }
      }
      expect(bodyEmpty.error.code).toBe("FILE_REQUIRED")
    })

    it("rejects files larger than 10MB via Content-Length or actual size", async () => {
      // 早期 Content-Length 粗筛拦截（大于 10MB + 64KB 阈值）
      const formData = new FormData()
      formData.append(
        "file",
        new Blob([PNG_BYTES], { type: "image/png" }),
        "small.png"
      )
      const resEarly = await makeUploadRequest(formData, {
        headers: { "Content-Length": String(10 * 1024 * 1024 + 64 * 1024 + 1) }
      })
      expect(resEarly.status).toBe(400)
      const bodyEarly = (await resEarly.json()) as {
        error: { code: string; message: string }
      }
      expect(bodyEarly.error.code).toBe("FILE_TOO_LARGE")

      // 实际 payload 超过 10MB 的大文件
      const oversized = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], {
        type: "image/png"
      })
      const fdOversized = new FormData()
      fdOversized.append("file", oversized, "large.png")

      const res = await makeUploadRequest(fdOversized)
      expect(res.status).toBe(400)
      const body = (await res.json()) as {
        error: { code: string; message: string }
      }
      expect(body.error.code).toBe("FILE_TOO_LARGE")
    })

    it("allows legitimate near-boundary file (exact 10MB) without being rejected by Content-Length pre-filter", async () => {
      // 创建一个恰好 10MB 的有效 PNG
      const exact10MBBytes = new Uint8Array(10 * 1024 * 1024)
      exact10MBBytes.set(PNG_BYTES, 0)
      const exact10MBBlob = new Blob([exact10MBBytes], { type: "image/png" })

      const formData = new FormData()
      formData.append("file", exact10MBBlob, "exact-10mb.png")

      // 模拟 multipart body 长度略大于 10MB（如 + 2KB 的 boundary/header）
      const simulatedBodyLength = 10 * 1024 * 1024 + 2048
      const res = await makeUploadRequest(formData, {
        headers: { "Content-Length": String(simulatedBodyLength) }
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { url: string } }
      expect(body.data.url).toMatch(/^\/img\//)
    })

    it("rejects svg and non-whitelisted image types", async () => {
      const formData = new FormData()
      const svgBlob = new Blob(
        ['<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
        {
          type: "image/svg+xml"
        }
      )
      formData.append("file", svgBlob, "icon.svg")

      const res = await makeUploadRequest(formData)
      expect(res.status).toBe(400)
      const body = (await res.json()) as {
        error: { code: string; message: string }
      }
      expect(body.error.code).toBe("INVALID_FILE_TYPE")
    })

    it("rejects forged files with mismatched mime type and magic numbers", async () => {
      // 声明是 image/png，实际内容是纯文本
      const formData = new FormData()
      const fakeBlob = new Blob(["not a png at all"], { type: "image/png" })
      formData.append("file", fakeBlob, "fake.png")

      const res = await makeUploadRequest(formData)
      expect(res.status).toBe(400)
      const body = (await res.json()) as {
        error: { code: string; message: string }
      }
      expect(body.error.code).toBe("INVALID_FILE_TYPE")

      // 声明是 image/png，实际内容是 JPEG
      const formData2 = new FormData()
      const jpegAsPng = new Blob([JPEG_BYTES], { type: "image/png" })
      formData2.append("file", jpegAsPng, "jpeg-as-png.png")
      const res2 = await makeUploadRequest(formData2)
      expect(res2.status).toBe(400)
      const body2 = (await res2.json()) as {
        error: { code: string; message: string }
      }
      expect(body2.error.code).toBe("INVALID_FILE_TYPE")
    })
  })

  describe("i18n Error Messages", () => {
    it("returns Chinese error messages by default or with Accept-Language: zh", async () => {
      const formData = new FormData()
      formData.append("other", "value")

      const res = await makeUploadRequest(formData, {
        headers: { "Accept-Language": "zh-CN,zh;q=0.9" }
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as {
        error: { code: string; message: string }
      }
      expect(body.error.code).toBe("FILE_REQUIRED")
      expect(body.error.message).toContain("缺少上传文件")
    })

    it("returns English error messages with Accept-Language: en or query lang=en", async () => {
      const formData = new FormData()
      formData.append("other", "value")

      const res = await makeUploadRequest(formData, {
        headers: { "Accept-Language": "en-US,en;q=0.9" }
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as {
        error: { code: string; message: string }
      }
      expect(body.error.code).toBe("FILE_REQUIRED")
      expect(body.error.message).toContain("Upload file is required")

      // query param lang=en
      const resQuery = await makeUploadRequest(formData, { query: "lang=en" })
      const bodyQuery = (await resQuery.json()) as {
        error: { code: string; message: string }
      }
      expect(bodyQuery.error.message).toContain("Upload file is required")
    })
  })

  describe("Rate limiting (5 requests per IP per minute)", () => {
    it("allows up to 5 uploads per minute and blocks the 6th with 429", async () => {
      const ip = "192.168.1.100"

      for (let i = 0; i < 5; i++) {
        const formData = new FormData()
        formData.append(
          "file",
          new Blob([PNG_BYTES], { type: "image/png" }),
          `test-${i}.png`
        )
        const res = await makeUploadRequest(formData, {
          headers: { "CF-Connecting-IP": ip }
        })
        expect(res.status).toBe(200)
      }

      // 第 6 次超过限额
      const formData6 = new FormData()
      formData6.append(
        "file",
        new Blob([PNG_BYTES], { type: "image/png" }),
        "test-6.png"
      )
      const res6 = await makeUploadRequest(formData6, {
        headers: { "CF-Connecting-IP": ip }
      })
      expect(res6.status).toBe(429)
      const body6 = (await res6.json()) as {
        error: { code: string; message: string; retryAfter?: number }
      }
      expect(body6.error.code).toBe("RATE_LIMITED")
      expect(body6.error.retryAfter).toBeGreaterThanOrEqual(1)

      // 另一个 IP 不受影响
      const formDataOther = new FormData()
      formDataOther.append(
        "file",
        new Blob([PNG_BYTES], { type: "image/png" }),
        "other.png"
      )
      const resOther = await makeUploadRequest(formDataOther, {
        headers: { "CF-Connecting-IP": "192.168.1.101" }
      })
      expect(resOther.status).toBe(200)
    })

    it("enforces daily quota of 50 uploads per IP and blocks the 51st with 429", async () => {
      const ip = "192.168.2.1"
      const prefix = activePrefix(ctx.env)
      const now = Math.floor(Date.now() / 1000)

      // 预先写入 50 次每日计数
      for (let i = 0; i < 50; i++) {
        await consumeCounter(
          ctx.db,
          prefix,
          { action: "upload_image_daily", ip, windowSeconds: 86400 },
          now
        )
      }

      // 发起第 51 次上传，应被每日配额拦截 429
      const formData = new FormData()
      formData.append(
        "file",
        new Blob([PNG_BYTES], { type: "image/png" }),
        "test-daily.png"
      )
      const res = await makeUploadRequest(formData, {
        headers: { "CF-Connecting-IP": ip }
      })
      expect(res.status).toBe(429)
      const body = (await res.json()) as {
        error: { code: string; message: string; retryAfter?: number }
      }
      expect(body.error.code).toBe("RATE_LIMITED")
      expect(body.error.retryAfter).toBeGreaterThanOrEqual(1)

      // 另一个 IP 不受该 IP 每日配额影响
      const otherIp = "192.168.2.2"
      const formDataOther = new FormData()
      formDataOther.append(
        "file",
        new Blob([PNG_BYTES], { type: "image/png" }),
        "test-other.png"
      )
      const resOther = await makeUploadRequest(formDataOther, {
        headers: { "CF-Connecting-IP": otherIp }
      })
      expect(resOther.status).toBe(200)
    })

    it("resets daily quota after 86400 seconds", async () => {
      const ip = "192.168.2.10"
      const prefix = activePrefix(ctx.env)
      const pastTime = Math.floor(Date.now() / 1000) - 86401

      // 在过去的窗口（已过 24h）预设 50 次计数
      for (let i = 0; i < 50; i++) {
        await consumeCounter(
          ctx.db,
          prefix,
          { action: "upload_image_daily", ip, windowSeconds: 86400 },
          pastTime
        )
      }

      // 新的一天，上传成功
      const formData = new FormData()
      formData.append(
        "file",
        new Blob([PNG_BYTES], { type: "image/png" }),
        "test-reset.png"
      )
      const res = await makeUploadRequest(formData, {
        headers: { "CF-Connecting-IP": ip }
      })
      expect(res.status).toBe(200)
    })

    it("minute-rate-limited requests do not increment daily quota counter", async () => {
      const ip = "192.168.2.20"
      const prefix = activePrefix(ctx.env)

      // 同一分钟内成功发送 5 次
      for (let i = 0; i < 5; i++) {
        const formData = new FormData()
        formData.append(
          "file",
          new Blob([PNG_BYTES], { type: "image/png" }),
          `test-${i}.png`
        )
        const res = await makeUploadRequest(formData, {
          headers: { "CF-Connecting-IP": ip }
        })
        expect(res.status).toBe(200)
      }

      // 第 6 次触发分钟频控 429
      const formData6 = new FormData()
      formData6.append(
        "file",
        new Blob([PNG_BYTES], { type: "image/png" }),
        "test-6.png"
      )
      const res6 = await makeUploadRequest(formData6, {
        headers: { "CF-Connecting-IP": ip }
      })
      expect(res6.status).toBe(429)

      // 每日计数器应仍为 5，未被第 6 次冲刷
      const dailyCounter = await readCounter(ctx.db, prefix, {
        action: "upload_image_daily",
        ip
      })
      expect(dailyCounter?.count).toBe(5)
    })
  })

  describe("Referer anti-hotlinking for /img/*", () => {
    it("validates Referer host correctly in helper function", () => {
      expect(isAllowedReferer(undefined)).toBe(true)
      expect(isAllowedReferer(null)).toBe(true)
      expect(isAllowedReferer("")).toBe(true)
      expect(isAllowedReferer("   ")).toBe(true)
      expect(isAllowedReferer("https://oneboy.app")).toBe(true)
      expect(isAllowedReferer("https://oneboy.app/")).toBe(true)
      expect(isAllowedReferer("https://oneboy.app/blog/post-1")).toBe(true)
      expect(isAllowedReferer("http://oneboy.app:8080/foo")).toBe(true)
      expect(isAllowedReferer("https://blog.oneboy.app")).toBe(true)
      expect(isAllowedReferer("https://admin.oneboy.app/dashboard")).toBe(true)
      expect(isAllowedReferer("https://sub.sub2.oneboy.app")).toBe(true)
      expect(isAllowedReferer("https://ONEBOY.APP/path")).toBe(true)
      expect(isAllowedReferer("https://Blog.OneBoy.App/path")).toBe(true)
      expect(isAllowedReferer("https://oneboy.app.")).toBe(true)
      expect(isAllowedReferer("https://other.com")).toBe(false)
      expect(isAllowedReferer("https://notoneboy.app")).toBe(false)
      expect(isAllowedReferer("https://evil-oneboy.app")).toBe(false)
      expect(isAllowedReferer("https://oneboy.app.evil.com")).toBe(false)
      expect(isAllowedReferer("https://evil.com?ref=oneboy.app")).toBe(false)
      expect(isAllowedReferer("javascript:alert(1)")).toBe(false)
      expect(isAllowedReferer("not-a-url")).toBe(false)
      expect(isAllowedReferer("http://.oneboy.app")).toBe(false)
    })

    it("allows /img/* access when Referer is absent, empty, or from oneboy.app/*.oneboy.app", async () => {
      // 先上传一张图片获取 URL
      const formData = new FormData()
      formData.append(
        "file",
        new Blob([PNG_BYTES], { type: "image/png" }),
        "hotlink-test.png"
      )
      const uploadRes = await makeUploadRequest(formData)
      expect(uploadRes.status).toBe(200)
      const { data } = (await uploadRes.json()) as { data: { url: string } }
      const imgUrl = data.url

      // 1. 无 Referer 头放行
      const resNoRef = await request(ctx.env, imgUrl)
      expect(resNoRef.status).toBe(200)
      expect(resNoRef.headers.get("Cache-Control")).toBe(
        "public, max-age=31536000, immutable"
      )
      expect(resNoRef.headers.get("Content-Type")).toBe("image/png")

      // 2. 空 Referer 放行
      const resEmptyRef = await request(ctx.env, imgUrl, {
        headers: { Referer: "" }
      })
      expect(resEmptyRef.status).toBe(200)

      // 3. 本站 oneboy.app 放行
      const resMainHost = await request(ctx.env, imgUrl, {
        headers: { Referer: "https://oneboy.app/posts/hello" }
      })
      expect(resMainHost.status).toBe(200)

      // 4. 子域 blog.oneboy.app 放行
      const resSubBlog = await request(ctx.env, imgUrl, {
        headers: { Referer: "https://blog.oneboy.app/articles/1" }
      })
      expect(resSubBlog.status).toBe(200)

      // 5. 后台 admin.oneboy.app 放行
      const resSubAdmin = await request(ctx.env, imgUrl, {
        headers: { Referer: "https://admin.oneboy.app/manage/comments" }
      })
      expect(resSubAdmin.status).toBe(200)

      // 6. 带自定义端口放行
      const resPort = await request(ctx.env, imgUrl, {
        headers: { Referer: "http://oneboy.app:8080/test" }
      })
      expect(resPort.status).toBe(200)
    })

    it("blocks /img/* with 403 Forbidden when Referer is from unauthorized domain or malformed", async () => {
      const formData = new FormData()
      formData.append(
        "file",
        new Blob([PNG_BYTES], { type: "image/png" }),
        "block-test.png"
      )
      const uploadRes = await makeUploadRequest(formData)
      expect(uploadRes.status).toBe(200)
      const { data } = (await uploadRes.json()) as { data: { url: string } }
      const imgUrl = data.url

      // 外站盗链 403
      const resOther = await request(ctx.env, imgUrl, {
        headers: { Referer: "https://evil.com/page" }
      })
      expect(resOther.status).toBe(403)
      expect(await resOther.text()).toBe("Forbidden")

      // 仿冒前缀 403
      const resPrefix = await request(ctx.env, imgUrl, {
        headers: { Referer: "https://evil-oneboy.app/page" }
      })
      expect(resPrefix.status).toBe(403)

      // 仿冒后缀 403
      const resSuffix = await request(ctx.env, imgUrl, {
        headers: { Referer: "https://oneboy.app.evil.com/page" }
      })
      expect(resSuffix.status).toBe(403)

      // 畸形 Referer 403
      const resMalformed = await request(ctx.env, imgUrl, {
        headers: { Referer: "not-a-valid-url" }
      })
      expect(resMalformed.status).toBe(403)
    })

    it("preserves ETag / 304 behavior with valid Referer and blocks with 403 on invalid Referer even with If-None-Match", async () => {
      const formData = new FormData()
      formData.append(
        "file",
        new Blob([PNG_BYTES], { type: "image/png" }),
        "etag-test.png"
      )
      const uploadRes = await makeUploadRequest(formData)
      const { data } = (await uploadRes.json()) as { data: { url: string } }
      const imgUrl = data.url

      // 先拿 ETag
      const res = await request(ctx.env, imgUrl, {
        headers: { Referer: "https://oneboy.app" }
      })
      expect(res.status).toBe(200)
      const etag = res.headers.get("ETag")
      expect(etag).toBeTruthy()

      // 合法 Referer + If-None-Match 命中 304
      const res304 = await request(ctx.env, imgUrl, {
        headers: {
          Referer: "https://blog.oneboy.app",
          "If-None-Match": etag!
        }
      })
      expect(res304.status).toBe(304)
      expect(res304.headers.get("ETag")).toBe(etag)
      expect(res304.headers.get("Cache-Control")).toBe(
        "public, max-age=31536000, immutable"
      )

      // 非法 Referer 即使带正确 ETag 也直接 403，不泄露 304 或图片
      const resForbidden = await request(ctx.env, imgUrl, {
        headers: {
          Referer: "https://thief.com",
          "If-None-Match": etag!
        }
      })
      expect(resForbidden.status).toBe(403)
    })
  })

  describe("Authentication & Turnstile verification", () => {
    it("guest upload requires Turnstile token when enabled", async () => {
      await writeCalineSettings(ctx.env, {
        turnstileEnabled: true,
        turnstileSecretKey: "mock-secret-key"
      })

      // 访客未提供 token
      const fdNoToken = new FormData()
      fdNoToken.append(
        "file",
        new Blob([PNG_BYTES], { type: "image/png" }),
        "test.png"
      )
      const resNoToken = await makeUploadRequest(fdNoToken)
      expect(resNoToken.status).toBe(403)
      const bodyNoToken = (await resNoToken.json()) as {
        error: { code: string }
      }
      expect(bodyNoToken.error.code).toBe("TURNSTILE_REQUIRED")

      // 访客提供无效 token
      vi.spyOn(globalThis, "fetch").mockImplementation(
        async (input: RequestInfo | URL) => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url
          if (url.includes("challenges.cloudflare.com")) {
            return new Response(JSON.stringify({ success: false }), {
              status: 200
            })
          }
          return new Response("Not Found", { status: 404 })
        }
      )

      const fdBadToken = new FormData()
      fdBadToken.append(
        "file",
        new Blob([PNG_BYTES], { type: "image/png" }),
        "test.png"
      )
      fdBadToken.append("turnstileToken", "invalid-token")
      const resBadToken = await makeUploadRequest(fdBadToken)
      expect(resBadToken.status).toBe(403)
      const bodyBadToken = (await resBadToken.json()) as {
        error: { code: string }
      }
      expect(bodyBadToken.error.code).toBe("TURNSTILE_FAILED")

      // 访客提供有效 token
      vi.spyOn(globalThis, "fetch").mockImplementation(
        async (input: RequestInfo | URL) => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url
          if (url.includes("challenges.cloudflare.com")) {
            return new Response(JSON.stringify({ success: true }), {
              status: 200
            })
          }
          return new Response("Not Found", { status: 404 })
        }
      )

      const fdGoodToken = new FormData()
      fdGoodToken.append(
        "file",
        new Blob([PNG_BYTES], { type: "image/png" }),
        "test.png"
      )
      fdGoodToken.append("turnstileToken", "valid-token")
      const resGoodToken = await makeUploadRequest(fdGoodToken)
      expect(resGoodToken.status).toBe(200)
    })

    it("logged-in user bypasses Turnstile check even when Turnstile is enabled", async () => {
      await writeCalineSettings(ctx.env, {
        turnstileEnabled: true,
        turnstileSecretKey: "mock-secret-key"
      })

      // 种入登录会话
      const session = await seedSession(ctx.db, activePrefix(ctx.env), {
        role: "user",
        status: "active"
      })

      const formData = new FormData()
      formData.append(
        "file",
        new Blob([PNG_BYTES], { type: "image/png" }),
        "user-test.png"
      )
      // 不传 turnstileToken
      const res = await makeUploadRequest(formData, {
        cookie: session.cookie
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { url: string } }
      expect(body.data.url).toBeDefined()
    })

    it("returns 500 when Turnstile is enabled but secret key is missing", async () => {
      await writeCalineSettings(ctx.env, {
        turnstileEnabled: true,
        turnstileSecretKey: ""
      })

      const formData = new FormData()
      formData.append(
        "file",
        new Blob([PNG_BYTES], { type: "image/png" }),
        "test.png"
      )
      formData.append("turnstileToken", "some-token")

      const res = await makeUploadRequest(formData)
      expect(res.status).toBe(500)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe("TURNSTILE_NOT_CONFIGURED")
    })
  })
})
