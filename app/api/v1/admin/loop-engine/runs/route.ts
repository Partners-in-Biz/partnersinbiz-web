import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function timestampToIso(value: unknown): unknown {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    try { return (value as { toDate: () => Date }).toDate().toISOString() } catch { return value }
  }
  return value
}

export const GET = withAuth('admin', async (req: NextRequest, user) => {
  const url = new URL(req.url)
  const orgId = cleanString(url.searchParams.get('orgId')) ?? req.headers.get('x-org-id')
  if (!orgId) return apiError('orgId is required', 400)
  if (!canAccessOrg(user, orgId)) return apiError(`You do not have access to orgId ${orgId}`, 403)

  const loopId = cleanString(url.searchParams.get('loopId'))
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 20) || 20, 50)
  let query = adminDb.collection('loop_engine_runs').where('orgId', '==', orgId)
  if (loopId) query = query.where('loopId', '==', loopId)
  const snap = await query.orderBy('updatedAt', 'desc').limit(limit).get()
  const runs = snap.docs.map((doc) => {
    const data = doc.data()
    return {
      id: doc.id,
      ...data,
      createdAt: timestampToIso(data.createdAt),
      updatedAt: timestampToIso(data.updatedAt),
    }
  })

  return apiSuccess({ runs })
})
