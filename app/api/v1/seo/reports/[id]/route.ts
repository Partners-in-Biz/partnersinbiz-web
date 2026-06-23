import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

/** DELETE /api/v1/seo/reports/[id] — soft-delete a saved report. */
export const DELETE = withAuth(
  'admin',
  async (_req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const ref = adminDb.collection('seo_reports').doc(id)
    const snap = await ref.get()
    if (!snap.exists) return apiError('Report not found', 404)
    const data = snap.data() as { orgId?: string }
    if (user.role !== 'ai' && data.orgId !== user.orgId) return apiError('Forbidden', 403)
    await ref.update({ deleted: true })
    return apiSuccess({ id })
  },
)
