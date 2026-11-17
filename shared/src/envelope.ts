/**
 * 统一 API 响应信封（规格 §4）。
 *
 * 约定：
 * - 成功：`{ data: T }`
 * - 失败：`{ error: { code, message, retryAfter?, details? } }`
 */

export interface ApiSuccess<T> {
  data: T
}

export interface ApiErrorDetail {
  code: string
  message: string
  retryAfter?: number
  details?: unknown
}

export interface ApiErrorResponse {
  error: ApiErrorDetail
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorResponse

/** 类型守卫：判断是否为业务成功响应 */
export function isApiSuccess<T>(res: ApiResponse<T>): res is ApiSuccess<T> {
  return (
    typeof res === "object" &&
    res !== null &&
    "data" in res &&
    !("error" in res)
  )
}

/** 类型守卫：判断是否为业务错误响应 */
export function isApiErrorResponse(res: unknown): res is ApiErrorResponse {
  return (
    typeof res === "object" &&
    res !== null &&
    "error" in res &&
    typeof (res as ApiErrorResponse).error === "object" &&
    (res as ApiErrorResponse).error !== null &&
    typeof (res as ApiErrorResponse).error.code === "string" &&
    typeof (res as ApiErrorResponse).error.message === "string"
  )
}
