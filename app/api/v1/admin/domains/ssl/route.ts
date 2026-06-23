import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { buildSslSurface } from '@/lib/admin/backlog-surfaces'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (_req, user) => apiSuccess(await buildSslSurface(user)))
