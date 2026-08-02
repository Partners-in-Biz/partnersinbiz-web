/**
 * GET  /api/v1/crm/contacts/[id]/facts — list contact facts (evidence ledger)
 * POST /api/v1/crm/contacts/[id]/facts — record a fact from observations (no model confidence)
 *
 * Auth: member+
 */
import { NextRequest } from 'next/server'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  EVIDENCE_KINDS,
  FACT_FIELDS,
  isEvidenceKind,
  isFactField,
  listContactFacts,
  loadAccessibleFactContact,
  recordContactFact,
  type Evidence,
  type FactStatus,
} from '@/lib/crm/facts'
import { safeTouchCrmLiveUpdate } from '@/lib/crm/live-updates'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

function parseStatusFilter(raw: string | null): FactStatus | FactStatus[] | undefined {
  if (!raw) return undefined
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean) as FactStatus[]
  const allowed = new Set(['APPLIED', 'PROPOSED', 'DISMISSED', 'SUPERSEDED'])
  const valid = parts.filter((p) => allowed.has(p))
  if (valid.length === 0) return undefined
  return valid.length === 1 ? valid[0] : valid
}

export const GET = withCrmAuth<RouteCtx>('member', async (req, ctx, routeCtx) => {
  const { id: contactId } = await routeCtx!.params
  if (!contactId) return apiError('Contact ID is required', 400)

  const access = await loadAccessibleFactContact(ctx, contactId)
  if (!access.ok) return access.res

  const url = new URL(req.url)
  const status = parseStatusFilter(url.searchParams.get('status'))
  const fieldRaw = url.searchParams.get('field')
  const field = fieldRaw && isFactField(fieldRaw) ? fieldRaw : undefined
  const includePossible = url.searchParams.get('includePossible') === 'true'
  const limit = Number(url.searchParams.get('limit') || '100')

  let facts = await listContactFacts({
    orgId: ctx.orgId,
    contactId,
    status,
    field,
    limit: Number.isFinite(limit) ? limit : 100,
  })

  // Default proposals UI hides POSSIBLE noise unless explicitly requested
  if (!includePossible && !status) {
    facts = facts.filter((f) => f.band !== 'POSSIBLE' || f.status === 'APPLIED')
  }

  return apiSuccess({
    facts,
    meta: {
      contactId,
      count: facts.length,
      factFields: FACT_FIELDS,
      evidenceKinds: EVIDENCE_KINDS,
    },
  })
})

export const POST = withCrmAuth<RouteCtx>('member', async (req: NextRequest, ctx, routeCtx) => {
  const { id: contactId } = await routeCtx!.params
  if (!contactId) return apiError('Contact ID is required', 400)

  const access = await loadAccessibleFactContact(ctx, contactId)
  if (!access.ok) return access.res

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON body', 400)

  const field = (body as { field?: unknown }).field
  const value = (body as { value?: unknown }).value
  const method = (body as { method?: unknown }).method
  const sourceUrl = (body as { sourceUrl?: unknown }).sourceUrl
  const sessionId = (body as { sessionId?: unknown }).sessionId
  const rawEvidence = (body as { evidence?: unknown }).evidence

  if (!isFactField(field)) {
    return apiError(`Invalid field. Allowed: ${FACT_FIELDS.join(', ')}`, 400)
  }
  if (typeof value !== 'string' || !value.trim()) {
    return apiError('value is required', 400)
  }
  if (!Array.isArray(rawEvidence) || rawEvidence.length === 0) {
    return apiError('evidence[] is required (observation kinds only — do not send confidence)', 400)
  }
  if ('confidence' in (body as object) || 'score' in (body as object) || 'band' in (body as object)) {
    return apiError('Do not send confidence/score/band — the ledger prices evidence kinds in code', 400)
  }

  const evidence: Evidence[] = []
  for (const item of rawEvidence) {
    if (!item || typeof item !== 'object') {
      return apiError('Each evidence item must be an object', 400)
    }
    const kind = (item as { kind?: unknown }).kind
    const detail = (item as { detail?: unknown }).detail
    const evUrl = (item as { sourceUrl?: unknown }).sourceUrl
    if (!isEvidenceKind(kind)) {
      return apiError(`Invalid evidence.kind. Allowed: ${EVIDENCE_KINDS.join(', ')}`, 400)
    }
    if (typeof detail !== 'string' || !detail.trim()) {
      return apiError('evidence.detail is required', 400)
    }
    evidence.push({
      kind,
      detail: detail.trim(),
      ...(typeof evUrl === 'string' && evUrl.trim() ? { sourceUrl: evUrl.trim() } : {}),
    })
  }

  const agentId =
    ctx.isAgent || ctx.actor.kind === 'agent'
      ? ctx.actor.uid.replace(/^agent:/, '')
      : typeof (body as { agentId?: unknown }).agentId === 'string'
        ? String((body as { agentId: string }).agentId)
        : null

  const result = await recordContactFact(
    {
      orgId: ctx.orgId,
      contactId,
      field,
      value: value.trim(),
      evidence,
      method: typeof method === 'string' && method.trim() ? method.trim() : 'api.record_fact',
      sourceUrl: typeof sourceUrl === 'string' ? sourceUrl : undefined,
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      agentId,
      createdByRef: ctx.actor,
    },
    access.contact,
  )

  if (result.stored) {
    await safeTouchCrmLiveUpdate(ctx.orgId, 'contacts', 'contact.fact_recorded')
  }

  return apiSuccess(
    {
      result,
      contactId,
    },
    result.stored ? 201 : 200,
  )
})
