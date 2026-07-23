import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import { createInventoryItem, listInventoryItems, updateInventoryItem } from '@/lib/commerce/store'
import { guardAgentCrmAction } from '@/lib/agents/action-guard'
import {
  type AssignableCrmRecord,
  crmRecordCompanyIds,
  crmRecordContactIds,
  filterCrmRowsForActor,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
  loadContactAssignmentMap,
} from '@/lib/crm/assignment-access'

export const dynamic = 'force-dynamic'

function listParams(url: string) {
  const searchParams = new URL(url).searchParams
  return {
    companyId: searchParams.get('companyId') ?? undefined,
    serviceWorkspaceId: searchParams.get('serviceWorkspaceId') ?? undefined,
    projectId: searchParams.get('projectId') ?? undefined,
    status: searchParams.get('status') ?? undefined,
    limit: Number(searchParams.get('limit') ?? 100),
  }
}

export const GET = withCrmAuth('viewer', async (req, ctx) => {
  let inventoryItems = await listInventoryItems(ctx.orgId, listParams(req.url))
  if (!isCrmPrivilegedActor(ctx)) {
    const companyIds = new Set<string>()
    const contactIds = new Set<string>()
    for (const item of inventoryItems as AssignableCrmRecord[]) {
      for (const id of crmRecordCompanyIds(item)) companyIds.add(id)
      for (const id of crmRecordContactIds(item)) contactIds.add(id)
    }
    const [companies, contacts] = await Promise.all([
      loadCompanyAssignmentMap(ctx.orgId, companyIds),
      loadContactAssignmentMap(ctx.orgId, contactIds),
    ])
    inventoryItems = filterCrmRowsForActor(ctx, inventoryItems as AssignableCrmRecord[], { companies, contacts }) as typeof inventoryItems
  }
  return apiSuccess({ inventoryItems })
})

export const POST = withCrmAuth('member', async (req, ctx) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
  const guard = guardAgentCrmAction(ctx, {
    action: 'client_visible',
    visibility: typeof (body as Record<string, unknown>).visibility === 'string' ? (body as Record<string, unknown>).visibility as string : undefined,
    approvalState: typeof (body as Record<string, unknown>).approvalState === 'string' ? (body as Record<string, unknown>).approvalState as string : undefined,
  })
  if (!guard.allowed) return apiSuccess({ approvalRequired: true, reason: guard.reason }, 202)
  return apiSuccess({ inventoryItem: await createInventoryItem(ctx.orgId, body as Record<string, unknown>, ctx.actor) }, 201)
})

export const PATCH = withCrmAuth('member', async (req, ctx) => {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return apiError('id is required', 400)
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
  const guard = guardAgentCrmAction(ctx, {
    action: 'client_visible',
    visibility: typeof (body as Record<string, unknown>).visibility === 'string' ? (body as Record<string, unknown>).visibility as string : undefined,
    approvalState: typeof (body as Record<string, unknown>).approvalState === 'string' ? (body as Record<string, unknown>).approvalState as string : undefined,
  })
  if (!guard.allowed) return apiSuccess({ approvalRequired: true, reason: guard.reason }, 202)
  return apiSuccess({ inventoryItem: await updateInventoryItem(ctx.orgId, id, body as Record<string, unknown>, ctx.actor) })
})
