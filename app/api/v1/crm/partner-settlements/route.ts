import { apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { listPartnerSettlements } from '@/lib/partner-links/settlement'

export const dynamic = 'force-dynamic'

/** Partner invoices this org is owed (receivable) and owes (payable). */
export const GET = withCrmAuth('viewer', async (_req, ctx: CrmAuthContext) => {
  try {
    return apiSuccess(await listPartnerSettlements(ctx.orgId))
  } catch (err) {
    return apiErrorFromException(err)
  }
})
