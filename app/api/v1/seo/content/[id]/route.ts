import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import { logActivity } from '@/lib/activity/log'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

const ALLOWED = ['title', 'type', 'targetKeywordId', 'targetUrl', 'publishDate', 'status', 'liUrl', 'xUrl', 'internalLinksAdded', 'phase', 'campaignId', 'pillarId', 'heroImageUrl', 'draftPostId'] as const

export const PATCH = withAuth(
  'admin',
  async (req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const body = await req.json().catch(() => null)
    if (!body) return apiError('body required', 400)
    const ref = adminDb.collection('seo_content').doc(id)
    const snap = await ref.get()
    if (!snap.exists) return apiError('Content not found', 404)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = snap.data() as any
    if (user.role !== 'ai' && data.orgId !== user.orgId) return apiError('Access denied', 403)
    const update: Record<string, unknown> = { ...lastActorFrom(user) }
    for (const k of ALLOWED) if (k in body) update[k] = body[k]
    await ref.update(update)
    logActivity({
      orgId: data.orgId,
      type: 'seo_content_updated',
      actorId: user.uid,
      actorName: user.uid,
      actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
      description: 'Updated SEO content',
      entityId: id,
      entityType: 'seo_content',
    }).catch(() => {})
    return apiSuccess({ id, updated: Object.keys(update) })
  },
)
