/**
 * GET /api/v1/admin/billing/eft-queue — list invoices awaiting EFT proof verification
 *
 * Returns every invoice with status `payment_pending_verification`, joined with
 * the org name (from `organizations`) and the proof file's preview URL
 * (from `uploads/{paymentProofFileId}`).
 *
 * Auth: admin (ai satisfies)
 */
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

interface EftQueueItem {
  invoiceId: string
  invoiceNumber: string
  orgId: string | null
  orgName: string | null
  total: number
  currency: string
  paymentProofUploadedAt: unknown
  paymentProofNote: string | null
  proofFileId: string | null
  proofUrl: string | null
  proofContentType: string | null
  proofFilename: string | null
}

export const GET = withAuth('admin', async () => {
  const snap = await adminDb
    .collection('invoices')
    .where('status', '==', 'payment_pending_verification')
    .get()

  // Collect unique org ids + proof file ids to batch the lookups.
  const orgIds = new Set<string>()
  const fileIds = new Set<string>()
  for (const doc of snap.docs) {
    const data = doc.data()
    if (typeof data.orgId === 'string' && data.orgId) orgIds.add(data.orgId)
    if (typeof data.paymentProofFileId === 'string' && data.paymentProofFileId) {
      fileIds.add(data.paymentProofFileId)
    }
  }

  const orgNameById = new Map<string, string>()
  await Promise.all(
    Array.from(orgIds).map(async (orgId) => {
      try {
        const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
        if (orgDoc.exists) {
          const name = orgDoc.data()?.name
          if (typeof name === 'string') orgNameById.set(orgId, name)
        }
      } catch {
        // best-effort join
      }
    }),
  )

  const fileById = new Map<string, { url: string | null; contentType: string | null; filename: string | null }>()
  await Promise.all(
    Array.from(fileIds).map(async (fileId) => {
      try {
        const fileDoc = await adminDb.collection('uploads').doc(fileId).get()
        if (fileDoc.exists && fileDoc.data()?.deleted !== true) {
          const f = fileDoc.data() ?? {}
          fileById.set(fileId, {
            url: typeof f.url === 'string' ? f.url : null,
            contentType: typeof f.mimeType === 'string' ? f.mimeType : null,
            filename: typeof f.name === 'string' ? f.name : null,
          })
        }
      } catch {
        // best-effort join
      }
    }),
  )

  const items: EftQueueItem[] = snap.docs.map((doc) => {
    const data = doc.data()
    const orgId = typeof data.orgId === 'string' && data.orgId ? data.orgId : null
    const proofFileId =
      typeof data.paymentProofFileId === 'string' && data.paymentProofFileId
        ? data.paymentProofFileId
        : null
    const file = proofFileId ? fileById.get(proofFileId) : undefined
    return {
      invoiceId: doc.id,
      invoiceNumber: typeof data.invoiceNumber === 'string' ? data.invoiceNumber : doc.id,
      orgId,
      orgName: orgId ? orgNameById.get(orgId) ?? null : null,
      total: typeof data.total === 'number' ? data.total : 0,
      currency: typeof data.currency === 'string' ? data.currency : 'ZAR',
      paymentProofUploadedAt: data.paymentProofUploadedAt ?? null,
      paymentProofNote: typeof data.paymentProofNote === 'string' ? data.paymentProofNote : null,
      proofFileId,
      proofUrl: file?.url ?? null,
      proofContentType: file?.contentType ?? null,
      proofFilename: file?.filename ?? null,
    }
  })

  // Most recently uploaded first.
  items.sort((a, b) => {
    const am = millis(a.paymentProofUploadedAt)
    const bm = millis(b.paymentProofUploadedAt)
    return (bm ?? 0) - (am ?? 0)
  })

  return apiSuccess(items)
})

function millis(value: unknown): number | null {
  if (!value) return null
  if (typeof value === 'object') {
    const v = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof v.toMillis === 'function') {
      try {
        return v.toMillis()
      } catch {
        return null
      }
    }
    const seconds = v.seconds ?? v._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return null
}
