import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { resolveTwilioOrg } from '@/lib/twilio/org-client'
import { lookupPhoneNumber } from '@/lib/twilio/lookup-verify'
import { normalizeToE164 } from '@/lib/sms/segments'

export const dynamic = 'force-dynamic'

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
  const scope = resolveOrgScope(user, typeof body.orgId === 'string' ? body.orgId.trim() : null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const phoneRaw = typeof body.phone === 'string' ? body.phone.trim() : ''
  if (!phoneRaw) return apiError('phone is required', 400)
  const phone = phoneRaw.startsWith('+') ? phoneRaw : normalizeToE164(phoneRaw, 'ZA') || phoneRaw

  const resolved = await resolveTwilioOrg(scope.orgId, { allowPlatformFallback: false })
  if (!resolved) return apiError('Connect Twilio credentials for this organisation first', 400)

  try {
    const result = await lookupPhoneNumber(resolved, phone)
    if (!result.ok) return apiError(result.error || 'Lookup failed', 400)
    return apiSuccess({ lookup: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lookup failed'
    return apiError(message, 400)
  }
})
