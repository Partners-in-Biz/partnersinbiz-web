import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { createAutomation, listAutomations } from '@/lib/communications/store'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)
  return apiSuccess(await listAutomations(scope.orgId))
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
  const scope = resolveOrgScope(user, typeof body.orgId === 'string' ? body.orgId.trim() : null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  if (typeof body.name !== 'string' || !body.name.trim()) return apiError('name is required', 400)
  const result = await createAutomation(scope.orgId, {
    name: body.name,
    status: body.status ?? 'draft',
    priority: typeof body.priority === 'number' ? body.priority : 100,
    channels: Array.isArray(body.channels) ? body.channels : undefined,
    conditions: Array.isArray(body.conditions) ? body.conditions : [],
    actions: Array.isArray(body.actions) ? body.actions : [],
  })
  return apiSuccess(result, 201)
})
