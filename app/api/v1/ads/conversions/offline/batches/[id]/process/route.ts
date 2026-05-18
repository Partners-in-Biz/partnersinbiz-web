// app/api/v1/ads/conversions/offline/batches/[id]/process/route.ts
// POST — process a batch: stream CSV from Storage → trackConversion per row → upsert results.
// Idempotent: only processes rows with status 'pending' (or not yet written).

import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getBatch, listRows, upsertRow, updateBatchStatus } from '@/lib/ads/offline-conversions/store'
import { parseCsv } from '@/lib/ads/offline-conversions/parse'
import { trackConversion } from '@/lib/ads/conversions/track'
import { getAdminApp } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

export const dynamic = 'force-dynamic'
// Offline processing can take a while — extend timeout to 5 minutes
export const maxDuration = 300

export const POST = withAuth('admin', async (req: NextRequest, _user, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  const { id: batchId } = await params

  try {
    const batch = await getBatch(batchId)
    if (!batch) return apiError('Batch not found', 404)
    if (batch.orgId !== orgId) return apiError('Forbidden', 403)
    if (batch.status === 'processing') return apiError('Batch is already being processed', 409)

    // Download CSV from Storage
    const bucket = getStorage(getAdminApp()).bucket()
    const file = bucket.file(batch.csvPath)
    const [buffer] = await file.download()
    const { rows } = parseCsv(buffer.toString('utf8'))

    // Determine which rows are already processed (idempotency)
    const existingRows = await listRows({ batchId })
    const processedIds = new Set(
      existingRows.filter((r) => r.status !== 'pending').map((r) => r.eventId),
    )

    const pendingRows = rows.filter((r) => !processedIds.has(r.eventId))

    await updateBatchStatus({ batchId, status: 'processing' })

    let processed = 0
    let failed = 0

    for (const row of pendingRows) {
      try {
        const result = await trackConversion({
          orgId: batch.orgId,
          conversionActionId: batch.conversionActionId,
          eventId: row.eventId,
          eventTime: new Date(row.eventTimeIso),
          user: { email: row.email, phone: row.phone },
          value: row.value,
          currency: row.currency,
          gclid: row.gclid,
          ttclid: row.ttclid,
          liFatId: row.liFatId,
        })
        await upsertRow({
          batchId,
          row: {
            ...row,
            status: 'sent',
            result,
            processedAt: Timestamp.now(),
          },
        })
        processed++
      } catch (err) {
        await upsertRow({
          batchId,
          row: {
            ...row,
            status: 'failed',
            errorMessage: (err as Error).message,
            processedAt: Timestamp.now(),
          },
        })
        failed++
      }
    }

    const finalStatus = pendingRows.length === 0
      ? batch.status === 'completed' || batch.status === 'partial'
        ? batch.status
        : 'completed'
      : failed === 0
        ? 'completed'
        : 'partial'

    await updateBatchStatus({
      batchId,
      status: finalStatus,
      processedDelta: processed,
      failedDelta: failed,
    })

    return apiSuccess({
      batchId,
      processed,
      failed,
      skipped: rows.length - pendingRows.length,
      status: finalStatus,
    })
  } catch (err) {
    await updateBatchStatus({
      batchId,
      status: 'failed',
      errorMessage: (err as Error).message,
    }).catch(() => undefined)
    return apiError((err as Error).message ?? 'Processing failed', 500)
  }
})
