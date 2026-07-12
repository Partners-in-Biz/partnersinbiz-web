import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import { assertEmailMarketingAgentAction } from '@/lib/email-marketing/agent-governance'
import type { ApiUser } from '@/lib/api/types'
import type { Broadcast } from '@/lib/broadcasts/types'

type Params = { params: Promise<{ id: string }> }

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const broadcastRef = adminDb.collection('broadcasts').doc(id)
  const snap = await broadcastRef.get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Broadcast not found', 404)
  const broadcast = snap.data() as Broadcast
  const scope = resolveOrgScope(user, broadcast.orgId ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  try {
    assertEmailMarketingAgentAction(user, 'email_marketing_request_approval')
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Approval request is not authorised', 403)
  }

  const existingTaskId = broadcast.approvalState?.status === 'pending'
    ? broadcast.approvalState.approvalTaskId?.trim()
    : null
  if (existingTaskId) return apiSuccess({ id, approvalTaskId: existingTaskId, status: 'pending' })

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const requestedSchedule = typeof body.scheduledFor === 'string' && !Number.isNaN(Date.parse(body.scheduledFor))
    ? new Date(body.scheduledFor).toISOString()
    : null
  const taskRef = adminDb.collection('tasks').doc(`email-broadcast-approval-${id}`)
  await adminDb.runTransaction(async (transaction) => {
    const [latestBroadcast, existingTask] = await Promise.all([
      transaction.get(broadcastRef), transaction.get(taskRef),
    ])
    const latest = latestBroadcast.data() as Broadcast | undefined
    if (latest?.approvalState?.status === 'pending' && latest.approvalState.approvalTaskId) return
    if (!existingTask.exists || existingTask.data()?.status !== 'todo' || existingTask.data()?.approvalStatus !== 'pending') {
      transaction.set(taskRef, {
        orgId: scope.orgId,
        title: `Approve email broadcast: ${broadcast.name}`,
        description: 'Review the broadcast content, audience, sender, and schedule before client-visible delivery.',
        status: 'todo', approvalStatus: 'pending', approvalGate: 'client-visible',
        linkedResource: { type: 'email_broadcast', id },
        createdBy: user.uid, requestedBy: user.uid, createdByType: user.authKind === 'agent_api_key' ? 'agent' : 'user',
        deleted: false, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      })
    }
    transaction.update(broadcastRef, {
      approvalState: { status: 'pending', approvedBy: null, approvedByType: null, approvedAt: null, approvalTaskId: taskRef.id, approvedSnapshotHash: null },
      approvalRequestedSchedule: requestedSchedule,
      updatedAt: FieldValue.serverTimestamp(),
    })
  })
  return apiSuccess({ id, approvalTaskId: taskRef.id, status: 'pending' }, 201)
})
