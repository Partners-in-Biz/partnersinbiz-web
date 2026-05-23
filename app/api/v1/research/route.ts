import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  createResearchItem,
  listResearchItems,
  validateResearchFilters,
} from '@/lib/research/store'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const scope = resolveOrgScope(user, req.nextUrl.searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)

  const filters = validateResearchFilters(req.nextUrl.searchParams)
  if (!filters.ok) return apiError(filters.error, 400)

  const items = await listResearchItems({ orgId: scope.orgId, ...filters.filters })
  return apiSuccess(items)
})

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)

  const requestedOrgId = typeof body.orgId === 'string' ? body.orgId.trim() : null
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return apiError('title is required', 400)

  try {
    const created = await createResearchItem({
      orgId: scope.orgId,
      title,
      kind: body.kind,
      status: body.status,
      visibility: body.visibility,
      summary: typeof body.summary === 'string' ? body.summary : '',
      notesMarkdown: typeof body.notesMarkdown === 'string' ? body.notesMarkdown : '',
      tags: Array.isArray(body.tags) ? body.tags : [],
      linked: body.linked,
      findings: Array.isArray(body.findings) ? body.findings : [],
      recommendations: Array.isArray(body.recommendations) ? body.recommendations : [],
      user,
    })
    return apiSuccess(created, 201)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Could not create research item', 400)
  }
})
