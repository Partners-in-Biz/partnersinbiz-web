import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import { DeadLetterReplayError, replaySequenceDeadLetter } from '@/lib/sequences/dead-letter-replay'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string; enrollmentId: string }> }

export const POST = withCrmAuth<RouteCtx>('admin', async (req, ctx, routeCtx) => {
  const { id, enrollmentId } = await routeCtx!.params
  const replayKey = req.headers.get('idempotency-key')?.trim() ?? ''
  if (replayKey.length < 8 || replayKey.length > 200) {
    return apiError('A valid Idempotency-Key header is required', 400)
  }
  try {
    const result = await replaySequenceDeadLetter({
      orgId: ctx.orgId,
      sequenceId: id,
      enrollmentId,
      replayKey,
      actor: ctx.actor,
    })
    return apiSuccess(result)
  } catch (error) {
    if (error instanceof DeadLetterReplayError) return apiError(error.message, error.status)
    console.error('[sequence-dead-letter-replay-error]', error)
    return apiError('Failed to replay sequence enrollment', 500)
  }
})
