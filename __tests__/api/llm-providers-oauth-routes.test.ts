/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'
import { encryptToken } from '@/lib/social/encryption'
import { llmConnectionScopeKey } from '@/lib/llm-providers/types'
import type { ApiUser } from '@/lib/api/types'

const MOCK_USER = {
  uid: 'user-1',
  orgId: 'org-1',
  orgIds: ['org-1'],
  role: 'client',
  scopes: [],
} as unknown as ApiUser

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: ApiUser, ctx?: unknown) => Promise<Response>) =>
    (req: NextRequest, ctx?: unknown) => handler(req, MOCK_USER, ctx),
}))

jest.mock('@/lib/llm-providers/org-guard', () => ({
  clientCanAccessOrg: jest.fn(() => true),
  canWriteOrgLlmConnection: jest.fn(async () => true),
}))

const createOauthSessionMock = jest.fn()
const getOauthSessionMock = jest.fn()
const updateOauthSessionMock = jest.fn()
jest.mock('@/lib/llm-providers/oauth/sessions', () => ({
  createOauthSession: (...args: unknown[]) => createOauthSessionMock(...args),
  getOauthSession: (...args: unknown[]) => getOauthSessionMock(...args),
  updateOauthSession: (...args: unknown[]) => updateOauthSessionMock(...args),
}))

const upsertLlmProviderConnectionMock = jest.fn()
jest.mock('@/lib/llm-providers/store', () => ({
  upsertLlmProviderConnection: (...args: unknown[]) => upsertLlmProviderConnectionMock(...args),
}))

const syncLlmConnectionToHermesMock = jest.fn()
jest.mock('@/lib/llm-providers/sync-hermes', () => ({
  syncLlmConnectionToHermes: (...args: unknown[]) => syncLlmConnectionToHermesMock(...args),
}))

const startAnthropicPkceMock = jest.fn()
const exchangeAnthropicCodeMock = jest.fn()
jest.mock('@/lib/llm-providers/oauth/anthropic', () => ({
  startAnthropicPkce: (...args: unknown[]) => startAnthropicPkceMock(...args),
  exchangeAnthropicCode: (...args: unknown[]) => exchangeAnthropicCodeMock(...args),
}))

import { POST as startPost } from '@/app/api/v1/llm-providers/oauth/start/route'
import { POST as exchangePost } from '@/app/api/v1/llm-providers/oauth/[sessionId]/exchange/route'
import { GET as pollGet } from '@/app/api/v1/llm-providers/oauth/[sessionId]/route'

const VERIFIER = 'verifier-43-chars-abcdefghijklmnopqrstuvwxyz012345'
const SCOPE_KEY = llmConnectionScopeKey({ scope: 'user', orgId: 'org-1', ownerUid: 'user-1' })

function makeAuthCodeSession() {
  return {
    id: 'oauth_sess1',
    provider: 'anthropic',
    hermesProvider: 'anthropic',
    orgId: 'org-1',
    ownerUid: 'user-1',
    scope: 'user',
    label: 'Anthropic Claude',
    flow: 'authorization_code',
    status: 'awaiting_code',
    authorizeUrl: 'https://claude.ai/oauth/authorize?client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    state: VERIFIER,
    verifierEnc: encryptToken(VERIFIER, SCOPE_KEY),
    deviceCode: '',
    userCode: '',
    verificationUri: null,
    verificationUriComplete: null,
    tokenEndpoint: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    intervalSeconds: 0,
    error: null,
    createdAt: null,
    updatedAt: null,
  }
}

function jsonRequest(url: string, body: unknown, method = 'POST'): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function exchangeRequest(sessionId: string, body: unknown): Promise<Response> {
  return exchangePost(
    jsonRequest(`http://localhost/api/v1/llm-providers/oauth/${sessionId}/exchange?orgId=org-1`, body),
    { params: Promise.resolve({ sessionId }) },
  )
}

