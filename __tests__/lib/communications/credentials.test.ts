/**
 * Credential lifecycle tests (Workstream 1 — per-org provider credentials).
 * Covers encrypt/read/redact; plaintext must never leak through summaries.
 */
import {
  CredentialEncryptionError,
  decryptCredentialValue,
  decryptTwilioCredentials,
  encryptCredentialValue,
  encryptTwilioCredentials,
  getCredentialMasterKey,
  maskSid,
  mergeTwilioCredentials,
  computeTwilioCapabilities,
  normalizePhoneKey,
  redactCredentialSummary,
} from '@/lib/communications/credentials'

const ORG_A = 'org-alpha'
const ORG_B = 'org-beta'

describe('communications credential encryption', () => {
  const originalKey = process.env.TWILIO_CREDENTIALS_MASTER_KEY
  const originalSocialKey = process.env.SOCIAL_TOKEN_MASTER_KEY

  beforeEach(() => {
    process.env.TWILIO_CREDENTIALS_MASTER_KEY = 'test-master-key-please-change'
    delete process.env.SOCIAL_TOKEN_MASTER_KEY
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.TWILIO_CREDENTIALS_MASTER_KEY
    else process.env.TWILIO_CREDENTIALS_MASTER_KEY = originalKey
    if (originalSocialKey === undefined) delete process.env.SOCIAL_TOKEN_MASTER_KEY
    else process.env.SOCIAL_TOKEN_MASTER_KEY = originalSocialKey
  })

  it('falls back to the platform SOCIAL_TOKEN_MASTER_KEY convention', () => {
    delete process.env.TWILIO_CREDENTIALS_MASTER_KEY
    process.env.SOCIAL_TOKEN_MASTER_KEY = 'social-key'
    expect(getCredentialMasterKey()).toBe('social-key')
  })

  it('throws a clear error when no master key is configured', () => {
    delete process.env.TWILIO_CREDENTIALS_MASTER_KEY
    delete process.env.SOCIAL_TOKEN_MASTER_KEY
    expect(() => getCredentialMasterKey()).toThrow(CredentialEncryptionError)
  })

  it('encrypts and decrypts a credential value round-trip', () => {
    const block = encryptCredentialValue('AC1234567890abcdef', ORG_A)
    expect(block.ciphertext).not.toContain('AC1234567890abcdef')
    expect(decryptCredentialValue(block, ORG_A)).toBe('AC1234567890abcdef')
  })

  it('produces different ciphertext for the same value across orgs', () => {
    const a = encryptCredentialValue('secret-value', ORG_A)
    const b = encryptCredentialValue('secret-value', ORG_B)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it('refuses to decrypt with the wrong org key', () => {
    const block = encryptCredentialValue('top-secret', ORG_A)
    expect(() => decryptCredentialValue(block, ORG_B)).toThrow(CredentialEncryptionError)
  })

  it('encrypts and decrypts the full Twilio credential set', () => {
    const creds = {
      accountSid: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      authToken: 'sekrit-token-value',
      messagingServiceSid: 'MGbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      whatsappFrom: '+27612345678',
      defaultFromNumber: '+27610000000',
      voiceCallerId: '+27610000000',
      apiKeySid: 'SKcccccccccccccccccccccccccccccccc',
      apiKeySecret: 'api-key-secret',
      twimlAppSid: 'APdddddddddddddddddddddddddddddddd',
      verifyServiceSid: 'VAeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    }
    const block = encryptTwilioCredentials(creds, ORG_A)
    expect(JSON.stringify(block)).not.toContain('sekrit-token-value')
    expect(JSON.stringify(block)).not.toContain('api-key-secret')
    const restored = decryptTwilioCredentials(block, ORG_A)
    expect(restored).toEqual(creds)
  })

  it('merges partial credential updates without wiping voice secrets', () => {
    const existing = {
      accountSid: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      authToken: 'sekrit-token-value',
      apiKeySid: 'SKcccccccccccccccccccccccccccccccc',
      apiKeySecret: 'api-key-secret',
      twimlAppSid: 'APdddddddddddddddddddddddddddddddd',
      voiceCallerId: '+27610000000',
    }
    const merged = mergeTwilioCredentials(existing, {
      whatsappFrom: '+27612345678',
      authToken: '',
    })
    expect(merged.apiKeySecret).toBe('api-key-secret')
    expect(merged.whatsappFrom).toBe('+27612345678')
    expect(computeTwilioCapabilities(merged).voice).toBe(true)
    expect(computeTwilioCapabilities(merged).whatsapp).toBe(true)
  })

  it('redacts credentials so API summaries never leak secrets', () => {
    const summary = redactCredentialSummary({
      provider: 'twilio',
      hasCredentials: true,
      accountSid: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      messagingServiceSid: 'MGbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      whatsappFrom: '+27612345678',
    })
    expect(summary.accountSidMasked).not.toContain('ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(summary.accountSidMasked).toContain('AC')
    expect(summary.messagingServiceSidMasked).not.toContain('MGbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    expect(summary.whatsappFrom).toBe('+27612345678') // public sender number stays visible
    expect(JSON.stringify(summary)).not.toContain('sekrit')
    expect(JSON.stringify(summary)).not.toMatch(/authToken/i)
  })

  it('masks SIDs and normalises phone keys for webhook routes', () => {
    expect(maskSid(`AC${'a'.repeat(26)}9f41`)).toBe(`ACaa${'•'.repeat(24)}9f41`)
    expect(maskSid(null)).toBeNull()
    expect(normalizePhoneKey('whatsapp:+27612345678')).toBe('27612345678')
    expect(normalizePhoneKey('+27 61 123 4567')).toBe('27611234567')
  })
})
