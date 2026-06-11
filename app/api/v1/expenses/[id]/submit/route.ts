/**
 * POST /api/v1/expenses/:id/submit — move an expense from draft to submitted.
 *
 * Creates an org-wide `expense.submitted` notification so admins can review,
 * then dispatches the `expense.submitted` outbound webhook.
 *
 * Auth: admin (AI/admin)
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { lastActorFrom } from '@/lib/api/actor'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { Expense } from '@/lib/expenses/types'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (_req, user, context) => {
  const { id } = await (context as RouteContext).params
  const ref = adminDb.collection('expenses').doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Expense not found', 404)
  const existing = doc.data() as Expense | undefined
  if (!existing || existing.deleted === true) {
    return apiError('Expense not found', 404)
  }

  if (existing.status !== 'draft') {
    return apiError(
      `Can only submit a draft expense; current status is '${existing.status}'`,
      409,
    )
  }

  await ref.update({
    status: 'submitted',
    ...lastActorFrom(user),
  })

  // Org-wide notification (userId:null + agentId:null) so every admin sees it.
  const amountLabel = `${existing.currency} ${existing.amount.toFixed(2)}`
  await adminDb.collection('notifications').add({
    orgId: existing.orgId,
    userId: null,
    agentId: null,
    type: 'expense.submitted',
    title: 'Expense submitted for approval',
    body: `${existing.category} — ${amountLabel}${existing.vendor ? ` @ ${existing.vendor}` : ''}`,
    link: `/portal/payments?expense=${id}`,
    data: { expenseId: id, submittedBy: existing.userId },
    priority: 'normal',
    status: 'unread',
    snoozedUntil: null,
    readAt: null,
    createdAt: FieldValue.serverTimestamp(),
  })

  try {
    await dispatchWebhook(existing.orgId, 'expense.submitted', {
      id,
      amount: existing.amount,
      currency: existing.currency,
      category: existing.category,
      userId: existing.userId,
      submittedBy: user.uid,
    })
  } catch (err) {
    console.error('[webhook-dispatch-error] expense.submitted', err)
  }

  return apiSuccess({ id, status: 'submitted' })
})
