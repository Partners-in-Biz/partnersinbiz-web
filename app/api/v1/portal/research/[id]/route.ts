import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api/response'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { getResearchItem, listResearchSources } from '@/lib/research/store'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, _uid: string, orgId: string, _role, ctx: RouteContext) => {
  const { id } = await ctx.params
  const item = await getResearchItem(id, orgId)
  if (!item || item.visibility !== 'client_visible') return apiError('Research item not found', 404)
  const sources = await listResearchSources(id)
  return apiSuccess({ item, sources })
})
