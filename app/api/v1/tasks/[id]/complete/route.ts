/**
 * POST /api/v1/tasks/:id/complete — mark a task as done
 *
 * Auth: admin (AI/admin)
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { lastActorFrom } from '@/lib/api/actor'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { Task } from '@/lib/tasks/types'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { logActivity } from '@/lib/activity/log'
import { validateCompletionEvidence } from '@/lib/projects/completionIntegrity'
import { isAgentOwnedTask } from '@/lib/tasks/agentState'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (_req, user, context) => {
  const { id } = await (context as RouteContext).params
  const ref = adminDb.collection('tasks').doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Task not found', 404)
  const existing = doc.data() as Task | undefined
  if (!existing || existing.deleted === true) {
    return apiError('Task not found', 404)
  }

  // Agent tasks are terminal only through watcher verification and, when assigned,
  // the separate reviewer handoff. This legacy route must never create a terminal
  // agent transition or emit completion side effects on the route's own authority.
  const isAgentTask = isAgentOwnedTask(existing)
  const evidence = validateCompletionEvidence(existing.completionEvidence)
  const verification = existing.completionVerification
  const watcherVerified = evidence.ok
    && verification?.verifierIdentity === 'agent-watcher'
    && verification.verifierResult === 'passed'
    && (evidence.evidence.workKind !== 'code' || (
      verification.commitReachable === true
      && verification.changedFilesMatch === true
      && verification.worktreeClean === true
    ))
  const hasReviewer = Boolean(
    (typeof existing.reviewerAgentId === 'string' && existing.reviewerAgentId.trim())
    || (Array.isArray(existing.reviewerIds) && existing.reviewerIds.some((reviewerId) => typeof reviewerId === 'string' && reviewerId.trim())),
  )
  if (isAgentTask && !watcherVerified) {
    const priorSummary = typeof existing.agentOutput?.summary === 'string' ? existing.agentOutput.summary.trim() : ''
    const exactReason = 'completion_integrity_verification_required'
    await ref.update({
      status: 'in_progress',
      agentStatus: 'blocked',
      columnId: 'blocked',
      reviewStatus: 'changes-requested',
      agentHeartbeatAt: null,
      completionIntegrityFailureReasons: [exactReason],
      agentOutput: {
        ...(existing.agentOutput ?? {}),
        summary: `${priorSummary ? `${priorSummary}\n\n` : ''}Completion integrity blocked: ${exactReason}. Submit structured completionEvidence and let the watcher verify it before Done or approval.`,
      },
      ...lastActorFrom(user),
    })
    return apiSuccess({ id, status: 'in_progress', agentStatus: 'blocked', reason: exactReason })
  }
  if (isAgentTask && hasReviewer && existing.reviewStatus !== 'approved') {
    return apiError('completion_integrity_reviewer_handoff_required', 409)
  }
  if (isAgentTask) {
    // A watcher/reviewer transition is the only supported agent completion path.
    // An already terminal record is an idempotent read; a nonterminal one remains
    // untouched so this legacy convenience endpoint cannot bypass the state machine.
    if (existing.status === 'done' && existing.agentStatus === 'done' && (!hasReviewer || existing.reviewStatus === 'approved')) {
      return apiSuccess({ id, status: 'done', agentStatus: 'done' })
    }
    return apiError('completion_integrity_legacy_completion_route_disabled', 409)
  }

  await ref.update({
    status: 'done',
    completedAt: FieldValue.serverTimestamp(),
    ...lastActorFrom(user),
  })

  if (existing.orgId) {
    try {
      await dispatchWebhook(existing.orgId, 'task.completed', {
        id,
        title: existing.title,
        projectId: existing.projectId ?? null,
        completedBy: user.uid,
      })
    } catch (err) {
      console.error('[webhook-dispatch-error] task.completed', err)
    }

    logActivity({
      orgId: existing.orgId,
      type: 'task_completed',
      actorId: user.uid,
      actorName: user.uid,
      actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
      description: 'Completed task',
      entityId: id,
      entityType: 'task',
      entityTitle: existing.title,
    }).catch(() => {})
  }
  return apiSuccess({ id, status: 'done' })
})
