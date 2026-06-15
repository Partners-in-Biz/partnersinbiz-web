import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  createResearchSource,
  getResearchItem,
  listResearchSources,
} from '@/lib/research/store'
import { assertUserCanPerformOrganizationModuleAction } from '@/lib/organizations/module-policy-access'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function assertAccess(id: string, user: ApiUser) {
  const item = await getResearchItem(id)
  if (!item) return { ok: false as const, response: apiError('Research item not found', 404) }
  const scope = resolveOrgScope(user, item.orgId)
  if (!scope.ok) return { ok: false as const, response: apiError(scope.error, scope.status) }
  return { ok: true as const, item }
}

export const GET = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await assertAccess(id, user)
  if (!access.ok) return access.response
  return apiSuccess(await listResearchSources(id))
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await assertAccess(id, user)
  if (!access.ok) return access.response
  const sourceAccess = await assertUserCanPerformOrganizationModuleAction(
    user,
    access.item.orgId,
    'research',
    'evidenceSources',
    'Research source changes are disabled for your organisation role',
  )
  if (!sourceAccess.ok) return apiError(sourceAccess.error, sourceAccess.status)
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return apiError('title is required', 400)

  const created = await createResearchSource(id, { ...body, title }, user)
  return apiSuccess(created, 201)
})
