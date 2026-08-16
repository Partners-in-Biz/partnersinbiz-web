/**
 * Resolve a Twilio REST client for an organisation.
 * Prefers encrypted per-org credentials; optionally falls back to platform env.
 */
import twilio from 'twilio'
import {
  getOrgTwilioConfig,
  getOrgTwilioCredentials,
} from '@/lib/communications/store'
import type { TwilioOrgConfig, TwilioProviderCredentials } from '@/lib/communications/credentials'
import { computeTwilioCapabilities } from '@/lib/communications/credentials'

export interface ResolvedTwilioOrg {
  orgId: string
  credentials: TwilioProviderCredentials
  config: TwilioOrgConfig
  client: twilio.Twilio
  source: 'org' | 'platform'
}

function platformCredentials(): TwilioProviderCredentials | null {
  const accountSid = (process.env.TWILIO_ACCOUNT_SID ?? '').trim()
  const authToken = (process.env.TWILIO_AUTH_TOKEN ?? '').trim()
  if (!accountSid || !authToken) return null
  return {
    accountSid,
    authToken,
    messagingServiceSid: (process.env.TWILIO_MESSAGING_SERVICE_SID ?? '').trim() || undefined,
    whatsappFrom: (process.env.TWILIO_WHATSAPP_FROM ?? '').trim() || undefined,
    defaultFromNumber: (process.env.TWILIO_DEFAULT_FROM_NUMBER ?? '').trim() || undefined,
    voiceCallerId: (process.env.TWILIO_VOICE_CALLER_ID ?? process.env.TWILIO_DEFAULT_FROM_NUMBER ?? '').trim() || undefined,
    apiKeySid: (process.env.TWILIO_API_KEY_SID ?? '').trim() || undefined,
    apiKeySecret: (process.env.TWILIO_API_KEY_SECRET ?? '').trim() || undefined,
    twimlAppSid: (process.env.TWILIO_TWIML_APP_SID ?? '').trim() || undefined,
    verifyServiceSid: (process.env.TWILIO_VERIFY_SERVICE_SID ?? '').trim() || undefined,
  }
}

export async function resolveTwilioOrg(
  orgId: string,
  opts: { allowPlatformFallback?: boolean } = {},
): Promise<ResolvedTwilioOrg | null> {
  if (!orgId) return null
  const orgCreds = await getOrgTwilioCredentials(orgId)
  const config = (await getOrgTwilioConfig(orgId)) ?? { recordCallsByDefault: true, inboundNumbers: [] }

  if (orgCreds?.accountSid && orgCreds.authToken) {
    return {
      orgId,
      credentials: orgCreds,
      config,
      client: twilio(orgCreds.accountSid, orgCreds.authToken),
      source: 'org',
    }
  }

  if (opts.allowPlatformFallback === false) return null
  const platform = platformCredentials()
  if (!platform) return null
  return {
    orgId,
    credentials: platform,
    config,
    client: twilio(platform.accountSid, platform.authToken),
    source: 'platform',
  }
}

export function assertCapability(
  resolved: ResolvedTwilioOrg,
  capability: keyof ReturnType<typeof computeTwilioCapabilities>,
): void {
  const flags = computeTwilioCapabilities(resolved.credentials)
  if (!flags[capability]) {
    throw new Error(`Twilio ${capability} is not configured for this organisation`)
  }
}

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(/\/$/, '')
}
