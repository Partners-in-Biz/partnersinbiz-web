/**
 * Twilio Lookup + Verify helpers (per-org credentials).
 */
import { assertCapability, type ResolvedTwilioOrg } from './org-client'

export interface LookupResult {
  ok: boolean
  phoneNumber: string
  nationalFormat?: string
  countryCode?: string
  callerName?: string | null
  lineType?: string | null
  carrierName?: string | null
  valid?: boolean
  error?: string
  raw?: Record<string, unknown>
}

export async function lookupPhoneNumber(
  resolved: ResolvedTwilioOrg,
  phoneNumber: string,
  opts: { type?: Array<'carrier' | 'caller-name' | 'line-type-intelligence'> } = {},
): Promise<LookupResult> {
  assertCapability(resolved, 'lookup')
  const e164 = phoneNumber.trim()
  if (!e164) return { ok: false, phoneNumber: e164, error: 'phone number required' }
  try {
    const types = opts.type ?? ['line-type-intelligence', 'carrier']
    // Twilio Lookup v2
    const result = await resolved.client.lookups.v2
      .phoneNumbers(e164)
      .fetch({ fields: types.join(',') })
    const lineTypeIntel = (result as { lineTypeIntelligence?: { type?: string; carrier_name?: string } }).lineTypeIntelligence
    const callerName = (result as { callerName?: { caller_name?: string } }).callerName
    return {
      ok: true,
      phoneNumber: result.phoneNumber ?? e164,
      nationalFormat: result.nationalFormat ?? undefined,
      countryCode: result.countryCode ?? undefined,
      valid: result.valid !== false,
      lineType: lineTypeIntel?.type ?? null,
      carrierName: lineTypeIntel?.carrier_name ?? (result as { carrier?: { name?: string } }).carrier?.name ?? null,
      callerName: callerName?.caller_name ?? null,
      raw: result as unknown as Record<string, unknown>,
    }
  } catch (error) {
    const err = error as { message?: string }
    return { ok: false, phoneNumber: e164, error: err.message ?? 'lookup failed' }
  }
}

export interface VerifySendResult {
  ok: boolean
  sid?: string
  status?: string
  to?: string
  channel?: string
  error?: string
}

export async function sendVerification(
  resolved: ResolvedTwilioOrg,
  input: { to: string; channel?: 'sms' | 'call' | 'whatsapp'; locale?: string },
): Promise<VerifySendResult> {
  assertCapability(resolved, 'verify')
  const serviceSid = resolved.credentials.verifyServiceSid!
  const to = input.to.trim()
  const channel = input.channel ?? 'sms'
  try {
    const verification = await resolved.client.verify.v2
      .services(serviceSid)
      .verifications.create({
        to,
        channel,
        locale: input.locale,
      })
    return {
      ok: true,
      sid: verification.sid,
      status: verification.status,
      to: verification.to,
      channel: verification.channel,
    }
  } catch (error) {
    const err = error as { message?: string }
    return { ok: false, error: err.message ?? 'verify send failed' }
  }
}

export interface VerifyCheckResult {
  ok: boolean
  status?: string
  valid?: boolean
  to?: string
  error?: string
}

export async function checkVerification(
  resolved: ResolvedTwilioOrg,
  input: { to: string; code: string },
): Promise<VerifyCheckResult> {
  assertCapability(resolved, 'verify')
  const serviceSid = resolved.credentials.verifyServiceSid!
  try {
    const check = await resolved.client.verify.v2
      .services(serviceSid)
      .verificationChecks.create({
        to: input.to.trim(),
        code: input.code.trim(),
      })
    return {
      ok: check.status === 'approved',
      status: check.status,
      valid: check.valid === true,
      to: check.to,
    }
  } catch (error) {
    const err = error as { message?: string }
    return { ok: false, error: err.message ?? 'verify check failed' }
  }
}
