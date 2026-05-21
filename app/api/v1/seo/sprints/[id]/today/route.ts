import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { refreshTodayPlan } from '@/lib/seo/loops/daily'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  'admin',
  async (_req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const ref = adminDb.collection('seo_sprints').doc(id)
    let snap = await ref.get()
    if (!snap.exists) return apiError('Sprint not found', 404)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data = snap.data() as any
    if (user.role !== 'ai' && data.orgId !== user.orgId) return apiError('Access denied', 403)
    await refreshTodayPlan(id, data.currentWeek ?? 0)
    snap = await ref.get()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data = snap.data() as any
    return apiSuccess(data.todayPlan ?? null)
  },
)
