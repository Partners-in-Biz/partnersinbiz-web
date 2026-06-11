/**
 * POST /api/v1/expenses/:id/approve — approve or reject a submitted expense.
 *
 * Body: { action: 'approve' | 'reject', note?: string }
 *   - approve: status -> approved, sets reviewedBy/reviewedAt
 *   - reject:  status -> rejected, sets rejectionReason + reviewedBy/reviewedAt
 *
 * Notifies the submitter in both cases. Requires status to be 'submitted'.
 *
 * Auth: admin (AI/admin)
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { lastActorFrom } from '@/lib/api/actor'
import { apiSuccess, apiError } from '@/lib/api/response'
import { logActivity } from '@/lib/activity/log'
import type { Expense, ExpenseStatus } from '@/lib/expenses/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (req, user, context) => {
  const { id } = await (context as RouteContext).params
  const ref = adminDb.collection('expenses').doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Expense not found', 404)
  const existing = doc.data() as Expense | undefined
  if (!existing || existing.deleted === true) {
    return apiError('Expense not found', 404)
  }

  if (existing.status !== 'submitted') {
    return apiError('Can only approve/reject a submitted expense', 409)
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'approve' | 'reject'
    note?: string
  }

  if (body.action !== 'approve' && body.action !== 'reject') {
    return apiError("action must be 'approve' or 'reject'")
  }

  const nextStatus: ExpenseStatus =
    body.action === 'approve' ? 'approved' : 'rejected'

  const updates: Record<string, unknown> = {
    status: nextStatus,
    reviewedBy: user.uid,
    reviewedAt: FieldValue.serverTimestamp(),
    ...lastActorFrom(user),
  }

  if (body.action === 'reject') {
    updates.rejectionReason = body.note ?? ''
  } else {
    // Clear any previous rejection reason when approving.
    updates.rejectionReason = null
  }

  await ref.update(updates)
  logActivity({
    orgId: existing.orgId,
    type: 'expense_approved',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: body.action === 'approve' ? 'Approved expense' : 'Rejected expense',
    entityId: id,
    entityType: 'expense',
  }).catch(() => {})

  // Notify the original submitter.
  const amountLabel = `${existing.currency} ${existing.amount.toFixed(2)}`
  const isApprove = body.action === 'approve'
  await adminDb.collection('notifications').add({
    orgId: existing.orgId,
    userId: existing.userId,
    agentId: null,
    type: isApprove ? 'expense.approved' : 'expense.rejected',
    title: isApprove ? 'Expense approved' : 'Expense rejected',
    body: isApprove
      ? `${existing.category} — ${amountLabel} approved`
      : `${existing.category} — ${amountLabel} rejected${body.note ? `: ${body.note}` : ''}`,
    link: `/portal/payments?expense=${id}`,
    data: { expenseId: id, reviewedBy: user.uid, note: body.note ?? null },
    priority: 'normal',
    status: 'unread',
    snoozedUntil: null,
    readAt: null,
    createdAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({
    id,
    status: nextStatus,
    reviewedBy: user.uid,
    reviewedAt: new Date().toISOString(),
  })
})
