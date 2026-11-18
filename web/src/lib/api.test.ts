import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi, ApiError, authApi, meApi } from "@/lib/api"
import { useAuthStore } from "@/stores/auth"
import { me } from "@/test/fixtures"

/**
 * 会话失效的兜底（规格 §6.1「私有接口未登录 401」）：私有接口 401 必须
 * 清掉本地用户态，让 RequireAuth 把人送回登录页；登录等公开鉴权端点
 * 自己的 401 是业务结果，不能顺手把已有会话清掉。
 */

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body)
  }
}

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => respond(status, body))
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.setState({ user: null, status: "loading" })
})

describe("401 处理", () => {
  it("私有接口 401 时清掉本地会话", async () => {
    useAuthStore.setState({ user: me(), status: "ready" })
    stubFetch(401, { error: "Unauthorized" })

    await expect(meApi.get()).rejects.toBeInstanceOf(ApiError)
    await vi.waitFor(() => {
      expect(useAuthStore.getState().user).toBeNull()
    })
  })

  it("登录失败的 401 不动已有用户态", async () => {
    useAuthStore.setState({ user: me(), status: "ready" })
    stubFetch(401, {
      error: "Invalid credentials",
      code: "INVALID_CREDENTIALS"
    })

    await expect(
      authApi.login({ email: "owner@example.com", password: "wrong" })
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" })
    await Promise.resolve()
    expect(useAuthStore.getState().user).not.toBeNull()
  })
})

describe("用户管理操作列端点", () => {
  /** 五个端点已在后端冻结：路径、方法与 role 请求体由这里锁住，防止前端漂移。 */
  function recordFetch() {
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({
          url,
          method: init.method ?? "GET",
          body: init.body
        })
        return respond(200, { success: true })
      })
    )
    return calls
  }

  it("重置密码 / 停用 / 启用 / 删除走 POST 且无请求体", async () => {
    const calls = recordFetch()

    await adminApi.resetUserPassword(7)
    await adminApi.disableUser(7)
    await adminApi.enableUser(7)
    await adminApi.deleteUser(7)

    expect(calls).toEqual([
      {
        url: "/api/admin/users/7/reset-password",
        method: "POST",
        body: undefined
      },
      { url: "/api/admin/users/7/disable", method: "POST", body: undefined },
      { url: "/api/admin/users/7/enable", method: "POST", body: undefined },
      { url: "/api/admin/users/7/delete", method: "POST", body: undefined }
    ])
  })

  it("变更角色把目标角色放进请求体", async () => {
    const calls = recordFetch()

    await adminApi.changeUserRole(7, { role: "admin" })

    expect(calls).toEqual([
      {
        url: "/api/admin/users/7/role",
        method: "POST",
        body: JSON.stringify({ role: "admin" })
      }
    ])
  })
})

describe("响应信封统一解包与错误契约（QA #7 缺陷②）", () => {
  it("成功响应自动解包 { data: T } 信封", async () => {
    stubFetch(200, {
      data: {
        items: [{ id: 1, contentRaw: "hello" }],
        total: 1,
        page: 1,
        pageSize: 10,
        totalPages: 1
      }
    })

    const result = await adminApi.comments()
    // 必须直接拿到解包后的 items 与 total，而不是 undefined
    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe(1)
    expect(result.total).toBe(1)
  })

  it("导出数据 exportData 正确剥开信封，避免备份多包一层 data", async () => {
    const rawDump = {
      version: "1.0.0",
      exportedAt: "2026-11-18T00:00:00.000Z",
      comments: [],
      counters: [],
      users: []
    }
    stubFetch(200, { data: rawDump })

    const dump = await adminApi.exportData()
    expect(dump).toEqual(rawDump)
    expect(dump).not.toHaveProperty("data")
  })

  it("解析统一错误信封 { error: { code, message, retryAfter, details } }", async () => {
    stubFetch(429, {
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests",
        retryAfter: 45
      }
    })

    let caught: ApiError | null = null
    try {
      await meApi.get()
    } catch (err) {
      if (err instanceof ApiError) caught = err
    }

    expect(caught).not.toBeNull()
    expect(caught?.status).toBe(429)
    expect(caught?.code).toBe("RATE_LIMITED")
    expect(caught?.message).toBe("Too many requests")
    expect(caught?.retryAfter).toBe(45)
  })

  it("兼容旧错误格式 { error: string, code: string }", async () => {
    stubFetch(400, {
      error: "Bad request message",
      code: "INVALID_PARAM"
    })

    let caught: ApiError | null = null
    try {
      await meApi.get()
    } catch (err) {
      if (err instanceof ApiError) caught = err
    }

    expect(caught).not.toBeNull()
    expect(caught?.status).toBe(400)
    expect(caught?.code).toBe("INVALID_PARAM")
    expect(caught?.message).toBe("Bad request message")
  })
})
