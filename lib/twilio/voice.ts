/**
 * Org Twilio Voice helpers: Access Tokens, TwiML, recording hooks.
 */
import twilio from 'twilio'
import { assertCapability, appBaseUrl, type ResolvedTwilioOrg } from './org-client'

const AccessToken = twilio.jwt.AccessToken
const VoiceGrant = AccessToken.VoiceGrant

export interface VoiceTokenResult {
  token: string
  identity: string
  ttlSeconds: number
  callerId: string
}

export function createVoiceAccessToken(
  resolved: ResolvedTwilioOrg,
  input: { identity: string; ttlSeconds?: number },
): VoiceTokenResult {
  assertCapability(resolved, 'voice')
  const { credentials } = resolved
  const ttl = Math.min(Math.max(input.ttlSeconds ?? 3600, 60), 24 * 3600)
  const identity = input.identity.trim() || `user_${Date.now()}`
  const token = new AccessToken(
    credentials.accountSid,
    credentials.apiKeySid!,
    credentials.apiKeySecret!,
    { identity, ttl },
  )
  const grant = new VoiceGrant({
    outgoingApplicationSid: credentials.twimlAppSid!,
    incomingAllow: true,
  })
  token.addGrant(grant)
  const callerId = (credentials.voiceCallerId || credentials.defaultFromNumber || '').trim()
  return {
    token: token.toJwt(),
    identity,
    ttlSeconds: ttl,
    callerId,
  }
}

export function buildOutboundDialTwiml(input: {
  to: string
  callerId: string
  record: boolean
  statusCallbackUrl: string
  recordingStatusCallbackUrl: string
}): string {
  const response = new twilio.twiml.VoiceResponse()
  const dialAttrs: Record<string, string> = {
    callerId: input.callerId,
    answerOnBridge: 'true',
    statusCallback: input.statusCallbackUrl,
    statusCallbackEvent: 'initiated ringing answered completed',
    statusCallbackMethod: 'POST',
  }
  if (input.record) {
    dialAttrs.record = 'record-from-answer-dual'
    dialAttrs.recordingStatusCallback = input.recordingStatusCallbackUrl
    dialAttrs.recordingStatusCallbackMethod = 'POST'
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dial = response.dial(dialAttrs as any)
  const to = input.to.trim()
  if (to.startsWith('client:')) {
    dial.client(to.replace(/^client:/, ''))
  } else {
    dial.number(to)
  }
  return response.toString()
}

export function buildInboundDialTwiml(input: {
  clientIdentity: string
  record: boolean
  statusCallbackUrl: string
  recordingStatusCallbackUrl: string
}): string {
  const response = new twilio.twiml.VoiceResponse()
  const dialAttrs: Record<string, string> = {
    answerOnBridge: 'true',
    statusCallback: input.statusCallbackUrl,
    statusCallbackEvent: 'initiated ringing answered completed',
    statusCallbackMethod: 'POST',
  }
  if (input.record) {
    dialAttrs.record = 'record-from-answer-dual'
    dialAttrs.recordingStatusCallback = input.recordingStatusCallbackUrl
    dialAttrs.recordingStatusCallbackMethod = 'POST'
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dial = response.dial(dialAttrs as any)
  dial.client(input.clientIdentity)
  return response.toString()
}

export function buildRejectTwiml(message?: string): string {
  const response = new twilio.twiml.VoiceResponse()
  if (message) response.say({ voice: 'alice' }, message)
  response.hangup()
  return response.toString()
}

export function voiceWebhookUrls(orgId: string): {
  voiceUrl: string
  statusUrl: string
  recordingUrl: string
} {
  const base = appBaseUrl()
  const q = `orgId=${encodeURIComponent(orgId)}`
  return {
    voiceUrl: `${base}/api/v1/twilio/voice/webhook?${q}`,
    statusUrl: `${base}/api/v1/twilio/voice/status?${q}`,
    recordingUrl: `${base}/api/v1/twilio/voice/recording?${q}`,
  }
}
