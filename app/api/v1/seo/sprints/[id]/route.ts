import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

const ALLOWED_PATCH_FIELDS = [
  'autopilotMode',
  'autopilotTaskTypes',
  'siteName',
  'status',
  'integrations',
] as const

export const GET = withAuth(
  'admin',
  async (_req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const snap = await adminDb.collection('seo_sprints').doc(id).get()
    if (!snap.exists) return apiError('Sprint not found', 404)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = snap.data() as any
    if (data.deleted) return apiError('Sprint not found', 404)
    if (!canAccessOrg(user, data.orgId)) return apiError('Access denied', 403)
    return apiSuccess({ id: snap.id, ...data })
  },
)

export const PATCH = withAuth(
  'admin',
  async (req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const body = await req.json().catch(() => null)
    if (!body) return apiError('body required', 400)
    const ref = adminDb.collection('seo_sprints').doc(id)
    const snap = await ref.get()
    if (!snap.exists) return apiError('Sprint not found', 404)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = snap.data() as any
    if (!canAccessOrg(user, data.orgId)) return apiError('Access denied', 403)
    const update: Record<string, unknown> = { ...lastActorFrom(user) }
    for (const k of ALLOWED_PATCH_FIELDS) if (k in body) update[k] = body[k]
    await ref.update(update)
    return apiSuccess({ id, updated: Object.keys(update) })
  },
)
