import type * as FirebaseFirestore from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'

export type InvoiceAccessOk = {
  ok: true
  ref: FirebaseFirestore.DocumentReference
  snap: FirebaseFirestore.DocumentSnapshot
  data: Record<string, any>
}

export type InvoiceAccessErr = {
  ok: false
  response: Response
}

export async function requireInvoiceAccess(
  user: ApiUser,
  invoiceId: string,
): Promise<InvoiceAccessOk | InvoiceAccessErr> {
  const ref = adminDb.collection('invoices').doc(invoiceId)
  const snap = await ref.get()
  if (!snap.exists) return { ok: false, response: apiError('Invoice not found', 404) }

  const data = snap.data() ?? {}
  if (!canAccessOrg(user, data.orgId)) {
    return { ok: false, response: apiError('Forbidden', 403) }
  }

  return { ok: true, ref, snap, data }
}
