/**
 * POST /api/v1/crm/contacts/[id]/facts/from-mailbox
 * Parse signature/reply text into evidence-backed fact proposals.
 * Egress-safe: local heuristics only.
 *
 * Body: {
 *   bodyText: string
 *   fromName?: string
 *   fromEmail?: string
 *   sourceUrl?: string
 *   direction?: 'inbound' | 'outbound' | 'unknown'
 *   dryRun?: boolean  // parse only, do not write
 * }
 *
 * Auth: member+
 */
import { NextRequest } from 'next/server'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  loadAccessibleFactContact,
  parseMailboxEvidence,
  recordContactFact,
  type RecordFactResult,
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

  const bodyText = (body as { bodyText?: unknown }).bodyText
  if (typeof bodyText !== 'string' || !bodyText.trim()) {
    return apiError('bodyText is required', 400)
  }
  // Hard cap to keep abuse surface small
  if (bodyText.length > 100_000) {
    return apiError('bodyText exceeds 100KB limit', 400)
  }

  const directionRaw = (body as { direction?: unknown }).direction
  const direction =
    directionRaw === 'inbound' || directionRaw === 'outbound' || directionRaw === 'unknown'
      ? directionRaw
      : 'unknown'

  const candidates = parseMailboxEvidence({
    bodyText,
    fromName:
      typeof (body as { fromName?: unknown }).fromName === 'string'
        ? (body as { fromName: string }).fromName
        : null,
    fromEmail:
      typeof (body as { fromEmail?: unknown }).fromEmail === 'string'
        ? (body as { fromEmail: string }).fromEmail
        : null,
    sourceUrl:
      typeof (body as { sourceUrl?: unknown }).sourceUrl === 'string'
        ? (body as { sourceUrl: string }).sourceUrl
        : null,
    direction,
  })

  const dryRun = (body as { dryRun?: unknown }).dryRun === true
  if (dryRun) {
    return apiSuccess({ dryRun: true, candidates, contactId })
  }

  const agentId =
    ctx.isAgent || ctx.actor.kind === 'agent'
      ? ctx.actor.uid.replace(/^agent:/, '')
      : 'mailbox-pipeline'

  const results: Array<{ candidate: (typeof candidates)[number]; result: RecordFactResult }> = []
  let stored = 0
  for (const candidate of candidates) {
    const result = await recordContactFact(
      {
        orgId: ctx.orgId,
        contactId,
        field: candidate.field,
        value: candidate.value,
        evidence: candidate.evidence,
        method: candidate.method,
        sourceUrl: candidate.evidence[0]?.sourceUrl,
        agentId,
        createdByRef: ctx.actor,
      },
      access.contact,
    )
    results.push({ candidate, result })
    if (result.stored) stored += 1
  }

  if (stored > 0) {
    await safeTouchCrmLiveUpdate(ctx.orgId, 'contacts', 'contact.mailbox_facts')
  }

  return apiSuccess(
    {
      contactId,
      candidateCount: candidates.length,
      storedCount: stored,
      results,
    },
    stored > 0 ? 201 : 200,
  )
})
