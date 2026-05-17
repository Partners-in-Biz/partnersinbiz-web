// app/api/v1/ads/linkedin/accounts/route.ts
//
// Lists LinkedIn ad accounts the connection has access to. Mirrors
// /api/v1/ads/google/customers — fetches via the provider helper.
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import { listAdAccounts } from '@/lib/ads/providers/linkedin/accounts'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req: NextRequest) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  try {
    const conn = await getConnection({ orgId, platform: 'linkedin' })
    if (!conn) return apiError('No LinkedIn ads connection for org', 400)
    const accessToken = decryptAccessToken(conn)
    const accounts = await listAdAccounts({ accessToken })
    return apiSuccess({ accounts })
  } catch (err) {
    return apiError((err as Error).message ?? 'List failed', 500)
  }
})
