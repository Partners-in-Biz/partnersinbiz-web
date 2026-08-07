import { apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { listPartnerLinks, listPartnerInvites } from '@/lib/partner-links/store'

export const dynamic = 'force-dynamic'

/**
 * Combined view for the portal Partners surface: established links plus the
 * invitations still in flight.
 */
export const GET = withCrmAuth('viewer', async (_req, ctx) => {
  try {
    const [links, invites] = await Promise.all([
      listPartnerLinks(ctx.orgId),
      listPartnerInvites(ctx.orgId, { limit: 200 }),
    ])
    return apiSuccess({
      links,
      invites: invites
        .filter((i) => i.status === 'pending' || i.status === 'declined')
        .map((invite) => ({ ...invite, inviteToken: undefined })),
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
