// app/api/v1/ads/conversions/offline/upload/route.ts
// POST multipart: file (CSV) + conversionActionId
// Validates, parses, uploads to Firebase Storage, creates batch doc.

import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'
import { parseCsv } from '@/lib/ads/offline-conversions/parse'
import { createBatch } from '@/lib/ads/offline-conversions/store'
import { getStorage } from 'firebase-admin/storage'
import type { ApiUser } from '@/lib/api/types'
import type { AdConversionAction } from '@/lib/ads/types'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return apiError('Invalid multipart body', 400)
  }

  const file = form.get('file')
  if (!(file instanceof Blob)) return apiError('file is required', 400)
  if (file.size > MAX_BYTES) return apiError('File too large (max 10 MB)', 413)

  const conversionActionId = form.get('conversionActionId')
  if (typeof conversionActionId !== 'string' || !conversionActionId.trim()) {
    return apiError('conversionActionId is required', 400)
  }

  // Validate conversion action belongs to org
  const actionSnap = await adminDb.collection('ad_conversion_actions').doc(conversionActionId).get()
  if (!actionSnap.exists) return apiError('Conversion action not found', 404)
  const action = actionSnap.data() as AdConversionAction
  if (action.orgId !== orgId) return apiError('Conversion action belongs to a different org', 403)

  // Parse CSV
  const buf = Buffer.from(await file.arrayBuffer())
  const csvText = buf.toString('utf8')
  const { rows, errors } = parseCsv(csvText)

  if (rows.length === 0) {
    return apiError(`CSV produced no valid rows. Errors: ${errors.map((e) => e.message).join('; ')}`, 400)
  }

  // Upload to Firebase Storage
  const batchSuffix = crypto.randomBytes(8).toString('hex')
  const batchId = `ocb_${batchSuffix}`
  const csvPath = `orgs/${orgId}/offline-conversions/${batchId}.csv`

  const bucket = getStorage(getAdminApp()).bucket()
  const storageFile = bucket.file(csvPath)
  await storageFile.save(buf, { metadata: { contentType: 'text/csv' } })

  // Create batch doc
  const batch = await createBatch({
    orgId,
    conversionActionId,
    csvPath,
    totalRows: rows.length,
    createdBy: (user as { uid?: string; email?: string }).uid ?? (user as { email?: string }).email ?? 'unknown',
  })

  return apiSuccess({ batchId: batch.id, totalRows: rows.length, parseErrors: errors }, 201)
})
