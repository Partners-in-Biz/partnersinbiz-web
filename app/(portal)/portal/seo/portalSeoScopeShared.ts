// Client-safe SEO scope helpers (no next/headers or firebase-admin imports).
// Server-only helpers live in ./portalSeoScope.ts which re-exports these.
import { scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'

export type PortalSeoSearchParams = {
  orgId?: string
  orgSlug?: string
  sprintId?: string
  sourceCompanyId?: string
  companyId?: string
}

export type PortalSeoScope = {
  orgId?: string
  orgSlug?: string
  sourceCompanyId?: string
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function scopeFromSearchParams(params?: PortalSeoSearchParams): PortalSeoScope {
  const sourceCompanyId = cleanString(params?.sourceCompanyId) || cleanString(params?.companyId) || undefined
  return {
    orgId: cleanString(params?.orgId) || undefined,
    orgSlug: cleanString(params?.orgSlug) || undefined,
    ...(sourceCompanyId ? { sourceCompanyId } : {}),
  }
}

export function scopedPortalHref(path: string, scope: PortalSeoScope): string {
  return scopedPortalPath(path, scope as PortalOrgRouteScope)
}
