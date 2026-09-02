import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import { clientVisibilityFieldsForWrite } from '@/lib/work-scope'

export const dynamic = 'force-dynamic'

const ALLOWED = ['keyword', 'volume', 'topThreeDR', 'intentBucket', 'targetPageUrl', 'status'] as const

export const PATCH = withAuth(
  'admin',
  async (req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const body = await req.json().catch(() => null)
    if (!body) return apiError('body required', 400)
    const ref = adminDb.collection('seo_keywords').doc(id)
    const snap = await ref.get()
    if (!snap.exists) return apiError('Keyword not found', 404)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = snap.data() as any
    if (user.role !== 'ai' && data.orgId !== user.orgId) return apiError('Access denied', 403)
    const update: Record<string, unknown> = { ...lastActorFrom(user) }
    for (const k of ALLOWED) if (k in body) update[k] = body[k]
    if ('clientVisibility' in body) Object.assign(update, clientVisibilityFieldsForWrite(body.clientVisibility))
    await ref.update(update)
    return apiSuccess({ id, updated: Object.keys(update) })
  },
)

export const DELETE = withAuth(
  'admin',
  async (req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const force = new URL(req.url).searchParams.get('force') === 'true'
    const ref = adminDb.collection('seo_keywords').doc(id)
    const snap = await ref.get()
    if (!snap.exists) return apiError('Keyword not found', 404)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = snap.data() as any
    if (user.role !== 'ai' && data.orgId !== user.orgId) return apiError('Access denied', 403)
    if (force) await ref.delete()
    else await ref.update({ deleted: true, deletedAt: FieldValue.serverTimestamp(), ...lastActorFrom(user) })
    return apiSuccess({ id, deleted: true, force })
  },
)
