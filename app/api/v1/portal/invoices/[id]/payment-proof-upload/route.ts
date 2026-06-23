import { NextRequest } from 'next/server'
import crypto from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

const MAX_FILE_SIZE = 10 * 1024 * 1024

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withPortalAuthAndRole(
  'viewer',
  async (req: NextRequest, uid: string, orgId: string, _role: string, ctx: RouteContext) => {
    const { id } = await ctx.params
    const formData = await req.formData().catch(() => null)
    if (!formData) return apiError('Invalid form data', 400)

    const file = formData.get('file') as File | null
    if (!file) return apiError('No file provided', 400)
    if (file.size > MAX_FILE_SIZE) return apiError('Payment proof is too large. Maximum size is 10MB.', 413)
    if (!(file.type.startsWith('image/') || file.type === 'application/pdf')) {
      return apiError('Only image and PDF proof uploads are supported', 400)
    }

    const invoiceSnap = await adminDb.collection('invoices').doc(id).get()
    if (!invoiceSnap.exists) return apiError('Invoice not found', 404)
    const invoice = invoiceSnap.data() ?? {}
    const recipientOrgId =
      typeof invoice.recipientOrgId === 'string' && invoice.recipientOrgId
        ? invoice.recipientOrgId
        : typeof invoice.orgId === 'string'
          ? invoice.orgId
          : null
    if (!recipientOrgId || recipientOrgId !== orgId) {
      return apiError('Forbidden', 403)
    }

    const ext = file.name.split('.').pop() ?? 'bin'
    const filename = `invoice-proofs/${orgId}/${id}/${Date.now()}-${crypto.randomUUID()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    try {
      const bucket = getStorage(getAdminApp()).bucket()
      const fileRef = bucket.file(filename)
      const downloadToken = crypto.randomUUID()

      await fileRef.save(buffer, {
        metadata: {
          contentType: file.type,
          metadata: { firebaseStorageDownloadTokens: downloadToken },
        },
      })

      const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filename)}?alt=media&token=${downloadToken}`

      const docRef = await adminDb.collection('uploads').add({
        orgId,
        name: file.name,
        storagePath: filename,
        url: publicUrl,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        folder: 'invoice-proofs',
        relatedTo: { type: 'invoice', id },
        createdBy: uid,
        createdByType: 'client',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        deleted: false,
      })

      return apiSuccess({ id: docRef.id, url: publicUrl, name: file.name, mimeType: file.type, size: file.size })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[portal/invoices/payment-proof-upload] Firebase Storage error:', message)
      return apiError(`Storage error: ${message}`, 500)
    }
  },
)
