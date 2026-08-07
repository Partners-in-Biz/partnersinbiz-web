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
 *     masked SIDs and the public sender number.
 */
import crypto from 'crypto'
import twilio from 'twilio'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

export interface TwilioProviderCredentials {
  accountSid: string
  authToken: string
  messagingServiceSid?: string
  whatsappFrom?: string
}

export interface EncryptedCredentialBlock {
  ciphertext: string // base64
  iv: string // base64
  tag: string // base64
}

export interface CredentialSummary {
  provider: 'twilio'
  hasCredentials: boolean
  accountSidMasked: string | null
  messagingServiceSidMasked: string | null
  whatsappFrom: string | null
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

export function encryptTwilioCredentials(
  credentials: TwilioProviderCredentials,
  orgId: string,
): Record<keyof TwilioProviderCredentials, EncryptedCredentialBlock | null> {
  return {
    accountSid: encryptCredentialValue(credentials.accountSid.trim(), orgId),
    authToken: encryptCredentialValue(credentials.authToken.trim(), orgId),
    messagingServiceSid: credentials.messagingServiceSid?.trim()
      ? encryptCredentialValue(credentials.messagingServiceSid.trim(), orgId)
      : null,
    whatsappFrom: credentials.whatsappFrom?.trim()
      ? encryptCredentialValue(credentials.whatsappFrom.trim(), orgId)
      : null,
  }
}

export function decryptTwilioCredentials(
  block: Record<keyof TwilioProviderCredentials, EncryptedCredentialBlock | null>,
  orgId: string,
): TwilioProviderCredentials {
  if (!block.accountSid || !block.authToken) {
    throw new CredentialEncryptionError('Stored credentials are incomplete')
  }
  return {
    accountSid: decryptCredentialValue(block.accountSid, orgId),
    authToken: decryptCredentialValue(block.authToken, orgId),
    messagingServiceSid: block.messagingServiceSid ? decryptCredentialValue(block.messagingServiceSid, orgId) : undefined,
    whatsappFrom: block.whatsappFrom ? decryptCredentialValue(block.whatsappFrom, orgId) : undefined,
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
  whatsappFrom?: string | null
  encryptedAt?: string | Date | null
  verifiedAt?: string | Date | null
}): CredentialSummary {
  return {
    provider: 'twilio',
    hasCredentials: input.hasCredentials ?? Boolean(input.accountSid),
    accountSidMasked: maskSid(input.accountSid),
    messagingServiceSidMasked: maskSid(input.messagingServiceSid),
    whatsappFrom: input.whatsappFrom || null,
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
