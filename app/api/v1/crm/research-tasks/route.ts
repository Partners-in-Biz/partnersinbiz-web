/**
 * GET  /api/v1/crm/research-tasks — list CRM research queue items
 * POST /api/v1/crm/research-tasks — schedule_recheck (reason required)
 *
 * Auth: member+
 */
import { NextRequest } from 'next/server'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  listResearchTasks,
  scheduleRecheck,
  type ResearchTaskKind,
  type ResearchTaskStatus,
} from '@/lib/crm/facts'

export const dynamic = 'force-dynamic'

const KINDS = new Set<ResearchTaskKind>([
  'enrich_contact',
  'recheck_contact',
  'enrich_company',
  'job_change_check',
  'mailbox_identity',
  'custom',
])

export const GET = withCrmAuth('member', async (req, ctx) => {
  const url = new URL(req.url)
  const contactId = url.searchParams.get('contactId') || undefined
  const status = (url.searchParams.get('status') || undefined) as ResearchTaskStatus | undefined
  const dueOnly = url.searchParams.get('due') === 'true'
  const limit = Number(url.searchParams.get('limit') || '50')

  const tasks = await listResearchTasks({
    orgId: ctx.orgId,
    contactId,
    status,
    dueBefore: dueOnly ? new Date() : undefined,
    limit: Number.isFinite(limit) ? limit : 50,
  })

  return apiSuccess({ tasks, count: tasks.length })
})

export const POST = withCrmAuth('member', async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON body', 400)

  const reason = (body as { reason?: unknown }).reason
  if (typeof reason !== 'string' || !reason.trim()) {
    return apiError('reason is required (rep-visible recheck explanation)', 400)
  }

  const contactId = (body as { contactId?: unknown }).contactId
  const companyId = (body as { companyId?: unknown }).companyId
  const dealId = (body as { dealId?: unknown }).dealId
  if (
    (contactId != null && typeof contactId !== 'string') ||
    (companyId != null && typeof companyId !== 'string') ||
    (dealId != null && typeof dealId !== 'string')
  ) {
    return apiError('contactId/companyId/dealId must be strings when provided', 400)
  }
  if (!contactId && !companyId && !dealId) {
    return apiError('Provide contactId, companyId, or dealId', 400)
  }

  const kindRaw = (body as { kind?: unknown }).kind
  const kind =
    typeof kindRaw === 'string' && KINDS.has(kindRaw as ResearchTaskKind)
      ? (kindRaw as ResearchTaskKind)
      : 'recheck_contact'

  const delaySeconds = (body as { delaySeconds?: unknown }).delaySeconds
  const budgetUnits = (body as { budgetUnits?: unknown }).budgetUnits
  const priority = (body as { priority?: unknown }).priority

  try {
    const agentId =
      ctx.isAgent || ctx.actor.kind === 'agent'
        ? ctx.actor.uid.replace(/^agent:/, '')
        : null

    const { id } = await scheduleRecheck({
      orgId: ctx.orgId,
      contactId: typeof contactId === 'string' ? contactId : undefined,
      companyId: typeof companyId === 'string' ? companyId : undefined,
      dealId: typeof dealId === 'string' ? dealId : undefined,
      kind,
      reason: reason.trim(),
      delaySeconds: typeof delaySeconds === 'number' ? delaySeconds : undefined,
      budgetUnits: typeof budgetUnits === 'number' ? budgetUnits : undefined,
      priority: typeof priority === 'number' ? priority : undefined,
      metadata:
        (body as { metadata?: unknown }).metadata &&
        typeof (body as { metadata: unknown }).metadata === 'object'
          ? (body as { metadata: Record<string, unknown> }).metadata
          : undefined,
      createdByRef: ctx.actor,
      agentId,
    })
    return apiSuccess({ id, scheduled: true }, 201)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to schedule recheck'
    return apiError(msg, 400)
  }
})
