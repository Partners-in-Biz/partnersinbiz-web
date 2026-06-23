import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { buildReportTemplatesSurface } from '@/lib/admin/backlog-surfaces'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async () => apiSuccess(await buildReportTemplatesSurface()))
