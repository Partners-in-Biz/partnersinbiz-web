import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { buildDailyCheckIn, type DailyCheckInInput, type DailyCheckInRecord } from '@/lib/self-improvement/reflections'

export const dynamic = 'force-dynamic'

function canAccessOwner(user: { uid: string; role?: string }, ownerId: string) {
  return ownerId === user.uid || user.role === 'admin' || user.role === 'super_admin'
}

export const GET = withAuth('client', async (req, user) => {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('orgId')?.trim()
  const ownerId = searchParams.get('ownerId')?.trim()
  const limit = Math.min(Number(searchParams.get('limit') ?? 100), 200)

  if (!orgId) return apiError('orgId is required; pass it as a query param')
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  if (ownerId && !canAccessOwner(user, ownerId)) return apiError('Forbidden', 403)

  let query = adminDb.collection('life_os_check_ins').where('orgId', '==', orgId)
  if (ownerId) query = query.where('ownerId', '==', ownerId)

  const snapshot = await query.orderBy('localDate', 'desc').get()
  const checkIns = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as DailyCheckInRecord)
    .slice(0, limit)

  return apiSuccess(checkIns, 200, { total: checkIns.length, page: 1, limit })
})

export const POST = withAuth('client', async (req, user) => {
  const body = (await req.json()) as DailyCheckInInput
  const orgId = body.orgId?.trim()
  if (!orgId) return apiError('orgId is required')
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  if (body.ownerId?.trim() && !canAccessOwner(user, body.ownerId.trim())) return apiError('Forbidden', 403)

  try {
    const checkIn = buildDailyCheckIn({
      ...body,
      orgId,
      ownerId: body.ownerId?.trim() || user.uid,
    }, new Date().toISOString())
    const doc = await adminDb.collection('life_os_check_ins').add(checkIn)
    return apiSuccess({ ...checkIn, id: doc.id }, 201)
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Invalid daily check-in payload')
  }
})
