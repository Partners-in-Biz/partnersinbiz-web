import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { validateEmailMarketingApprovalTask } from '@/lib/email-marketing/agent-governance'
import { buildEmailApprovalSnapshotHash } from '@/lib/email-marketing/approval-snapshot'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/** Human-only approval gate for client-visible email campaign launch. */
export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  if (user.role === 'ai' || user.authKind === 'agent_api_key' || user.authKind === 'legacy_ai_key') return apiError('Human approval is required', 403)
  const { id } = await (context as Params).params
  const ref = adminDb.collection('campaigns').doc(id)
  const snap = await ref.get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Campaign not found', 404)

  const campaign = snap.data() as Record<string, unknown>
  const scope = resolveOrgScope(user, typeof campaign.orgId === 'string' ? campaign.orgId : null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
    return apiError('Only draft or scheduled campaigns can be approved', 422)
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const approvalTaskId = typeof body.approvalTaskId === 'string' ? body.approvalTaskId.trim() : ''
  if (!approvalTaskId) return apiError('approvalTaskId is required', 400)
  const taskSnap = await adminDb.collection('tasks').doc(approvalTaskId).get()
  try {
    validateEmailMarketingApprovalTask(
      { status: 'approved', approvedBy: user.uid, approvedByType: 'user', approvalTaskId },
      taskSnap.exists ? taskSnap.data() : null,
      { orgId: scope.orgId, resourceType: 'email_campaign', resourceId: id },
    )
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Approval task evidence is invalid', 409)
  }
  await ref.update({
    approvalState: {
      status: 'approved',
      approvedBy: user.uid,
      approvedByType: 'user',
      approvedAt: FieldValue.serverTimestamp(),
      approvalTaskId,
      approvedSnapshotHash: buildEmailApprovalSnapshotHash(campaign),
    },
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: user.uid,
    updatedByType: 'user',
  })

  return apiSuccess({ id, approvalState: 'approved' })
})
