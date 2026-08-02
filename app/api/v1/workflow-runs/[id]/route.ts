/**
 * GET  /api/v1/workflow-runs/[id] — run ledger + Phase 2 ops inspect (one call)
 * POST /api/v1/workflow-runs/[id] — advance tick / approval / kanban terminal (internal)
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import {
  advanceWorkflowRunById,
  getWorkflowRun,
  buildOpsInspect,
} from '@/lib/workflow-graph'
import type { AdvanceEvent } from '@/lib/workflow-graph'

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const run = await getWorkflowRun(id)
  if (!run) return apiError('Workflow run not found', 404)
  if (user.role !== 'ai' && !canAccessOrg(user, run.orgId)) return apiError('Forbidden', 403)

  const url = new URL(req.url)
  const scoped = cleanString(url.searchParams.get('orgId')) || cleanString(req.headers.get('x-org-id'))
  if (scoped && scoped !== run.orgId) return apiError('Forbidden', 403)

  return apiSuccess({
    run,
    inspect: buildOpsInspect(run),
  })
})

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const existing = await getWorkflowRun(id)
  if (!existing) return apiError('Workflow run not found', 404)
  if (user.role !== 'ai' && !canAccessOrg(user, existing.orgId)) return apiError('Forbidden', 403)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const now = cleanString(body.now) || new Date().toISOString()
  const action = cleanString(body.action) || 'tick'

  let event: AdvanceEvent
  if (action === 'approval_granted') {
    const approval = body.approval as Record<string, unknown> | undefined
    if (!approval || !cleanString(approval.capability) || !cleanString(approval.ref)) {
      return apiError('approval.capability and approval.ref are required', 400)
    }
    event = {
      type: 'approval_granted',
      now,
      approval: {
        capability: cleanString(approval.capability),
        resourceIds: Array.isArray(approval.resourceIds)
          ? approval.resourceIds.map((item) => cleanString(item)).filter(Boolean)
          : [],
        approvedBy: cleanString(approval.approvedBy) || user.uid,
        at: cleanString(approval.at) || now,
        ref: cleanString(approval.ref),
      },
    }
  } else if (action === 'kanban_terminal') {
    event = {
      type: 'kanban_terminal',
      now,
      nodeId: cleanString(body.nodeId),
      kanbanTaskId: cleanString(body.kanbanTaskId),
      outcome: (cleanString(body.outcome) as 'done' | 'blocked' | 'awaiting_input' | 'rejected') || 'done',
      evidence: Array.isArray(body.evidence) ? body.evidence as never : undefined,
      summary: cleanString(body.summary) || undefined,
      tokensIn: typeof body.tokensIn === 'number' ? body.tokensIn : undefined,
      tokensOut: typeof body.tokensOut === 'number' ? body.tokensOut : undefined,
      tokensTotal: typeof body.tokensTotal === 'number' ? body.tokensTotal : undefined,
      estimatedCost: typeof body.estimatedCost === 'number' ? body.estimatedCost : undefined,
      model: cleanString(body.model) || undefined,
      provider: cleanString(body.provider) || undefined,
      hermesRunId: cleanString(body.hermesRunId) || undefined,
      errorFamily: cleanString(body.errorFamily) as never,
    }
    if (!event.nodeId || !event.kanbanTaskId) return apiError('nodeId and kanbanTaskId required', 400)
  } else {
    event = {
      type: 'tick',
      now,
      orgInFlightAgentClaims: typeof body.orgInFlightAgentClaims === 'number' ? body.orgInFlightAgentClaims : undefined,
      agentInFlightByAssignee: body.agentInFlightByAssignee && typeof body.agentInFlightByAssignee === 'object'
        ? body.agentInFlightByAssignee as Record<string, number>
        : undefined,
      artifactPresence: body.artifactPresence && typeof body.artifactPresence === 'object'
        ? body.artifactPresence as Record<string, boolean>
        : undefined,
      systemResults: body.systemResults && typeof body.systemResults === 'object'
        ? body.systemResults as never
        : undefined,
    }
  }

  const result = await advanceWorkflowRunById(id, event, user.uid)
  if (!result.ok) return apiError(result.error, result.status)
  return apiSuccess({ run: result.run, inspect: result.inspect })
})
