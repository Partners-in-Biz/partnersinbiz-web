import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  archiveResearchItem,
  getResearchItem,
  updateResearchItem,
} from '@/lib/research/store'
import { assertUserCanPerformOrganizationModuleAction } from '@/lib/organizations/module-policy-access'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function loadAccessibleResearch(id: string, user: ApiUser) {
  const item = await getResearchItem(id)
  if (!item) return { ok: false as const, response: apiError('Research item not found', 404) }
  const scope = resolveOrgScope(user, item.orgId)
  if (!scope.ok) return { ok: false as const, response: apiError(scope.error, scope.status) }
  return { ok: true as const, item }
}

export const GET = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const loaded = await loadAccessibleResearch(id, user)
  if (!loaded.ok) return loaded.response
  return apiSuccess(loaded.item)
})

export const PATCH = withAuth('client', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const loaded = await loadAccessibleResearch(id, user)
  if (!loaded.ok) return loaded.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)

  const actionId = body.visibility === 'client_visible' ? 'clientVisible' : 'edit'
  const editAccess = await assertUserCanPerformOrganizationModuleAction(
    user,
    loaded.item.orgId,
    'research',
    actionId,
    actionId === 'clientVisible'
      ? 'Client-visible research changes are disabled for your organisation role'
      : 'Research editing is disabled for your organisation role',
  )
  if (!editAccess.ok) return apiError(editAccess.error, editAccess.status)

  await updateResearchItem(id, body, user)
  return apiSuccess({ id })
})

export const DELETE = withAuth('client', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const loaded = await loadAccessibleResearch(id, user)
  if (!loaded.ok) return loaded.response
  const deleteAccess = await assertUserCanPerformOrganizationModuleAction(
    user,
    loaded.item.orgId,
    'research',
    'archiveDelete',
    'Research archive/delete is disabled for your organisation role',
  )
  if (!deleteAccess.ok) return apiError(deleteAccess.error, deleteAccess.status)

  await archiveResearchItem(id, user)
  return apiSuccess({ id, deleted: true })
})
