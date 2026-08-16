/**
 * Per-org provider credential encryption for the communications module.
 *
 * Uses the platform's existing secret convention: an AES-256-GCM master key
 * from env (TWILIO_CREDENTIALS_MASTER_KEY, falling back to
 * SOCIAL_TOKEN_MASTER_KEY — the key already used by lib/social/encryption.ts,
 * lib/linked-computers, and lib/agents) combined with the orgId to derive a
 * per-org key via HMAC-SHA256. Ciphertext is safe to persist in Firestore.
 *
 * SECURITY RULES (spec 2026-08-06 §3.1):
 *   - Plaintext credentials are only ever decrypted server-side at send /
 *     verify time. They are NEVER returned by an API route and never logged.
 *   - API responses must use `redactCredentialSummary`, which only exposes
 *     masked SIDs and the public sender numbers / capability flags.
 */
import crypto from 'crypto'
import twilio from 'twilio'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

/** All secret fields that may be encrypted for an org Twilio connection. */
export const TWILIO_SECRET_KEYS = [
  'accountSid',
  'authToken',
  'messagingServiceSid',
  'whatsappFrom',
  'defaultFromNumber',
  'voiceCallerId',
  'apiKeySid',
  'apiKeySecret',
  'twimlAppSid',
  'verifyServiceSid',
] as const

export type TwilioSecretKey = (typeof TWILIO_SECRET_KEYS)[number]

export interface TwilioProviderCredentials {
  accountSid: string
  authToken: string
  messagingServiceSid?: string
  whatsappFrom?: string
  /** Default SMS / MMS from number (E.164) when no Messaging Service is set. */
  defaultFromNumber?: string
  /** Outbound Voice caller ID (must be a Twilio number on the org account). */
  voiceCallerId?: string
  /** API Key SID for Voice Access Tokens (SK…). */
  apiKeySid?: string
  /** API Key Secret for Voice Access Tokens. */
  apiKeySecret?: string
  /** TwiML App SID (AP…) — Voice Request URL should hit our voice webhook. */
  twimlAppSid?: string
  /** Verify Service SID (VA…) for OTP send/check. */
  verifyServiceSid?: string
}

export interface TwilioOrgConfig {
  /** When true, new outbound/inbound calls request dual-channel recording. */
  recordCallsByDefault?: boolean
  /** Extra voice/SMS DIDs (E.164) registered for inbound webhook routing. */
  inboundNumbers?: string[]
}

export interface EncryptedCredentialBlock {
  ciphertext: string // base64
  iv: string // base64
  tag: string // base64
}

export interface TwilioCapabilityFlags {
  account: boolean
  sms: boolean
  whatsapp: boolean
  voice: boolean
  verify: boolean
  lookup: boolean
}

export interface CredentialSummary {
  provider: 'twilio'
  hasCredentials: boolean
  accountSidMasked: string | null
  messagingServiceSidMasked: string | null
  apiKeySidMasked: string | null
  twimlAppSidMasked: string | null
  verifyServiceSidMasked: string | null
  whatsappFrom: string | null
  defaultFromNumber: string | null
  voiceCallerId: string | null
  recordCallsByDefault: boolean
  inboundNumbers: string[]
  capabilities: TwilioCapabilityFlags
  encryptedAt: string | null
  verifiedAt: string | null
}

export class CredentialEncryptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CredentialEncryptionError'
  }
}

export function getCredentialMasterKey(): string {
  const key = (process.env.TWILIO_CREDENTIALS_MASTER_KEY ?? process.env.SOCIAL_TOKEN_MASTER_KEY ?? '').trim()
  if (!key) {
    throw new CredentialEncryptionError(
      'Missing encryption key: set TWILIO_CREDENTIALS_MASTER_KEY or SOCIAL_TOKEN_MASTER_KEY',
    )
  }
  return key
}

function deriveKey(orgId: string): Buffer {
  const masterKey = getCredentialMasterKey()
  return crypto.createHmac('sha256', masterKey).update(orgId).digest()
}

export function encryptCredentialValue(plaintext: string, orgId: string): EncryptedCredentialBlock {
  const key = deriveKey(orgId)
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  }
}

export function decryptCredentialValue(block: EncryptedCredentialBlock, orgId: string): string {
  const key = deriveKey(orgId)
  const iv = Buffer.from(block.iv, 'base64')
  const tag = Buffer.from(block.tag, 'base64')
  const ciphertext = Buffer.from(block.ciphertext, 'base64')
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    return decipher.update(ciphertext) + decipher.final('utf8')
  } catch {
    throw new CredentialEncryptionError('Failed to decrypt credentials for this organisation')
  }
}

