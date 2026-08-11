/**
 * GET  /api/v1/portal/settings/agents/org-chart
 * POST /api/v1/portal/settings/agents/org-chart
 *
 * Org-scoped agent org chart for portal organisation admins.
 * orgId is taken from the active portal workspace (optional ?orgId= override if allowed).
 */
import { NextRequest } from 'next/server'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import { createOrgChartNode, listOrgChart } from '@/lib/agent-org/handlers'

export const dynamic = 'force-dynamic'

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, _uid, orgId) => {
  const result = await listOrgChart(orgId)
  if (!result.ok) return apiError(result.error, result.status)
  return apiSuccess({ orgId, nodes: result.nodes, tree: result.tree })
})

export const POST = withPortalAuthAndRole('admin', async (req: NextRequest, _uid, orgId) => {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Invalid JSON body', 400)
  }
  // Never trust body.orgId for portal — workspace middleware already scoped.
  const result = await createOrgChartNode(orgId, { ...body, orgId })
  if (!result.ok) return apiError(result.error, result.status)
  return apiSuccess({ orgId, node: result.node }, 201)
})
