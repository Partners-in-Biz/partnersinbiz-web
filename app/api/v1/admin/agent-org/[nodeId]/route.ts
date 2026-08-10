/**
 * PATCH  /api/v1/admin/agent-org/:nodeId
 * DELETE /api/v1/admin/agent-org/:nodeId?orgId=...&force=true
 * Auth: admin.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { patchOrgChartNode, removeOrgChartNode } from '@/lib/agent-org/handlers'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ nodeId: string }> }

export const PATCH = withAuth('admin', async (req: NextRequest, user, ctx: RouteCtx) => {
  const { nodeId } = await ctx.params

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const requestedOrgId = typeof body.orgId === 'string' && body.orgId.trim() ? body.orgId.trim() : null
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const result = await patchOrgChartNode(scope.orgId, nodeId, body)
  if (!result.ok) return apiError(result.error, result.status)
  return apiSuccess({ node: result.node, tree: result.tree })
})

export const DELETE = withAuth('admin', async (req: NextRequest, user, ctx: RouteCtx) => {
  const { nodeId } = await ctx.params
  const requestedOrgId = req.nextUrl.searchParams.get('orgId')
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const force = req.nextUrl.searchParams.get('force') === 'true'
  const result = await removeOrgChartNode(scope.orgId, nodeId, force)
  if (!result.ok) return apiError(result.error, result.status)
  return apiSuccess({ deleted: true })
})
