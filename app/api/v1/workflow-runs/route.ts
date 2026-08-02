/**
 * POST /api/v1/workflow-runs — start a run from a template
 * GET  /api/v1/workflow-runs?orgId=&id= — lightweight list/read helper (single id via query)
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { withIdempotency } from '@/lib/api/idempotency'
import {
  getWorkflowRun,
  startWorkflowRun,
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
  if (!id) return apiError('id query param is required (use GET /workflow-runs/{id} for full inspect)', 400)
  const run = await getWorkflowRun(id)
  if (!run) return apiError('Workflow run not found', 404)
  if (user.role !== 'ai' && !canAccessOrg(user, run.orgId)) return apiError('Forbidden', 403)
  return apiSuccess(run)
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
