import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/** Human-only approval gate for client-visible email campaign launch. */
export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  if (user.role === 'ai') return apiError('Human approval is required', 403)
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
  await ref.update({
    approvalState: {
      status: 'approved',
      approvedBy: user.uid,
      approvedAt: FieldValue.serverTimestamp(),
      approvalTaskId: approvalTaskId || null,
    },
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: user.uid,
    updatedByType: 'user',
  })

  return apiSuccess({ id, approvalState: 'approved' })
})
