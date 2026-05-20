import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { ensureSeoBlockerHandoff, resolveSeoBlockerHandoff } from '@/lib/seo/blocker-handoff'

export const dynamic = 'force-dynamic'

const ALLOWED = ['status', 'assignee', 'description', 'outputArtifactId', 'dueAt', 'blockerReason', 'autopilotEligible'] as const

export const PATCH = withAuth(
  'admin',
  async (req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const body = await req.json().catch(() => null)
    if (!body) return apiError('body required', 400)
    const ref = adminDb.collection('seo_tasks').doc(id)
    const snap = await ref.get()
    if (!snap.exists) return apiError('Task not found', 404)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = snap.data() as any
    if (!canAccessOrg(user, data.orgId)) return apiError('Access denied', 403)
    const update: Record<string, unknown> = { ...lastActorFrom(user) }
    for (const k of ALLOWED) if (k in body) update[k] = body[k]
    await ref.update(update)
    if (body.status === 'blocked') {
      await ensureSeoBlockerHandoff({
        taskId: id,
        reason: typeof body.blockerReason === 'string' ? body.blockerReason : data.blockerReason,
        actor: user,
      })
    } else if (typeof body.status === 'string' && body.status !== 'blocked') {
      await resolveSeoBlockerHandoff(id, user)
    }
    return apiSuccess({ id, updated: Object.keys(update) })
  },
)
