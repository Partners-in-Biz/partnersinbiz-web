import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { listChannelAccounts, listQueues, listRoutingRules, saveOrgTwilioCredentials, upsertChannelAccount, recordCommunicationEvent } from '@/lib/communications/store'
import { communicationProviders, getCommunicationProvider } from '@/lib/communications/providers'
import { verifyTwilioCredentials, type TwilioProviderCredentials } from '@/lib/communications/credentials'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)
  const [accounts, queues, routingRules] = await Promise.all([
    listChannelAccounts(scope.orgId),
    listQueues(scope.orgId),
    listRoutingRules(scope.orgId),
  ])
  return apiSuccess({
    accounts: accounts.items,
    queues: queues.items,
    routingRules: routingRules.items,
    providers: communicationProviders.map((provider) => ({
      id: provider.id,
      name: provider.name,
      supports: provider.supports,
      readiness: provider.getReadiness(),
    })),
  })
})

/**
 * POST — org-admin onboarding flow: "Connect WhatsApp Business".
 * Accepts Twilio credentials (encrypted at rest), verifies them against
 * Twilio, and creates/updates the org's WhatsApp ChannelAccount as `ready`.
 * Credentials are NEVER echoed in the response or logs.
 */
export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
  const scope = resolveOrgScope(user, typeof body.orgId === 'string' ? body.orgId.trim() : null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const providerId = body.providerId === 'twilio' ? 'twilio' : null
  if (!providerId) return apiError('Only the Twilio provider can be connected in V1', 400)
  const channel =
    body.channel === 'whatsapp' || body.channel === 'sms' || body.channel === 'voice'
      ? body.channel
      : null
  if (!channel) return apiError('channel must be whatsapp, sms, or voice', 400)

  const credentials = body.credentials && typeof body.credentials === 'object'
    ? body.credentials as Record<string, unknown>
    : null
  if (!credentials) return apiError('Twilio credentials are required', 400)

  const accountSid = typeof credentials.accountSid === 'string' ? credentials.accountSid.trim() : ''
  const authToken = typeof credentials.authToken === 'string' ? credentials.authToken.trim() : ''
  const messagingServiceSid = typeof credentials.messagingServiceSid === 'string' ? credentials.messagingServiceSid.trim() : ''
  const whatsappFrom = typeof credentials.whatsappFrom === 'string' ? credentials.whatsappFrom.trim() : ''
  const defaultFromNumber = typeof credentials.defaultFromNumber === 'string' ? credentials.defaultFromNumber.trim() : ''
  const voiceCallerId = typeof credentials.voiceCallerId === 'string' ? credentials.voiceCallerId.trim() : ''
  const apiKeySid = typeof credentials.apiKeySid === 'string' ? credentials.apiKeySid.trim() : ''
  const apiKeySecret = typeof credentials.apiKeySecret === 'string' ? credentials.apiKeySecret.trim() : ''
  const twimlAppSid = typeof credentials.twimlAppSid === 'string' ? credentials.twimlAppSid.trim() : ''
  const verifyServiceSid = typeof credentials.verifyServiceSid === 'string' ? credentials.verifyServiceSid.trim() : ''

  if (!accountSid || !authToken) return apiError('Twilio Account SID and Auth Token are required', 400)
  if (channel === 'whatsapp' && !whatsappFrom) {
    return apiError('A WhatsApp sender number is required to connect WhatsApp', 400)
  }
  if (channel === 'sms' && !messagingServiceSid && !defaultFromNumber) {
    return apiError('Messaging Service SID or default from number is required for SMS', 400)
  }
  if (channel === 'voice' && (!apiKeySid || !apiKeySecret || !twimlAppSid || !(voiceCallerId || defaultFromNumber))) {
    return apiError('Voice requires API Key SID/Secret, TwiML App SID, and a voice caller ID', 400)
  }

  const creds: TwilioProviderCredentials = {
    accountSid,
    authToken,
    messagingServiceSid: messagingServiceSid || undefined,
    whatsappFrom: whatsappFrom || undefined,
    defaultFromNumber: defaultFromNumber || undefined,
    voiceCallerId: voiceCallerId || undefined,
    apiKeySid: apiKeySid || undefined,
    apiKeySecret: apiKeySecret || undefined,
    twimlAppSid: twimlAppSid || undefined,
    verifyServiceSid: verifyServiceSid || undefined,
  }

  // Verify against Twilio before persisting anything.
  try {
    await verifyTwilioCredentials(creds)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Twilio verification failed'
    return apiError(message, 400)
  }

  const { summary } = await saveOrgTwilioCredentials(scope.orgId, creds, { verified: true })

  const provider = getCommunicationProvider('twilio')
  const readiness = provider?.getReadiness(process.env, {
    accountSid,
    authToken,
    messagingServiceSid: messagingServiceSid || undefined,
    from: whatsappFrom || defaultFromNumber || voiceCallerId || undefined,
  }) ?? {
    configured: true,
    healthy: true,
    missing: [],
    checks: [],
  }

  const phoneNumber =
    channel === 'whatsapp'
      ? whatsappFrom
      : channel === 'voice'
        ? (voiceCallerId || defaultFromNumber)
        : (defaultFromNumber || messagingServiceSid || '')
  const senderId =
    channel === 'whatsapp'
      ? `whatsapp:${whatsappFrom.replace(/^whatsapp:/i, '')}`
      : channel === 'voice'
        ? `voice:${phoneNumber}`
        : `sms:${phoneNumber || messagingServiceSid}`
  const displayName =
    channel === 'whatsapp'
      ? `WhatsApp Business ${whatsappFrom}`
      : channel === 'voice'
        ? `Twilio Voice ${phoneNumber}`
        : `Twilio SMS ${phoneNumber || messagingServiceSid}`

  const { id: accountId, account } = await upsertChannelAccount(scope.orgId, {
    channel,
    providerId: 'twilio',
    displayName,
    senderId,
    phoneNumber: phoneNumber || undefined,
    externalAccountId: accountSid,
    status: 'ready',
    credentialRef: {
      kind: 'org',
      provider: 'twilio',
      status: 'ready',
      hasCredentials: true,
      accountSidMasked: summary.accountSidMasked,
      messagingServiceSidMasked: summary.messagingServiceSidMasked,
      webhookPath: channel === 'voice'
        ? '/api/v1/twilio/voice/webhook'
        : '/api/v1/communications/webhooks/twilio',
      connectedAt: new Date().toISOString(),
    },
    readiness,
  })

  await recordCommunicationEvent(scope.orgId, {
    type: 'credential.connected',
    channel,
    payload: {
      provider: 'twilio',
      accountId,
      accountSidMasked: summary.accountSidMasked,
      connectedChannel: channel,
    },
  })

  return apiSuccess({
    accountId,
    status: account.status,
    credential: summary,
    readiness: account.readiness,
    webhookPath: channel === 'voice'
      ? '/api/v1/twilio/voice/webhook'
      : '/api/v1/communications/webhooks/twilio',
  }, 201)
})