describe('POST /api/v1/llm-providers/oauth/start (anthropic)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.SOCIAL_TOKEN_MASTER_KEY = 'unit-test-master-key'
    startAnthropicPkceMock.mockReturnValue({
      authorizeUrl: 'https://claude.ai/oauth/authorize?client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      verifier: VERIFIER,
      state: VERIFIER,
    })
    createOauthSessionMock.mockImplementation(async (input: Record<string, unknown>) => ({
      id: 'oauth_sess1',
      provider: input.provider,
      hermesProvider: input.hermesProvider,
      orgId: input.orgId,
      ownerUid: input.ownerUid,
      scope: input.scope,
      label: input.label,
      flow: input.flow,
      status: input.status,
      authorizeUrl: input.authorizeUrl,
      deviceCode: '',
      userCode: '',
      verificationUri: null,
      verificationUriComplete: null,
      tokenEndpoint: null,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      intervalSeconds: input.intervalSeconds,
      error: null,
      createdAt: null,
      updatedAt: null,
    }))
  })

  it('starts an authorization_code session with an authorizeUrl for anthropic', async () => {
    const response = await startPost(jsonRequest(
      'http://localhost/api/v1/llm-providers/oauth/start?orgId=org-1',
      { provider: 'anthropic', scope: 'user' },
    ))

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.data.session.flow).toBe('authorization_code')
    expect(body.data.session.status).toBe('awaiting_code')
    expect(body.data.session.authorizeUrl).toContain('claude.ai/oauth/authorize')
    // Never expose the PKCE verifier or state to the client.
    expect(JSON.stringify(body.data.session)).not.toContain(VERIFIER)
    expect(body.data.session).not.toHaveProperty('verifierEnc')
    expect(body.data.session).not.toHaveProperty('state')
    const written = createOauthSessionMock.mock.calls[0][0]
    expect(written.verifier).toBe(VERIFIER)
    expect(written.status).toBe('awaiting_code')
    expect(written.flow).toBe('authorization_code')
  })

  it('still rejects unsupported providers with the Hermes-host fallback', async () => {
    const response = await startPost(jsonRequest(
      'http://localhost/api/v1/llm-providers/oauth/start?orgId=org-1',
      { provider: 'gemini', scope: 'user' },
    ))
    expect(response.status).toBe(400)
  })
})

