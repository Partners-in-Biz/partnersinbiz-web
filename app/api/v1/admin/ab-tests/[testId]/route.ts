import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { buildAbTestDetailSurface } from '@/lib/admin/backlog-surfaces'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (_req, user, context?: { params: Promise<{ testId: string }> }) => {
  const { testId } = await context!.params
  return apiSuccess(await buildAbTestDetailSurface(user, testId))
})
