/**
 * POST /api/v1/crm/contacts/[id]/facts/job-change
 * Record employer (and optional title) change with evidence + optional recheck.
 *
 * Body: {
 *   employer: string
 *   title?: string
 *   evidence: Evidence[]
 *   method?: string
 *   sourceUrl?: string
 *   scheduleFollowUp?: boolean
 *   followUpReason?: string
 * }
 */
import { NextRequest } from 'next/server'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  EVIDENCE_KINDS,
  isEvidenceKind,
  loadAccessibleFactContact,
  recordJobChange,
  type Evidence,
} from '@/lib/crm/facts'
import { safeTouchCrmLiveUpdate } from '@/lib/crm/live-updates'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

export const POST = withCrmAuth<RouteCtx>('member', async (req: NextRequest, ctx, routeCtx) => {
  const { id: contactId } = await routeCtx!.params
  if (!contactId) return apiError('Contact ID is required', 400)

  const access = await loadAccessibleFactContact(ctx, contactId)
  if (!access.ok) return access.res

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON body', 400)

  if ('confidence' in body || 'score' in body || 'band' in body) {
    return apiError('Do not send confidence/score/band — ledger prices evidence kinds', 400)
  }

  const employer = (body as { employer?: unknown }).employer
  if (typeof employer !== 'string' || !employer.trim()) {
    return apiError('employer is required', 400)
  }

  const rawEvidence = (body as { evidence?: unknown }).evidence
  if (!Array.isArray(rawEvidence) || rawEvidence.length === 0) {
    return apiError('evidence[] is required', 400)
  }

  const evidence: Evidence[] = []
  for (const item of rawEvidence) {
    if (!item || typeof item !== 'object') return apiError('Invalid evidence item', 400)
    const kind = (item as { kind?: unknown }).kind
    const detail = (item as { detail?: unknown }).detail
    const sourceUrl = (item as { sourceUrl?: unknown }).sourceUrl
    if (!isEvidenceKind(kind)) {
      return apiError(`Invalid evidence.kind. Allowed: ${EVIDENCE_KINDS.join(', ')}`, 400)
    }
    if (typeof detail !== 'string' || !detail.trim()) {
      return apiError('evidence.detail is required', 400)
    }
    evidence.push({
      kind,
      detail: detail.trim(),
      ...(typeof sourceUrl === 'string' && sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
    })
  }

  const title = (body as { title?: unknown }).title
  const agentId =
    ctx.isAgent || ctx.actor.kind === 'agent'
      ? ctx.actor.uid.replace(/^agent:/, '')
      : typeof (body as { agentId?: unknown }).agentId === 'string'
        ? String((body as { agentId: string }).agentId)
        : null

  const result = await recordJobChange(
    {
      orgId: ctx.orgId,
      contactId,
      employer: employer.trim(),
      title: typeof title === 'string' ? title : undefined,
      evidence,
      method:
        typeof (body as { method?: unknown }).method === 'string'
          ? String((body as { method: string }).method)
          : 'api.record_job_change',
      sourceUrl:
        typeof (body as { sourceUrl?: unknown }).sourceUrl === 'string'
          ? String((body as { sourceUrl: string }).sourceUrl)
          : undefined,
      agentId: agentId ?? undefined,
      createdByRef: ctx.actor,
      scheduleFollowUp: (body as { scheduleFollowUp?: unknown }).scheduleFollowUp !== false,
      followUpReason:
        typeof (body as { followUpReason?: unknown }).followUpReason === 'string'
          ? String((body as { followUpReason: string }).followUpReason)
          : undefined,
    },
    access.contact,
  )

  if (result.employer.stored || result.title?.stored) {
    await safeTouchCrmLiveUpdate(ctx.orgId, 'contacts', 'contact.job_change')
  }

  return apiSuccess({ contactId, result }, result.employer.stored ? 201 : 200)
})