describe('POST /api/v1/llm-providers/oauth/[sessionId]/exchange', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.SOCIAL_TOKEN_MASTER_KEY = 'unit-test-master-key'
    getOauthSessionMock.mockResolvedValue(makeAuthCodeSession())
    exchangeAnthropicCodeMock.mockResolvedValue({
      access_token: 'at-1',
      refresh_token: 'rt-1',
      expires_in: 21600,
      token_type: 'Bearer',
      scope: 'org:create_api_key user:profile user:inference',
    })
    upsertLlmProviderConnectionMock.mockResolvedValue({
      id: 'user:user-1:anthropic',
      provider: 'anthropic',
      authKind: 'oauth_token',
      scope: 'user',
      status: 'connected',
      hasCredentials: true,
    })
    syncLlmConnectionToHermesMock.mockResolvedValue({ synced: ['pip'], queued: [], failed: [] })
  })

  it('exchanges the pasted code, upserts the connection, marks completed and syncs', async () => {
    const response = await exchangeRequest('oauth_sess1', { code: 'callback-code' })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.connection.provider).toBe('anthropic')
    expect(body.data.connection.authKind).toBe('oauth_token')
    expect(body.data.sync.synced).toEqual(['pip'])
    expect(body.data.session.status).toBe('completed')

    expect(exchangeAnthropicCodeMock).toHaveBeenCalledWith({
      code: 'callback-code',
      verifier: VERIFIER,
      state: VERIFIER,
    })
    expect(upsertLlmProviderConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'anthropic',
        authKind: 'oauth_token',
        scope: 'user',
        credentials: expect.objectContaining({
          access_token: 'at-1',
          refresh_token: 'rt-1',
          expires_in: '21600',
          obtained_at: expect.any(String),
          expires_at: expect.any(String),
        }),
      }),
      { uid: 'user-1', type: 'user' },
    )
    expect(updateOauthSessionMock).toHaveBeenCalledWith('oauth_sess1', { status: 'completed', error: null })
    expect(syncLlmConnectionToHermesMock).toHaveBeenCalledWith('user:user-1:anthropic')
  })

  it('rejects a state mismatch forwarded by the client', async () => {
    const response = await exchangeRequest('oauth_sess1', { code: 'callback-code', state: 'wrong-state' })
    expect(response.status).toBe(400)
    expect(exchangeAnthropicCodeMock).not.toHaveBeenCalled()
    expect(upsertLlmProviderConnectionMock).not.toHaveBeenCalled()
  })

  it('accepts the combined code#state format copied from Anthropic’s callback page', async () => {
    const response = await exchangeRequest('oauth_sess1', { code: `callback-code#${VERIFIER}` })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.connection.provider).toBe('anthropic')
    // The embedded state is validated against the session and the code is
    // exchanged without the #state suffix.
    expect(exchangeAnthropicCodeMock).toHaveBeenCalledWith({
      code: 'callback-code',
      verifier: VERIFIER,
      state: VERIFIER,
    })
  })

  it('rejects a mismatched state embedded in the pasted code', async () => {
    const response = await exchangeRequest('oauth_sess1', { code: 'callback-code#wrong-state' })
    expect(response.status).toBe(400)
    expect(exchangeAnthropicCodeMock).not.toHaveBeenCalled()
    expect(upsertLlmProviderConnectionMock).not.toHaveBeenCalled()
  })

  it('still requires a code after stripping a #state suffix', async () => {
    const response = await exchangeRequest('oauth_sess1', { code: `#${VERIFIER}` })
    expect(response.status).toBe(400)
    expect(exchangeAnthropicCodeMock).not.toHaveBeenCalled()
  })

  it('rejects an already-completed or missing session', async () => {
    getOauthSessionMock.mockResolvedValue(null)
    const response = await exchangeRequest('oauth_missing', { code: 'callback-code' })
    expect(response.status).toBe(404)
  })

  it('requires a code in the body', async () => {
    const response = await exchangeRequest('oauth_sess1', {})
    expect(response.status).toBe(400)
    expect(exchangeAnthropicCodeMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/llm-providers/oauth/[sessionId] (anthropic)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.SOCIAL_TOKEN_MASTER_KEY = 'unit-test-master-key'
    syncLlmConnectionToHermesMock.mockResolvedValue({ synced: [], queued: [], failed: [] })
  })

  it('returns pending without device polling while awaiting the pasted code', async () => {
    getOauthSessionMock.mockResolvedValue(makeAuthCodeSession())
    const response = await pollGet(
      new NextRequest('http://localhost/api/v1/llm-providers/oauth/oauth_sess1?orgId=org-1'),
      { params: Promise.resolve({ sessionId: 'oauth_sess1' }) },
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.pending).toBe(true)
    expect(body.data.session.status).toBe('awaiting_code')
    expect(JSON.stringify(body.data.session)).not.toContain(VERIFIER)
    expect(body.data.session).not.toHaveProperty('verifierEnc')
    expect(body.data.session).not.toHaveProperty('state')
    // No device polling / no upsert for authorization_code sessions.
    expect(upsertLlmProviderConnectionMock).not.toHaveBeenCalled()
  })

  it('returns the completed session as-is once exchanged', async () => {
    getOauthSessionMock.mockResolvedValue({ ...makeAuthCodeSession(), status: 'completed' })
    const response = await pollGet(
      new NextRequest('http://localhost/api/v1/llm-providers/oauth/oauth_sess1?orgId=org-1'),
      { params: Promise.resolve({ sessionId: 'oauth_sess1' }) },
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.session.status).toBe('completed')
    expect(upsertLlmProviderConnectionMock).not.toHaveBeenCalled()
  })
})
