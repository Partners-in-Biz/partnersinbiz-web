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

  // An agent task is only terminal after the watcher/reviewer has verified its
  // structured evidence. This route is a legacy convenience completion action;
  // never let it bypass the completion-integrity handoff.
  const isAgentTask = typeof existing.assigneeAgentId === 'string' && existing.assigneeAgentId.trim().length > 0
  const verifierResult = existing.completionVerification?.verifierResult
  const completionVerified = verifierResult === 'passed' || verifierResult === 'approved'
  if (isAgentTask && !completionVerified) {
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
