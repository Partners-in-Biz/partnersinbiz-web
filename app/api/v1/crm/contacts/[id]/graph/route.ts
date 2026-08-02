/**
 * GET /api/v1/crm/contacts/[id]/graph
 * Graph-safe neighbour expansion for Hermes CRM tools.
 * Always returns neighbour IDs the system already knows.
 *
 * Auth: member+
 */
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { loadAccessibleFactContact, loadContactGraph } from '@/lib/crm/facts'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

export const GET = withCrmAuth<RouteCtx>('member', async (req, ctx, routeCtx) => {
  const { id: contactId } = await routeCtx!.params
  if (!contactId) return apiError('Contact ID is required', 400)

  const access = await loadAccessibleFactContact(ctx, contactId)
  if (!access.ok) return access.res

  const url = new URL(req.url)
  const graph = await loadContactGraph({
    orgId: ctx.orgId,
    contactId,
    includeFacts: url.searchParams.get('includeFacts') !== 'false',
    includeResearchTasks: url.searchParams.get('includeResearchTasks') === 'true',
    activityLimit: Number(url.searchParams.get('activityLimit') || '10'),
    dealLimit: Number(url.searchParams.get('dealLimit') || '25'),
  })

  if (!graph) return apiError('Contact not found', 404)
  return apiSuccess({ graph })
})
