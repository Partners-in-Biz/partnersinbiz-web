import { NextRequest } from 'next/server'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { syncGmailMailboxAccount } from '@/lib/mailbox/gmailSync'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export const POST = withPortalAuthAndRole('member', async (req: NextRequest, uid: string, orgId: string, _role, ctx: Ctx) => {
  try {
    const { id } = await ctx.params
    const body = await req.json().catch(() => ({}))
    const mode = body.mode === 'backfill' ? 'backfill' : 'incremental'
    const maxResults = Number.isFinite(Number(body.maxResults)) ? Number(body.maxResults) : undefined
    const result = await syncGmailMailboxAccount({
      orgId,
      uid,
      accountId: id,
      mode,
      maxResults,
    })
    if (!result.ok && result.needsReconnect) return apiError(result.error ?? 'Reconnect this Google mailbox account', 409, { result })
    if (!result.ok) return apiError(result.error ?? 'Failed to sync Google mailbox account', 400, { result })
    return apiSuccess({ result })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
