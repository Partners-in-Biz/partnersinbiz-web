import type * as FirebaseFirestore from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'

export type InvoiceAccessOk = {
  ok: true
  ref: FirebaseFirestore.DocumentReference
  snap: FirebaseFirestore.DocumentSnapshot
  data: FirebaseFirestore.DocumentData
}

export type InvoiceAccessErr = {
  ok: false
  response: Response
}

export async function requireInvoiceAccess(
  user: ApiUser,
  invoiceId: string,
  requestedOrgId?: string | null,
): Promise<InvoiceAccessOk | InvoiceAccessErr> {
  const ref = adminDb.collection('invoices').doc(invoiceId)
  const snap = await ref.get()
  if (!snap.exists) return { ok: false, response: apiError('Invoice not found', 404) }

  const data = snap.data() ?? {}
  const orgIds = [data.orgId, data.sourceOrgId, data.recipientOrgId, data.targetOrgId]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
  const scopedOrgId = typeof requestedOrgId === 'string' && requestedOrgId.trim()
    ? requestedOrgId.trim()
    : user.role === 'client'
      ? user.activeOrgId
      : undefined

  if (scopedOrgId) {
    if (!canAccessOrg(user, scopedOrgId)) return { ok: false, response: apiError('Forbidden', 403) }
    if (!orgIds.includes(scopedOrgId)) return { ok: false, response: apiError('Invoice not found', 404) }
  }

  if (!orgIds.some((orgId) => canAccessOrg(user, orgId))) {
    return { ok: false, response: apiError('Forbidden', 403) }
  }

  return { ok: true, ref, snap, data }
}
