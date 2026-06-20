import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { listCreativeCanvasSourceLibrary } from '@/lib/creative-canvas/source-library'

export const dynamic = 'force-dynamic'

function resolveOrgId(req: NextRequest, user: ApiUser): string | null {
  const url = new URL(req.url)
  return url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.activeOrgId ?? user.orgId ?? user.orgIds?.[0] ?? null
}

function canAccessOrg(user: ApiUser, orgId: string): boolean {
  if (user.role === 'admin') {
    const allowed = user.allowedOrgIds ?? []
    return allowed.length === 0 || allowed.includes(orgId) || user.orgId === orgId
  }
  const orgIds = user.orgIds?.length ? user.orgIds : (user.orgId ? [user.orgId] : [])
  return orgIds.includes(orgId)
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  if (!canAccessOrg(user, orgId)) return apiError('You do not have access to this organisation', 403)

  const url = new URL(req.url)
  const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10)
  const sources = await listCreativeCanvasSourceLibrary({
    orgId,
    query: url.searchParams.get('q'),
    sourceKind: url.searchParams.get('sourceKind'),
    referenceRole: url.searchParams.get('referenceRole'),
    mediaType: url.searchParams.get('mediaType'),
    limit: Number.isFinite(limit) ? limit : 50,
  })

  return apiSuccess({ sources, lookup: { orgId } })
})
