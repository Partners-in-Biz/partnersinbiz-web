// app/api/v1/recurring-schedules/route.ts
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { restrictedAdminOrgIds } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? 'active'

  let query = adminDb.collection('recurring_schedules').orderBy('createdAt', 'desc') as any
  if (status !== 'all') query = query.where('status', '==', status)
  const allowedOrgIds = restrictedAdminOrgIds(user)
  if (user.role === 'admin' && allowedOrgIds.length > 0 && allowedOrgIds.length <= 30) {
    query = query.where('orgId', 'in', allowedOrgIds)
  }

  const snap = await query.limit(100).get()
  const schedules = snap.docs
    .map((doc: any) => ({ id: doc.id, ...doc.data() }))
    .filter((schedule: any) => allowedOrgIds.length === 0 || allowedOrgIds.includes(String(schedule.orgId ?? '')))
  return apiSuccess(schedules)
})
