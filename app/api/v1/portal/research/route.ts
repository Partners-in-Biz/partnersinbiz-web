import { NextRequest } from 'next/server'

import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiSuccess } from '@/lib/api/response'
import { listResearchItems, validateResearchFilters } from '@/lib/research/store'
import { apiError } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

export const GET = withPortalAuthAndRole('viewer', async (req: NextRequest, _uid: string, orgId: string) => {
  const filters = validateResearchFilters(req.nextUrl.searchParams)
  if (!filters.ok) return apiError(filters.error, 400)

  const items = await listResearchItems({
    orgId,
    ...filters.filters,
    visibility: 'client_visible',
  })
  return apiSuccess(items)
})
