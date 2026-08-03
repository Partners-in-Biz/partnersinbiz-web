/**
 * POST /api/v1/workflow-runs — start a run from a template (manual / cron / event caller)
 * GET  /api/v1/workflow-runs?orgId=&status=stuck|blocked|paused_budget|running|succeeded|failed|cancelled|all
 *      status omitted or status=all → full ledger (unfiltered). Never treats "all" as a stored status.
 * GET  /api/v1/workflow-runs?orgId=&id= — lightweight single read
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { withIdempotency } from '@/lib/api/idempotency'
import {
  getWorkflowRun,
  listOpsWorkflowRuns,
  startWorkflowRun,
  buildOpsInspect,
} from '@/lib/workflow-graph'

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveOrgId(req: NextRequest, body?: Record<string, unknown>): string {
  const url = new URL(req.url)
  return cleanString(url.searchParams.get('orgId'))
    || cleanString(req.headers.get('x-org-id'))
    || cleanString(body?.orgId)
}

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const url = new URL(req.url)
  const id = cleanString(url.searchParams.get('id'))
  const orgId = resolveOrgId(req)
  const statusRaw = cleanString(url.searchParams.get('status'))
  // status=all is an ops alias for unfiltered ledger (same as omitting status)
  const status = !statusRaw || statusRaw === 'all' ? undefined : statusRaw
  const limit = Number(url.searchParams.get('limit') || 50)

  if (id) {
    const run = await getWorkflowRun(id)
    if (!run) return apiError('Workflow run not found', 404)
    if (user.role !== 'ai' && !canAccessOrg(user, run.orgId)) return apiError('Forbidden', 403)
    return apiSuccess({ run, inspect: buildOpsInspect(run) })
  }

  if (!orgId) return apiError('orgId is required (or pass id)', 400)
  if (user.role !== 'ai' && !canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const list = await listOpsWorkflowRuns({
    orgId,
    status,
    limit: Number.isFinite(limit) ? limit : 50,
  })
  return apiSuccess({
    orgId,
    status: status || 'all',
    counts: list.counts,
    items: list.items,
    facts: list.facts,
  })
})

export const POST = withAuth('admin', withIdempotency(async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const orgId = resolveOrgId(req, body)
  if (!orgId) return apiError('orgId is required', 400)
  if (user.role !== 'ai' && !canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const templateId = cleanString(body.templateId)
  if (!templateId) return apiError('templateId is required', 400)

  const projectId = cleanString(body.projectId) || undefined
  const triggerType = cleanString(body.triggerType) || cleanString((body.trigger as Record<string, unknown> | undefined)?.type) || 'manual'
  const triggerRef = cleanString(body.triggerRef) || cleanString((body.trigger as Record<string, unknown> | undefined)?.ref) || undefined
  const idempotencyKey = cleanString(req.headers.get('idempotency-key')) || cleanString(body.idempotencyKey) || undefined

  const result = await startWorkflowRun({
    orgId,
    templateId,
    projectId,
    actorUid: user.uid,
    trigger: { type: triggerType, ref: triggerRef },
    idempotencyKey,
    approvalRefs: Array.isArray(body.approvalRefs) ? body.approvalRefs as never : undefined,
  })
  if (!result.ok) return apiError(result.error, result.status)
  return apiSuccess({
    run: result.run,
    inspect: result.inspect,
    deduplicated: result.deduplicated === true,
  }, result.deduplicated ? 200 : 201)
}))
