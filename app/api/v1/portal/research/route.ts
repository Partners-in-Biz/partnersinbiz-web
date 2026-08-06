import { NextRequest } from 'next/server'

import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiSuccess } from '@/lib/api/response'
import { listResearchItems, validateResearchFilters } from '@/lib/research/store'
import { filterOwnedRowsForActor } from '@/lib/orgMembers/record-scope'
import type { ApiUser } from '@/lib/api/types'
import { apiError } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

export const GET = withPortalAuthAndRole('viewer', async (req: NextRequest, uid: string, orgId: string) => {
  const filters = validateResearchFilters(req.nextUrl.searchParams)
  if (!filters.ok) return apiError(filters.error, 400)

  const items = await listResearchItems({
    orgId,
    ...filters.filters,
    visibility: 'client_visible',
  })
  // Record scope comes from the orgMembers membership row (portal middleware
  // has already vetted org access). Platform admins without an orgMembers row
  // and owners/full-access members resolve 'all' and pass through unchanged.
  const portalUser: ApiUser = { uid, role: 'client', orgId, orgIds: [orgId] }
  const scopedItems = await filterOwnedRowsForActor(portalUser, orgId, 'research', items)
  return apiSuccess(scopedItems)
})
