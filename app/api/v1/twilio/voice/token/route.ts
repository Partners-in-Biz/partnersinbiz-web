import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { resolveTwilioOrg } from '@/lib/twilio/org-client'
import { createVoiceAccessToken } from '@/lib/twilio/voice'
import { upsertTwilioCall } from '@/lib/twilio/calls'
import { normalizeToE164 } from '@/lib/sms/segments'

export const dynamic = 'force-dynamic'

/**
 * POST — mint a browser Voice Access Token for the signed-in user.
 * Optional: pre-create a call record when dialing a contact.
 */
export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
  const scope = resolveOrgScope(user, typeof body.orgId === 'string' ? body.orgId.trim() : null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const resolved = await resolveTwilioOrg(scope.orgId, { allowPlatformFallback: false })
  if (!resolved) return apiError('Connect Twilio credentials for this organisation first', 400)

  try {
    const identity = `user_${user.uid}`
    const token = createVoiceAccessToken(resolved, { identity })

    let callId: string | null = null
    const toRaw = typeof body.to === 'string' ? body.to.trim() : ''
    const contactId = typeof body.contactId === 'string' ? body.contactId.trim() : null
    if (toRaw) {
      const to = toRaw.startsWith('+') || toRaw.startsWith('client:')
        ? toRaw
        : normalizeToE164(toRaw, 'ZA') || toRaw
      const created = await upsertTwilioCall({
        orgId: scope.orgId,
        direction: 'outbound',
        status: 'queued',
        from: token.callerId,
        to,
        contactId,
        dealId: typeof body.dealId === 'string' ? body.dealId.trim() : null,
        userId: user.uid,
        metadata: { identity, pending: true },
      })
      callId = created.id
    }

    return apiSuccess({
      token: token.token,
      identity: token.identity,
      ttlSeconds: token.ttlSeconds,
      callerId: token.callerId,
      callId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create voice token'
    return apiError(message, 400)
  }
})
