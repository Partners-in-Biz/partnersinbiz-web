// app/api/v1/capture-sources/[id]/submissions/route.ts
//
// GET /api/v1/capture-sources/[id]/submissions?limit=&page=
// Auth: client. Lists submissions for a capture source.

import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  DEFAULT_BLOCK_STATS,
  type CaptureSource,
  type CaptureSubmission,
  LEAD_CAPTURE_SOURCES,
  LEAD_CAPTURE_SUBMISSIONS,
} from '@/lib/lead-capture/types'
import { buildCaptureFunnel } from '@/lib/lead-capture/funnel'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params

  const sourceSnap = await adminDb.collection(LEAD_CAPTURE_SOURCES).doc(id).get()
  if (!sourceSnap.exists || sourceSnap.data()?.deleted) return apiError('Not found', 404)
  const source = sourceSnap.data() as CaptureSource
  const scope = resolveOrgScope(user, source.orgId ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200)
  const page = Math.max(parseInt(searchParams.get('page') ?? '1'), 1)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = await (adminDb.collection(LEAD_CAPTURE_SUBMISSIONS) as any)
    .where('captureSourceId', '==', id)
    .get()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: CaptureSubmission[] = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }))
  data.sort((a, b) => {
    const ams = (a.createdAt as { _seconds?: number; seconds?: number } | null)?._seconds
      ?? (a.createdAt as { seconds?: number } | null)?.seconds ?? 0
    const bms = (b.createdAt as { _seconds?: number; seconds?: number } | null)?._seconds
      ?? (b.createdAt as { seconds?: number } | null)?.seconds ?? 0
    return bms - ams
  })

  const total = data.length
  const funnel = buildCaptureFunnel(data, source.stats?.blocked ?? DEFAULT_BLOCK_STATS)
  data = data.slice((page - 1) * limit, page * limit)

  return apiSuccess(data, 200, { total, page, limit, funnel })
})
