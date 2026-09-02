import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import type { ApiUser } from '@/lib/api/types'
import { requireSprintAccess } from '@/lib/seo/tenant'
import { clientVisibilityFieldsForWrite } from '@/lib/work-scope'

export const dynamic = 'force-dynamic'

const ALLOWED_PATCH_FIELDS = [
  'autopilotMode',
  'autopilotTaskTypes',
  'siteName',
  'status',
  'integrations',
  'clientVisibility',
] as const

export const GET = withAuth(
  'admin',
  async (_req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    try {
      const sprint = await requireSprintAccess(id, user)
      return apiSuccess(sprint)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Access denied'
      return apiError(message, message.includes('not found') ? 404 : 403)
    }
  },
)

export const PATCH = withAuth(
  'admin',
  async (req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const body = await req.json().catch(() => null)
    if (!body) return apiError('body required', 400)
    let sprint: Awaited<ReturnType<typeof requireSprintAccess>>
    try {
      sprint = await requireSprintAccess(id, user)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Access denied'
      return apiError(message, message.includes('not found') ? 404 : 403)
    }
    if (sprint.accessMode === 'projected') {
      return apiError('Projected viewers cannot edit sprint settings', 403)
    }
    const ref = adminDb.collection('seo_sprints').doc(id)
    const update: Record<string, unknown> = { ...lastActorFrom(user) }
    for (const k of ALLOWED_PATCH_FIELDS) {
      if (k === 'clientVisibility' && k in body) {
        Object.assign(update, clientVisibilityFieldsForWrite(body.clientVisibility))
        continue
      }
      if (k in body) update[k] = body[k]
    }
    await ref.update(update)
    return apiSuccess({ id, updated: Object.keys(update) })
  },
)
