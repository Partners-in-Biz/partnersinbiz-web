import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  archiveResearchSource,
  getResearchItem,
  updateResearchSource,
} from '@/lib/research/store'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; sourceId: string }> }

async function assertAccess(id: string, user: ApiUser) {
  const item = await getResearchItem(id)
  if (!item) return { ok: false as const, response: apiError('Research item not found', 404) }
  const scope = resolveOrgScope(user, item.orgId)
  if (!scope.ok) return { ok: false as const, response: apiError(scope.error, scope.status) }
  return { ok: true as const }
}

export const PATCH = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id, sourceId } = await ctx.params
  const access = await assertAccess(id, user)
  if (!access.ok) return access.response
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)
  await updateResearchSource(id, sourceId, body, user)
  return apiSuccess({ id: sourceId })
})

export const DELETE = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id, sourceId } = await ctx.params
  const access = await assertAccess(id, user)
  if (!access.ok) return access.response
  await archiveResearchSource(id, sourceId, user)
  return apiSuccess({ id: sourceId, deleted: true })
})
