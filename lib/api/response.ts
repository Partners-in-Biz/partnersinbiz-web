import { NextResponse } from 'next/server'
import type { ApiMeta, ApiResponse } from './types'

export function apiSuccess<T>(
  data: T,
  status = 200,
  meta?: ApiMeta,
): NextResponse<ApiResponse<T>> {
  const body: ApiResponse<T> = { success: true, data }
  if (meta) body.meta = meta
  return NextResponse.json(body, { status })
}

export function apiError(
  error: string,
  status = 400,
  extra?: Record<string, unknown>,
): NextResponse<ApiResponse<never>> {
  const body: ApiResponse<never> & Record<string, unknown> = { success: false, error }
  if (extra) Object.assign(body, extra)
  return NextResponse.json(body, { status })
}

/**
 * Translate a caught error into an apiError response.
 *
 * Special-cases Firestore "FAILED_PRECONDITION" (missing composite index) in
 * development so the console URL gets surfaced directly to the client instead
 * of buried in server logs. In production we return a generic 500 to avoid
 * leaking project internals.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apiErrorFromException(err: any): NextResponse<ApiResponse<never>> {
  const isDev = process.env.NODE_ENV !== 'production'
  const message: string = (err?.message ?? String(err)) || 'Internal Server Error'
  const code: string | number | undefined = err?.code
  const status: number | undefined = typeof err?.status === 'number' ? err.status : undefined
  if (status && status >= 400 && status < 600) return apiError(message, status)

  // Firestore missing composite index
  const isMissingIndex =
    code === 9 || // gRPC FAILED_PRECONDITION
    code === 'failed-precondition' ||
    /requires an index/i.test(message)

  if (isMissingIndex) {
    const urlMatch = message.match(/https?:\/\/console\.firebase\.google\.com\S+/)
    console.error('[firestore-missing-index]', message)
    if (isDev) {
      return apiError(
        'Firestore query requires a composite index. Create it, then retry.',
        500,
        { indexConsoleUrl: urlMatch?.[0], firestoreError: message },
      )
    }
  }

  console.error('[api-error]', err)
  return apiError(isDev ? message : 'Internal Server Error', 500)
}
