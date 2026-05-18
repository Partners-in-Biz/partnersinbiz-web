// app/api/v1/ads/conversions/offline/batches/[id]/retry-failed/route.ts
// POST — re-run only failed rows for a batch.

import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getBatch, listRows, upsertRow, updateBatchStatus } from '@/lib/ads/offline-conversions/store'
import { trackConversion } from '@/lib/ads/conversions/track'
import { Timestamp } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const POST = withAuth('admin', async (req: NextRequest, _user, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  const { id: batchId } = await params

  try {
    const batch = await getBatch(batchId)
    if (!batch) return apiError('Batch not found', 404)
    if (batch.orgId !== orgId) return apiError('Forbidden', 403)
    if (batch.status === 'processing') return apiError('Batch is currently being processed', 409)

    const failedRows = await listRows({ batchId, status: 'failed' })
    if (failedRows.length === 0) {
      return apiSuccess({ batchId, retried: 0, resolved: 0, stillFailed: 0 })
    }

    await updateBatchStatus({ batchId, status: 'processing' })

    let resolved = 0
    let stillFailed = 0

    for (const row of failedRows) {
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
            eventId: row.eventId,
            eventTimeIso: row.eventTimeIso,
            email: row.email,
            phone: row.phone,
            value: row.value,
            currency: row.currency,
            gclid: row.gclid,
            ttclid: row.ttclid,
            liFatId: row.liFatId,
            status: 'sent',
            result,
            processedAt: Timestamp.now(),
          },
        })
        resolved++
      } catch (err) {
        await upsertRow({
          batchId,
          row: {
            eventId: row.eventId,
            eventTimeIso: row.eventTimeIso,
            email: row.email,
            phone: row.phone,
            value: row.value,
            currency: row.currency,
            gclid: row.gclid,
            ttclid: row.ttclid,
            liFatId: row.liFatId,
            status: 'failed',
            errorMessage: (err as Error).message,
            processedAt: Timestamp.now(),
          },
        })
        stillFailed++
      }
    }

    // Re-check remaining failed count across all rows
    const allRows = await listRows({ batchId })
    const totalFailed = allRows.filter((r) => r.status === 'failed').length
    const finalStatus = totalFailed === 0 ? 'completed' : 'partial'

    // Update counters: increment processed by resolved, decrement failed by resolved
    await updateBatchStatus({
      batchId,
      status: finalStatus,
      processedDelta: resolved,
      failedDelta: -resolved,
    })

    return apiSuccess({
      batchId,
      retried: failedRows.length,
      resolved,
      stillFailed,
      status: finalStatus,
    })
  } catch (err) {
    await updateBatchStatus({
      batchId,
      status: 'failed',
      errorMessage: (err as Error).message,
    }).catch(() => undefined)
    return apiError((err as Error).message ?? 'Retry failed', 500)
  }
})
