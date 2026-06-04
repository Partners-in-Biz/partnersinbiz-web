export type PortalOrgRouteScope = {
  orgId?: string | null
  orgSlug?: string | null
  id?: string | null
  slug?: string | null
}

type QueryValue = string | number | boolean | null | undefined

type SearchParamReader = {
  get(name: string): string | null
}

function cleanScopeValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function scopeFromSearchParams(searchParams?: SearchParamReader | null): PortalOrgRouteScope {
  return {
    orgId: cleanScopeValue(searchParams?.get('orgId')) || undefined,
    orgSlug: cleanScopeValue(searchParams?.get('orgSlug')) || undefined,
  }
}

export function appendQueryParams(path: string, params: Record<string, QueryValue>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue
    query.set(key, String(value))
  }
  const suffix = query.toString()
  if (!suffix) return path
  return `${path}${path.includes('?') ? '&' : '?'}${suffix}`
}

export function scopedPortalPath(path: string, scope: PortalOrgRouteScope): string {
  return appendQueryParams(path, {
    orgId: cleanScopeValue(scope.orgId) || cleanScopeValue(scope.id),
    orgSlug: cleanScopeValue(scope.orgSlug) || cleanScopeValue(scope.slug),
  })
}

export function scopedApiPath(path: string, scope: Pick<PortalOrgRouteScope, 'orgId' | 'id'>): string {
  return appendQueryParams(path, {
    orgId: cleanScopeValue(scope.orgId) || cleanScopeValue(scope.id),
  })
}
