import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { syncGmailMailboxAccount } from '@/lib/mailbox/gmailSync'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (req: NextRequest, user, ctx: Ctx) => {
  try {
    const { id } = await ctx.params
    const body = await req.json().catch(() => ({}))
    const mode = body.mode === 'backfill' ? 'backfill' : 'incremental'
    const maxResults = Number.isFinite(Number(body.maxResults)) ? Number(body.maxResults) : undefined
    const result = await syncGmailMailboxAccount({
      orgId: PIB_PLATFORM_ORG_ID,
      uid: user.uid,
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
