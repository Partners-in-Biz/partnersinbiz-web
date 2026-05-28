import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess } from '@/lib/api/response'
import { buildCrmOsDashboard } from '@/lib/crm/os-dashboard'

export const dynamic = 'force-dynamic'

export const GET = withCrmAuth('member', async (_req, ctx) => {
  return apiSuccess(await buildCrmOsDashboard(ctx.orgId))
})
