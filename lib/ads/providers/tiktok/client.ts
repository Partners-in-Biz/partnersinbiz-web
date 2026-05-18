// lib/ads/providers/tiktok/client.ts
import { TIKTOK_ADS_API_BASE } from './constants'

export interface TiktokAdsClient {
  get<T = unknown>(path: string, query?: Record<string, string | number | undefined>): Promise<T>
  post<T = unknown>(path: string, body: unknown): Promise<T>
}

export interface TiktokAdsClientInput {
  accessToken: string
  baseUrl?: string
  fetchImpl?: typeof fetch
}

export class TiktokAdsApiError extends Error {
  constructor(message: string, public code: number, public httpStatus?: number) {
    super(message)
    this.name = 'TiktokAdsApiError'
  }
}

interface TiktokEnvelope<T> {
  code: number
  message: string
  data: T
  request_id?: string
}

/**
 * Builds a TikTok Marketing API client. Note: TikTok uses `Access-Token`
 * header (NOT `Authorization: Bearer`) and wraps every response in a
 * `{code, message, data}` envelope where `code: 0` means success.
 */
export function createTiktokAdsClient(input: TiktokAdsClientInput): TiktokAdsClient {
  const baseUrl = (input.baseUrl ?? TIKTOK_ADS_API_BASE).replace(/\/$/, '')
  const fetchImpl = input.fetchImpl ?? fetch

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, query?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`)
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v))
      }
    }

    const headers: Record<string, string> = {
      'Access-Token': input.accessToken,
      'Content-Type': 'application/json',
    }

    const res = await fetchImpl(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new TiktokAdsApiError(`TikTok API ${method} ${path} HTTP ${res.status} — ${text.slice(0, 200)}`, -1, res.status)
    }

    const env = (await res.json()) as TiktokEnvelope<T>
    if (env.code !== 0) {
      throw new TiktokAdsApiError(`TikTok API ${method} ${path} code=${env.code} message=${env.message}`, env.code, res.status)
    }

    return env.data
  }

  return {
    get<T = unknown>(path: string, query?: Record<string, string | number | undefined>) { return call<T>('GET', path, undefined, query) },
    post<T = unknown>(path: string, body: unknown) { return call<T>('POST', path, body) },
  }
}
