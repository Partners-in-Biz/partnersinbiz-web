/**
 * Shared client-side fetch helper for the platform-admin org detail surface.
 * Always unwraps the `{ success, data }` envelope and throws on failure so
 * callers get the inner data directly.
 */
export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin' })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.success) {
    throw new Error(body?.error || `Request failed (${res.status})`)
  }
  return (body.data ?? body) as T
}

export async function apiSend<T>(
  url: string,
  method: 'POST' | 'PUT' | 'DELETE',
  payload?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.success) {
    throw new Error(body?.error || `Request failed (${res.status})`)
  }
  return (body.data ?? body) as T
}

export function formatZar(amount: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(amount)
}

export function tsToDate(value: unknown): Date | null {
  if (!value) return null
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? new Date(ms) : null
  }
  if (typeof value === 'object') {
    const seconds = (value as { _seconds?: number; seconds?: number })._seconds
      ?? (value as { seconds?: number }).seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000)
  }
  return null
}

export function formatDate(value: unknown): string {
  const d = tsToDate(value)
  if (!d) return '—'
  return d.toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatDateTime(value: unknown): string {
  const d = tsToDate(value)
  if (!d) return '—'
  return d.toLocaleString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export interface OrgDetail {
  id: string
  slug: string
  name: string
  type: string
  status: string
  plan: string | null
  description: string
  website: string
  industry: string
  logoUrl: string
  billingEmail: string
  createdAt: unknown
  updatedAt: unknown
  owner: { uid: string; email: string; displayName: string } | null
  devMode: boolean
  featureFlags: Record<string, boolean>
  suspension: Record<string, unknown> | null
  adminBilling: Record<string, unknown> | null
  mrrZar: number
  metrics: {
    contacts: number
    emailSends30d: number
    socialAccounts: number
    projects: number
    campaigns: number
    teamSize: number
  }
}
