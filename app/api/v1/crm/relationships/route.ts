import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  createBusinessRelationship,
  listBusinessRelationships,
  updateBusinessRelationship,
} from '@/lib/business-relationships/store'
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

function paramsFromUrl(url: string) {
  const searchParams = new URL(url).searchParams
  return {
    companyId: searchParams.get('companyId') ?? undefined,
    targetOrgId: searchParams.get('targetOrgId') ?? undefined,
    status: searchParams.get('status') as never,
    capability: searchParams.get('capability') as never,
    limit: Number(searchParams.get('limit') ?? 100),
  }
}

export const GET = withCrmAuth('viewer', async (req, ctx) => {
  let relationships = await listBusinessRelationships(ctx.orgId, paramsFromUrl(req.url))
  if (!isCrmPrivilegedActor(ctx)) {
    const rows = relationships.map((row) => ({ ...row, orgId: ctx.orgId }) as AssignableCrmRecord)
    const companyIds = new Set<string>()
    const contactIds = new Set<string>()
    for (const row of rows) {
      for (const id of crmRecordCompanyIds(row)) companyIds.add(id)
      for (const id of crmRecordContactIds(row)) contactIds.add(id)
    }
    const [companies, contacts] = await Promise.all([
      loadCompanyAssignmentMap(ctx.orgId, companyIds),
      loadContactAssignmentMap(ctx.orgId, contactIds),
    ])
    const allowedIds = new Set(
      filterCrmRowsForActor(ctx, rows, { companies, contacts }).map((row) => row.id).filter(Boolean),
    )
    relationships = relationships.filter((row) => allowedIds.has(row.id))
  }
  return apiSuccess({ relationships })
})

export const POST = withCrmAuth('admin', async (req, ctx) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
  try {
    const relationship = await createBusinessRelationship(ctx.orgId, body as Record<string, unknown>, ctx.actor)
    return apiSuccess({ relationship }, 201)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create relationship'
    // Activation attempts on generic metadata fail closed (400) rather than
    // silently creating an approved, portal-visible collaboration row.
    return apiError(message, 400)
  }
})

export const PATCH = withCrmAuth('admin', async (req, ctx) => {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return apiError('id is required', 400)
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
  const relationship = await updateBusinessRelationship(ctx.orgId, id, body as Record<string, unknown>, ctx.actor)
  return apiSuccess({ relationship })
})
