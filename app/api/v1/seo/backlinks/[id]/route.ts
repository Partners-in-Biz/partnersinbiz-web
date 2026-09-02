import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import type { ApiUser } from '@/lib/api/types'
import { clientVisibilityFieldsForWrite } from '@/lib/work-scope'

export const dynamic = 'force-dynamic'

const ALLOWED = ['source', 'domain', 'type', 'theirDR', 'status', 'submittedAt', 'liveAt', 'url', 'notes'] as const

export const PATCH = withAuth(
  'admin',
  async (req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const body = await req.json().catch(() => null)
    if (!body) return apiError('body required', 400)
    const ref = adminDb.collection('seo_backlinks').doc(id)
    const snap = await ref.get()
    if (!snap.exists) return apiError('Backlink not found', 404)
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