export type EncryptedTwilioCredentialMap = Record<TwilioSecretKey, EncryptedCredentialBlock | null>

export function encryptTwilioCredentials(
  credentials: TwilioProviderCredentials,
  orgId: string,
): EncryptedTwilioCredentialMap {
  const out = {} as EncryptedTwilioCredentialMap
  for (const key of TWILIO_SECRET_KEYS) {
    const value = credentials[key]
    out[key] = typeof value === 'string' && value.trim()
      ? encryptCredentialValue(value.trim(), orgId)
      : null
  }
  return out
}

export function decryptTwilioCredentials(
  block: Partial<EncryptedTwilioCredentialMap> | Record<string, EncryptedCredentialBlock | null>,
  orgId: string,
): TwilioProviderCredentials {
  const accountSidBlock = block.accountSid
  const authTokenBlock = block.authToken
  if (!accountSidBlock || !authTokenBlock) {
    throw new CredentialEncryptionError('Stored credentials are incomplete')
  }
  const credentials: TwilioProviderCredentials = {
    accountSid: decryptCredentialValue(accountSidBlock, orgId),
    authToken: decryptCredentialValue(authTokenBlock, orgId),
  }
  for (const key of TWILIO_SECRET_KEYS) {
    if (key === 'accountSid' || key === 'authToken') continue
    const encrypted = block[key]
    if (encrypted) {
      credentials[key] = decryptCredentialValue(encrypted, orgId)
    }
  }
  return credentials
}

/**
 * Merge incoming credentials over an existing set. Empty strings are ignored
 * so partial UI updates (e.g. WhatsApp-only connect) do not wipe Voice keys.
 */
export function mergeTwilioCredentials(
  existing: TwilioProviderCredentials | null,
  incoming: Partial<TwilioProviderCredentials>,
): TwilioProviderCredentials {
  const base: TwilioProviderCredentials = {
    accountSid: existing?.accountSid ?? '',
    authToken: existing?.authToken ?? '',
    messagingServiceSid: existing?.messagingServiceSid,
    whatsappFrom: existing?.whatsappFrom,
    defaultFromNumber: existing?.defaultFromNumber,
    voiceCallerId: existing?.voiceCallerId,
    apiKeySid: existing?.apiKeySid,
    apiKeySecret: existing?.apiKeySecret,
    twimlAppSid: existing?.twimlAppSid,
    verifyServiceSid: existing?.verifyServiceSid,
  }
  for (const key of TWILIO_SECRET_KEYS) {
    const value = incoming[key]
    if (typeof value === 'string' && value.trim()) {
      base[key] = value.trim()
    }
  }
  if (!base.accountSid || !base.authToken) {
    throw new CredentialEncryptionError('Twilio Account SID and Auth Token are required')
  }
  return base
}

export function computeTwilioCapabilities(
  credentials: Pick<
    TwilioProviderCredentials,
    | 'accountSid'
    | 'authToken'
    | 'messagingServiceSid'
    | 'whatsappFrom'
    | 'defaultFromNumber'
    | 'voiceCallerId'
    | 'apiKeySid'
    | 'apiKeySecret'
    | 'twimlAppSid'
    | 'verifyServiceSid'
  > | null,
): TwilioCapabilityFlags {
  const hasAccount = Boolean(credentials?.accountSid && credentials?.authToken)
  return {
    account: hasAccount,
    sms: hasAccount && Boolean(credentials?.messagingServiceSid || credentials?.defaultFromNumber),
    whatsapp: hasAccount && Boolean(credentials?.whatsappFrom),
    voice: hasAccount
      && Boolean(credentials?.apiKeySid)
      && Boolean(credentials?.apiKeySecret)
      && Boolean(credentials?.twimlAppSid)
      && Boolean(credentials?.voiceCallerId || credentials?.defaultFromNumber),
    verify: hasAccount && Boolean(credentials?.verifyServiceSid),
    lookup: hasAccount,
  }
}

/**
 * Mask a Twilio SID so API responses never expose the full identifier.
 * e.g. AC12••••••••••••••••••••••••••9f41
 */
