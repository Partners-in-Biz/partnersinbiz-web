/**
 * PATCH  /api/v1/portal/settings/agents/org-chart/:nodeId
 * DELETE /api/v1/portal/settings/agents/org-chart/:nodeId?force=true
 */
import { NextRequest } from 'next/server'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import { patchOrgChartNode, removeOrgChartNode } from '@/lib/agent-org/handlers'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ nodeId: string }> }

export const PATCH = withPortalAuthAndRole('admin', async (req: NextRequest, _uid, orgId, _role, ctx: Ctx) => {
  const { nodeId } = await ctx.params
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Invalid JSON body', 400)
  }
  const result = await patchOrgChartNode(orgId, nodeId, { ...body, orgId })
  if (!result.ok) return apiError(result.error, result.status)
  return apiSuccess({ orgId, node: result.node, tree: result.tree })
})

export const DELETE = withPortalAuthAndRole('admin', async (req: NextRequest, _uid, orgId, _role, ctx: Ctx) => {
  const { nodeId } = await ctx.params
  const force = req.nextUrl.searchParams.get('force') === 'true'
  const result = await removeOrgChartNode(orgId, nodeId, force)
  if (!result.ok) return apiError(result.error, result.status)
  return apiSuccess({ orgId, deleted: true })
})
