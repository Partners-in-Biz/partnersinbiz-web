/**
 * GET  /api/v1/admin/agent-org?orgId=...
 * POST /api/v1/admin/agent-org
 *
 * AgentOrgNode org-chart list + create. Auth: admin (ai/admin roles).
 * Every read/write is org-scoped via resolveOrgScope.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { createOrgChartNode, listOrgChart } from '@/lib/agent-org/handlers'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req: NextRequest, user) => {
  const orgId = req.nextUrl.searchParams.get('orgId')
  const scope = resolveOrgScope(user, orgId)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const result = await listOrgChart(scope.orgId)
  if (!result.ok) return apiError(result.error, result.status)
  return apiSuccess({ nodes: result.nodes, tree: result.tree })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const requestedOrgId = typeof body.orgId === 'string' && body.orgId.trim() ? body.orgId.trim() : null
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const result = await createOrgChartNode(scope.orgId, body)
  if (!result.ok) return apiError(result.error, result.status)
  return apiSuccess({ node: result.node }, 201)
})
