/**
 * GET  /api/v1/admin/email/controls — read platform outbound email controls.
 * POST /api/v1/admin/email/controls — set the pause-outbound kill-switch.
 *   Body: { pauseOutbound: boolean, pauseReason?: string }
 *
 * ENFORCEMENT NOTE: `pauseOutbound` is a global kill-switch. The send path
 * (lib/email/send.ts / lib/broadcasts/send.ts / app/api/cron/sequences) should
 * call `readEmailControls()` and short-circuit when `pauseOutbound === true`.
 * Wiring that guard lives outside this admin feature's scope — see the report.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { readEmailControls, writeEmailControls } from './store'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async () => {
  const controls = await readEmailControls()
  return apiSuccess(controls)
})

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => ({}))
  if (typeof body.pauseOutbound !== 'boolean') {
    return apiError('pauseOutbound (boolean) is required')
  }
  const reason =
    typeof body.pauseReason === 'string' && body.pauseReason.trim()
      ? body.pauseReason.trim().slice(0, 500)
      : null

  const controls = await writeEmailControls({
    pauseOutbound: body.pauseOutbound,
    pauseReason: reason,
    actorUid: user.uid,
  })
  return apiSuccess(controls)
})
