import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { withIdempotency } from '@/lib/api/idempotency'
import { apiSuccess } from '@/lib/api/response'
import { runOptimizationLoopForSprint } from '@/lib/seo/loops/optimization'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

export const POST = withAuth(
  'admin',
  withIdempotency(async (_req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const result = await runOptimizationLoopForSprint(id, user)
    return apiSuccess(result)
  }),
)
