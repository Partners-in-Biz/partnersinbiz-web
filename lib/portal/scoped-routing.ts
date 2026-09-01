export type PortalOrgRouteScope = {
  orgId?: string | null
  orgSlug?: string | null
  id?: string | null
  slug?: string | null
  sourceCompanyId?: string | null
  sourceCompanyName?: string | null
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
    sourceCompanyId: cleanScopeValue(searchParams?.get('sourceCompanyId')) || undefined,
    sourceCompanyName: cleanScopeValue(searchParams?.get('sourceCompanyName')) || undefined,
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
    sourceCompanyId: cleanScopeValue(scope.sourceCompanyId),
    sourceCompanyName: cleanScopeValue(scope.sourceCompanyName),
  })
}

export function scopedApiPath(path: string, scope: Pick<PortalOrgRouteScope, 'orgId' | 'id' | 'sourceCompanyId'>): string {
  return appendQueryParams(path, {
    orgId: cleanScopeValue(scope.orgId) || cleanScopeValue(scope.id),
    companyId: cleanScopeValue(scope.sourceCompanyId),
  })
}

/**
 * Document-id APIs authorize from the document ACL, not the URL workspace.
 * Never attach ?orgId= — a staff deep-link (holder org) 403s recipients at
 * withAuth before the document access check can run.
 */
export function clientDocumentApiPath(documentId: string, suffix = ''): string {
  const id = encodeURIComponent(cleanScopeValue(documentId))
  const extra = !suffix ? '' : suffix.startsWith('/') ? suffix : `/${suffix}`
  return `/api/v1/client-documents/${id}${extra}`
}

// Selected-workspace inheritance for portal client surfaces.
//
// Explicit URL scope stays authoritative (tenant-safe). When the URL carries no
// orgId, portal pages inherit the user's active selected workspace so direct
// navigation (bookmarks, nav links, deep links) does not fail with "select an
// organisation workspace" even though the portal shell resolved the active org.
export function resolvePortalOrgScope(
  urlScope: PortalOrgRouteScope,
  activeOrgId: string,
): PortalOrgRouteScope {
  if (urlScope.orgId) return urlScope
  if (activeOrgId) return { ...urlScope, orgId: activeOrgId }
  return urlScope
}
