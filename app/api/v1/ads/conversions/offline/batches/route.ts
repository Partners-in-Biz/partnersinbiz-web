// app/api/v1/ads/conversions/offline/batches/route.ts
// GET — list offline conversion batches for org. Filterable by ?status=

import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { listBatches } from '@/lib/ads/offline-conversions/store'
import type { BatchStatus } from '@/lib/ads/offline-conversions/types'

export const dynamic = 'force-dynamic'

const VALID_STATUSES: BatchStatus[] = ['queued', 'processing', 'completed', 'failed', 'partial']

export const GET = withAuth('admin', async (req: NextRequest) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  const url = new URL(req.url)
  const statusParam = url.searchParams.get('status')
  const status =
    statusParam && VALID_STATUSES.includes(statusParam as BatchStatus)
      ? (statusParam as BatchStatus)
      : undefined

  try {
    const batches = await listBatches({ orgId, status })
    return apiSuccess({ batches })
  } catch (err) {
    return apiError((err as Error).message ?? 'List failed', 500)
  }
})
