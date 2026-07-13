import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import { getOrganizationEmailApprovalPolicy, validateEmailMarketingApprovalTask } from '@/lib/email-marketing/agent-governance'
import type { ApiUser } from '@/lib/api/types'
import type { Broadcast } from '@/lib/broadcasts/types'
import { buildEmailApprovalSnapshotHash } from '@/lib/email-marketing/approval-snapshot'

type Params = { params: Promise<{ id: string }> }

export const POST = withAuth('client', async (_req: NextRequest, user: ApiUser, context?: unknown) => {
  if (user.authKind === 'agent_api_key' || user.authKind === 'legacy_ai_key' || user.role === 'ai') {
    return apiError('Only an authenticated human may approve an email broadcast', 403)
  }
  const { id } = await (context as Params).params
  const ref = adminDb.collection('broadcasts').doc(id)
  const snap = await ref.get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Broadcast not found', 404)
  const broadcast = snap.data() as Broadcast
  const scope = resolveOrgScope(user, broadcast.orgId ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const taskId = broadcast.approvalState?.approvalTaskId?.trim()
  if (!taskId) return apiError('Request approval before approving this broadcast', 409)
  const taskSnap = await adminDb.collection('tasks').doc(taskId).get()
  const policy = await getOrganizationEmailApprovalPolicy(scope.orgId)
  try {
    validateEmailMarketingApprovalTask(
      { status: 'approved', approvedBy: user.uid, approvedByType: 'user', approvalTaskId: taskId },
      taskSnap.exists ? taskSnap.data() : null,
      { orgId: scope.orgId, resourceType: 'email_broadcast', resourceId: id, makerChecker: policy.makerChecker, resourceCreatorUid: broadcast.createdBy },
    )
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Approval task evidence is invalid', 409)
  }
  await ref.update({
    approvalState: {
      status: 'approved', approvedBy: user.uid, approvedByType: 'user',
      approvedAt: FieldValue.serverTimestamp(), approvalTaskId: taskId,
      approvedSnapshotHash: buildEmailApprovalSnapshotHash({
        ...broadcast as unknown as Record<string, unknown>,
        scheduledFor: broadcast.approvalRequestedSchedule ?? broadcast.scheduledFor,
      }),
    },
    updatedAt: FieldValue.serverTimestamp(),
  })
  return apiSuccess({ id, status: 'approved', approvalTaskId: taskId })
})
