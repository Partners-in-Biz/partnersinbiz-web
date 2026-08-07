/**
 * @jest-environment node
 */

const mockSessionSet = jest.fn()
const mockDoc = jest.fn(() => ({ set: (...args: unknown[]) => mockSessionSet(...args) }))
const mockCollection = jest.fn(() => ({ doc: (...args: unknown[]) => mockDoc(...args) }))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: (...args: unknown[]) => mockCollection(...args) },
}))

import { decryptToken } from '@/lib/social/encryption'
import { createOauthSession } from '@/lib/llm-providers/oauth/sessions'
import { llmConnectionScopeKey, publicOauthSession } from '@/lib/llm-providers/types'
import type { LlmOauthSession } from '@/lib/llm-providers/types'

const SESSION_ID = 'oauth_test_abc123'

jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

function fullSession(overrides: Partial<LlmOauthSession> = {}): LlmOauthSession {
  return {
    id: SESSION_ID,
    provider: 'anthropic',
    hermesProvider: 'anthropic',
    orgId: 'org-1',
    ownerUid: 'user-1',
    scope: 'user',
    label: 'Anthropic Claude',
    flow: 'authorization_code',
    status: 'awaiting_code',
    authorizeUrl: 'https://claude.ai/oauth/authorize?client_id=9d1c250a',
    state: 'secret-state',
    verifierEnc: { ciphertext: 'c', iv: 'i', tag: 't' },
    deviceCode: 'device-secret',
    userCode: '',
    verificationUri: null,
    verificationUriComplete: null,
    tokenEndpoint: null,
    expiresAt: new Date(1_700_000_600_000).toISOString(),
    intervalSeconds: 0,
    error: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

describe('OAuth session model — authorization_code support', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.SOCIAL_TOKEN_MASTER_KEY = 'unit-test-master-key'
  })

  it('publicOauthSession never exposes the verifier, state, deviceCode, or tokenEndpoint', () => {
    const pub = publicOauthSession(fullSession())
    expect(pub).not.toHaveProperty('verifierEnc')
    expect(pub).not.toHaveProperty('state')
    expect(pub).not.toHaveProperty('deviceCode')
    expect(pub).not.toHaveProperty('tokenEndpoint')
    // But the URL the human approves in the browser must be public.
    expect(pub.authorizeUrl).toBe('https://claude.ai/oauth/authorize?client_id=9d1c250a')
    expect(pub.flow).toBe('authorization_code')
    expect(pub.status).toBe('awaiting_code')
  })

  it('creates an awaiting_code session with the verifier encrypted at rest', async () => {
    const started = { authorizeUrl: 'https://claude.ai/oauth/authorize?x=1', verifier: 'verifier-43-chars', state: 'verifier-43-chars' }
    const pub = await createOauthSession({
      provider: 'anthropic',
      hermesProvider: 'anthropic',
      orgId: 'org-1',
      ownerUid: 'user-1',
      scope: 'user',
      label: 'Anthropic Claude',
      flow: 'authorization_code',
      status: 'awaiting_code',
      authorizeUrl: started.authorizeUrl,
      state: started.state,
      verifier: started.verifier,
      expiresIn: 600,
      intervalSeconds: 0,
    })

    expect(mockCollection).toHaveBeenCalledWith('llm_oauth_sessions')
    expect(mockSessionSet).toHaveBeenCalledTimes(1)
    const [written] = mockSessionSet.mock.calls[0]
    expect(written.status).toBe('awaiting_code')
    expect(written.flow).toBe('authorization_code')
    expect(written.authorizeUrl).toBe(started.authorizeUrl)
    expect(written.state).toBe(started.state)
    // Verifier stored encrypted — no dedicated plaintext verifier field is
    // ever written to Firestore (state == verifier by Claude Code design, but
    // the verifier itself must be recoverable only via the encrypted blob).
    expect(written.verifierEnc).not.toBeNull()
    expect(written).not.toHaveProperty('verifier')
    expect(written.verifierEnc).not.toHaveProperty('verifier')
    // Round-trip decrypt proves the encrypted blob is the verifier.
    const scopeKey = llmConnectionScopeKey({ scope: 'user', orgId: 'org-1', ownerUid: 'user-1' })
    expect(decryptToken(written.verifierEnc, scopeKey)).toBe(started.verifier)

    // Public shape stays safe.
    expect(pub).not.toHaveProperty('verifierEnc')
    expect(pub).not.toHaveProperty('state')
    expect(pub.authorizeUrl).toBe(started.authorizeUrl)
  })

  it('keeps device-code sessions on the legacy pending status and empty auth-code fields', async () => {
    const pub = await createOauthSession({
      provider: 'xai-oauth',
      hermesProvider: 'xai-oauth',
      orgId: 'org-1',
      ownerUid: 'user-1',
      scope: 'org',
      label: 'xAI Grok (SuperGrok OAuth)',
      deviceCode: 'device-code',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://auth.x.ai/device',
      verificationUriComplete: 'https://auth.x.ai/device?user_code=ABCD-EFGH',
      tokenEndpoint: 'https://auth.x.ai/oauth2/token',
      expiresIn: 900,
      intervalSeconds: 5,
    })

    const [written] = mockSessionSet.mock.calls[0]
    expect(written.status).toBe('pending')
    expect(written.flow).toBe('device_code')
    expect(written.deviceCode).toBe('device-code')
    expect(written.userCode).toBe('ABCD-EFGH')
    expect(written.verifierEnc).toBeNull()
    expect(written.authorizeUrl).toBeNull()
    expect(pub.verificationUri).toBe('https://auth.x.ai/device')
  })
})
