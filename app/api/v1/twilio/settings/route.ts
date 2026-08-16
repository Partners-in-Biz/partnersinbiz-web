import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  getOrgCredentialSummary,
  saveOrgTwilioCredentials,
} from '@/lib/communications/store'
import {
  verifyTwilioCredentials,
  type TwilioProviderCredentials,
} from '@/lib/communications/credentials'
import { listOrgTwilioNumbers } from '@/lib/twilio/sms'
import { resolveTwilioOrg } from '@/lib/twilio/org-client'
import { voiceWebhookUrls } from '@/lib/twilio/voice'

export const dynamic = 'force-dynamic'

/**
 * GET — redacted Twilio connection summary + webhook URLs + owned numbers.
 */
export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)

  const summary = await getOrgCredentialSummary(scope.orgId)
  let numbers: Awaited<ReturnType<typeof listOrgTwilioNumbers>> = []
  try {
    numbers = await listOrgTwilioNumbers(scope.orgId)
  } catch {
    numbers = []
  }

  return apiSuccess({
    credential: summary,
    webhooks: voiceWebhookUrls(scope.orgId),
    messagingWebhook: `/api/v1/communications/webhooks/twilio?orgId=${encodeURIComponent(scope.orgId)}`,
    smsStatusWebhook: `/api/v1/sms/status-webhook?orgId=${encodeURIComponent(scope.orgId)}`,
    numbers,
    setup: {
      voiceTwimlAppHint:
        'Create a TwiML App in Twilio Console → Voice. Set Voice Request URL to the voice webhook below (POST).',
      apiKeyHint: 'Create an API Key (SID + Secret) for browser softphone Access Tokens.',
      verifyHint: 'Create a Verify Service and paste the VA… SID to enable OTP.',
    },
  })
})

/**
 * PUT — save / merge org Twilio credentials (BYOK). Never echoes secrets.
 */
export const PUT = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
  const scope = resolveOrgScope(user, typeof body.orgId === 'string' ? body.orgId.trim() : null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const credentials = (body.credentials && typeof body.credentials === 'object'
    ? body.credentials
    : {}) as Record<string, unknown>

  const pick = (key: string) =>
    typeof credentials[key] === 'string' ? String(credentials[key]).trim() : undefined

  const incoming: Partial<TwilioProviderCredentials> = {
    accountSid: pick('accountSid'),
    authToken: pick('authToken'),
    messagingServiceSid: pick('messagingServiceSid'),
    whatsappFrom: pick('whatsappFrom'),
    defaultFromNumber: pick('defaultFromNumber'),
    voiceCallerId: pick('voiceCallerId'),
    apiKeySid: pick('apiKeySid'),
    apiKeySecret: pick('apiKeySecret'),
    twimlAppSid: pick('twimlAppSid'),
    verifyServiceSid: pick('verifyServiceSid'),
  }

  // Require SID+token on first connect; merges allow omitting them later.
  const existing = await resolveTwilioOrg(scope.orgId, { allowPlatformFallback: false })
  if (!existing && (!incoming.accountSid || !incoming.authToken)) {
    return apiError('Twilio Account SID and Auth Token are required', 400)
  }

  const toVerify: TwilioProviderCredentials = {
    accountSid: incoming.accountSid || existing!.credentials.accountSid,
    authToken: incoming.authToken || existing!.credentials.authToken,
    ...incoming,
  }

  try {
    await verifyTwilioCredentials(toVerify)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Twilio verification failed'
    return apiError(message, 400)
  }

  const config = body.config && typeof body.config === 'object' ? body.config as {
    recordCallsByDefault?: boolean
    inboundNumbers?: string[]
  } : undefined

  const { summary } = await saveOrgTwilioCredentials(scope.orgId, incoming, {
    verified: true,
    config: config
      ? {
          recordCallsByDefault: config.recordCallsByDefault,
          inboundNumbers: Array.isArray(config.inboundNumbers)
            ? config.inboundNumbers.filter((n): n is string => typeof n === 'string')
            : undefined,
        }
      : undefined,
  })

  return apiSuccess({
    credential: summary,
    webhooks: voiceWebhookUrls(scope.orgId),
  })
})
