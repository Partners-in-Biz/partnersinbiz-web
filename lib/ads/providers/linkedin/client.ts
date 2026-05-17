import { LINKEDIN_ADS_API_BASE, LINKEDIN_ADS_VERSION } from './constants'

export interface LinkedinAdsClient {
  get<T = unknown>(path: string, init?: RequestInit): Promise<T>
  post<T = unknown>(path: string, body: unknown, init?: RequestInit): Promise<T>
  patch<T = unknown>(path: string, body: unknown, init?: RequestInit): Promise<T>
  delete<T = unknown>(path: string, init?: RequestInit): Promise<T>
}

export interface LinkedinAdsClientInput {
  accessToken: string
  /** Override the LinkedIn-Version header (default: pinned version) */
  version?: string
  /** Override base URL — useful for tests */
  baseUrl?: string
}

export class LinkedinAdsApiError extends Error {
  constructor(message: string, public status: number, public body?: string) {
    super(message)
    this.name = 'LinkedinAdsApiError'
  }
}

function buildHeaders(input: LinkedinAdsClientInput): Record<string, string> {
  return {
    Authorization: `Bearer ${input.accessToken}`,
    'LinkedIn-Version': input.version ?? LINKEDIN_ADS_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type': 'application/json',
  }
}

/** Build an authenticated LinkedIn ads client.
 *  Adds Authorization, LinkedIn-Version, and X-Restli-Protocol-Version headers to every request. */
export function createLinkedinAdsClient(input: LinkedinAdsClientInput): LinkedinAdsClient {
  const baseUrl = (input.baseUrl ?? LINKEDIN_ADS_API_BASE).replace(/\/$/, '')

  async function call<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, init?: RequestInit): Promise<T> {
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
    const headers: Record<string, string> = {
      ...buildHeaders(input),
      ...(init?.headers as Record<string, string> | undefined),
    }
    const res = await fetch(url, {
      ...init,
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : init?.body,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new LinkedinAdsApiError(`LinkedIn Ads API ${method} ${path} failed: HTTP ${res.status} — ${text}`, res.status, text)
    }
    // Some DELETE responses are 204 No Content
    if (res.status === 204) return undefined as T
    const txt = await res.text()
    if (!txt) return undefined as T
    return JSON.parse(txt) as T
  }

  return {
    get<T = unknown>(path: string, init?: RequestInit) { return call<T>('GET', path, undefined, init) },
    post<T = unknown>(path: string, body: unknown, init?: RequestInit) { return call<T>('POST', path, body, init) },
    patch<T = unknown>(path: string, body: unknown, init?: RequestInit) { return call<T>('PATCH', path, body, init) },
    delete<T = unknown>(path: string, init?: RequestInit) { return call<T>('DELETE', path, undefined, init) },
  }
}
