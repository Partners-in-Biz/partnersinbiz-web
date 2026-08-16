import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { resolveTwilioOrg } from '@/lib/twilio/org-client'
import { checkVerification, sendVerification } from '@/lib/twilio/lookup-verify'
import { normalizeToE164 } from '@/lib/sms/segments'

export const dynamic = 'force-dynamic'

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
  const scope = resolveOrgScope(user, typeof body.orgId === 'string' ? body.orgId.trim() : null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const action = body.action === 'check' ? 'check' : 'send'
  const phoneRaw = typeof body.to === 'string' ? body.to.trim() : ''
  if (!phoneRaw) return apiError('to is required', 400)
  const to = phoneRaw.startsWith('+') ? phoneRaw : normalizeToE164(phoneRaw, 'ZA') || phoneRaw

  const resolved = await resolveTwilioOrg(scope.orgId, { allowPlatformFallback: false })
  if (!resolved) return apiError('Connect Twilio credentials for this organisation first', 400)

  try {
    if (action === 'send') {
      const channel = body.channel === 'call' || body.channel === 'whatsapp' ? body.channel : 'sms'
      const result = await sendVerification(resolved, { to, channel })
      if (!result.ok) return apiError(result.error || 'Verify send failed', 400)
      return apiSuccess({ verification: result })
    }

    const code = typeof body.code === 'string' ? body.code.trim() : ''
    if (!code) return apiError('code is required', 400)
    const result = await checkVerification(resolved, { to, code })
    if (!result.ok && result.error) return apiError(result.error, 400)
    return apiSuccess({ verification: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Verify failed'
    return apiError(message, 400)
  }
})
