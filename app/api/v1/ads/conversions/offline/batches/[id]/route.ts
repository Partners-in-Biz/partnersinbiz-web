// app/api/v1/ads/conversions/offline/batches/[id]/route.ts
// GET — single batch + first 100 rows

import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getBatch, listRows } from '@/lib/ads/offline-conversions/store'
import type { OfflineConversionRow } from '@/lib/ads/offline-conversions/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req: NextRequest, _user, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  const { id } = await params

  try {
    const batch = await getBatch(id)
    if (!batch) return apiError('Batch not found', 404)
    if (batch.orgId !== orgId) return apiError('Forbidden', 403)

    const url = new URL(req.url)
    const statusParam = url.searchParams.get('rowStatus') as OfflineConversionRow['status'] | null

    const rows = await listRows({ batchId: id, status: statusParam ?? undefined })
    const firstHundred = rows.slice(0, 100)

    return apiSuccess({ batch, rows: firstHundred, totalRows: rows.length })
  } catch (err) {
    return apiError((err as Error).message ?? 'Fetch failed', 500)
  }
})
