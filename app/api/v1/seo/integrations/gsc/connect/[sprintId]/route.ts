import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withIdempotency } from '@/lib/api/idempotency'
import { apiSuccess, apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

export const POST = withAuth(
  'admin',
  withIdempotency(async (req: NextRequest, user: ApiUser, ctx: { params: Promise<{ sprintId: string }> }) => {
    const { sprintId } = await ctx.params
    const body = await req.json().catch(() => null)
    if (!body?.propertyUrl) return apiError('propertyUrl is required', 400)
    const ref = adminDb.collection('seo_sprints').doc(sprintId)
    const snap = await ref.get()
    if (!snap.exists) return apiError('Sprint not found', 404)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = snap.data() as any
    if (!canAccessOrg(user, data.orgId)) return apiError('Access denied', 403)
    await ref.update({ 'integrations.gsc.propertyUrl': body.propertyUrl })
    return apiSuccess({ sprintId, propertyUrl: body.propertyUrl })
  }),
)
