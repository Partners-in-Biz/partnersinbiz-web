import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { buildLifeExperiment, type LifeExperimentInput, type LifeExperimentRecord } from '@/lib/self-improvement/experiments'

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

  let query = adminDb.collection('life_os_experiments').where('orgId', '==', orgId)
  if (ownerId) query = query.where('ownerId', '==', ownerId)

  const snapshot = await query.orderBy('startDate', 'desc').get()
  const experiments = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as LifeExperimentRecord)
    .slice(0, limit)

  return apiSuccess(experiments, 200, { total: experiments.length, page: 1, limit })
})

export const POST = withAuth('client', async (req, user) => {
  const body = (await req.json()) as LifeExperimentInput
  const orgId = body.orgId?.trim()
  if (!orgId) return apiError('orgId is required')
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  if (body.ownerId?.trim() && !canAccessOwner(user, body.ownerId.trim())) return apiError('Forbidden', 403)

  try {
    const experiment = buildLifeExperiment({
      ...body,
      orgId,
      ownerId: body.ownerId?.trim() || user.uid,
    }, new Date().toISOString())
    const doc = await adminDb.collection('life_os_experiments').add(experiment)
    return apiSuccess({ ...experiment, id: doc.id }, 201)
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Invalid experiment payload')
  }
})