export function maskSid(sid: string | null | undefined): string | null {
  if (!sid) return null
  const value = sid.trim()
  if (value.length <= 8) return `${value.slice(0, 2)}••••`
  return `${value.slice(0, 4)}••••••••••••••••••••••••${value.slice(-4)}`
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const value = phone.trim()
  if (value.length <= 6) return '••••'
  return `${value.slice(0, 4)}••••${value.slice(-2)}`
}

export function redactCredentialSummary(input: {
  provider?: string
  hasCredentials?: boolean
  accountSid?: string | null
  messagingServiceSid?: string | null
  apiKeySid?: string | null
  twimlAppSid?: string | null
  verifyServiceSid?: string | null
  whatsappFrom?: string | null
  defaultFromNumber?: string | null
  voiceCallerId?: string | null
  recordCallsByDefault?: boolean
  inboundNumbers?: string[]
  capabilities?: TwilioCapabilityFlags
  encryptedAt?: string | Date | null
  verifiedAt?: string | Date | null
}): CredentialSummary {
  const capabilities = input.capabilities ?? computeTwilioCapabilities({
    accountSid: input.accountSid ?? '',
    authToken: input.hasCredentials ? 'x' : '',
    messagingServiceSid: input.messagingServiceSid ?? undefined,
    whatsappFrom: input.whatsappFrom ?? undefined,
    defaultFromNumber: input.defaultFromNumber ?? undefined,
    voiceCallerId: input.voiceCallerId ?? undefined,
    apiKeySid: input.apiKeySid ?? undefined,
    apiKeySecret: input.apiKeySid ? 'x' : undefined,
    twimlAppSid: input.twimlAppSid ?? undefined,
    verifyServiceSid: input.verifyServiceSid ?? undefined,
  })
  return {
    provider: 'twilio',
    hasCredentials: input.hasCredentials ?? Boolean(input.accountSid),
    accountSidMasked: maskSid(input.accountSid),
    messagingServiceSidMasked: maskSid(input.messagingServiceSid),
    apiKeySidMasked: maskSid(input.apiKeySid),
    twimlAppSidMasked: maskSid(input.twimlAppSid),
    verifyServiceSidMasked: maskSid(input.verifyServiceSid),
    whatsappFrom: input.whatsappFrom || null,
    defaultFromNumber: input.defaultFromNumber || null,
    voiceCallerId: input.voiceCallerId || null,
    recordCallsByDefault: input.recordCallsByDefault === true,
    inboundNumbers: Array.isArray(input.inboundNumbers) ? input.inboundNumbers.filter(Boolean) : [],
    capabilities,
    encryptedAt: input.encryptedAt ? String(input.encryptedAt) : null,
    verifiedAt: input.verifiedAt ? String(input.verifiedAt) : null,
  }
}

/**
 * Verify that Twilio credentials actually authenticate against Twilio's API.
 * Performs a lightweight account fetch; throws a generic error on failure so
 * no credential material is ever leaked in the message.
 */
export async function verifyTwilioCredentials(
  credentials: TwilioProviderCredentials,
): Promise<{ ok: true; accountFriendlyName?: string }> {
  const accountSid = credentials.accountSid.trim()
  const authToken = credentials.authToken.trim()
  if (!accountSid || !authToken) throw new Error('Twilio account SID and auth token are required')
  const client = twilio(accountSid, authToken)
  try {
    const account = await client.api.accounts(accountSid).fetch()
    if (account.status && account.status !== 'active') {
      throw new Error(`Twilio account is not active (status: ${account.status})`)
    }
    return { ok: true, accountFriendlyName: account.friendlyName ?? undefined }
  } catch (error) {
    const err = error as { status?: number; message?: string }
    const detail = err.status === 401 || err.status === 403
      ? 'Authentication failed — check the Account SID and Auth Token'
      : err.status
        ? `Twilio rejected the credentials (HTTP ${err.status})`
        : 'Could not reach Twilio to verify the credentials'
    throw new Error(detail)
  }
}

/**
 * Normalise a phone number to E.164-ish key used for webhook route lookups.
 * Strips a leading `whatsapp:` / `sms:` prefix and any `+`, returning only
 * digits so it can be used as a Firestore doc id.
 */
export function normalizePhoneKey(value: string | null | undefined): string {
  const raw = (value ?? '').trim()
  const withoutChannel = raw.replace(/^(whatsapp|sms|messenger|instagram):/i, '')
  return withoutChannel.replace(/[^\d]/g, '')
}
