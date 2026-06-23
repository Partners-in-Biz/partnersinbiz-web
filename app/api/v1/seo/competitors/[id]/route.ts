import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { removeCompetitor } from '@/lib/seo/competitors'

export const dynamic = 'force-dynamic'

/** DELETE /api/v1/seo/competitors/[id] — stop tracking a competitor. */
export const DELETE = withAuth(
  'admin',
  async (_req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    if (user.role !== 'ai' && !user.orgId) return apiError('Forbidden', 403)
    const ok = await removeCompetitor(id, user.orgId ?? '', user.role === 'ai')
    if (!ok) return apiError('Competitor not found', 404)
    return apiSuccess({ id })
  },
)
