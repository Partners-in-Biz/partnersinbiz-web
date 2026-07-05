import { NextRequest } from 'next/server'

const mockListCreativeProviderConnections = jest.fn()
const mockUpsertCreativeProviderConnection = jest.fn()
const mockGetCreativeProviderConnection = jest.fn()
const mockCanManageConnection = jest.fn()
const mockRevokeCreativeProviderConnection = jest.fn()
const mockMarkConnectionValidation = jest.fn()
const mockValidateProviderCredentials = jest.fn()
const mockDecryptConnectionCredentials = jest.fn()
const mockGetCreativeCanvasProvider = jest.fn()

const FIXTURE_USER = { uid: 'uid-9', role: 'client', authKind: 'session', orgId: 'org-1', orgIds: ['org-1'] }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, context?: unknown) =>
    handler(req, FIXTURE_USER, context),
}))

jest.mock('@/lib/creative-canvas/providers', () => ({
  getCreativeCanvasProvider: mockGetCreativeCanvasProvider,
}))

jest.mock('@/lib/creative-canvas/connections/store', () => ({
  listCreativeProviderConnections: mockListCreativeProviderConnections,
  upsertCreativeProviderConnection: mockUpsertCreativeProviderConnection,
  getCreativeProviderConnection: mockGetCreativeProviderConnection,
  canManageConnection: mockCanManageConnection,
  revokeCreativeProviderConnection: mockRevokeCreativeProviderConnection,
  markConnectionValidation: mockMarkConnectionValidation,
}))

jest.mock('@/lib/creative-canvas/connections/validate', () => ({
  validateProviderCredentials: mockValidateProviderCredentials,
}))

jest.mock('@/lib/creative-canvas/connections/crypto', () => ({
  decryptConnectionCredentials: mockDecryptConnectionCredentials,
}))

jest.mock('@/lib/creative-canvas/connections/types', () => {
  const actual = jest.requireActual('@/lib/creative-canvas/connections/types')
  return { ...actual }
})

const XAI_PROVIDER = {
  key: 'xai',
  label: 'xAI (Grok)',
  connection: {
    authKind: 'api_key',
    credentialFields: [{ key: 'apiKey', label: 'API key', secret: true, placeholder: 'xai-…' }],
    consoleUrl: 'https://console.x.ai/team/default/api-keys',
  },
}

const MASKED_CONNECTION = {
  id: 'org:org-1:xai',
  provider: 'xai',
  authKind: 'api_key',
  scope: 'org',
  orgId: 'org-1',
  ownerUid: null,
  label: 'xAI (Grok)',
  status: 'connected',
  scopeKeyRef: 'org:org-1',
  credentialHint: 'xai-…k3F9',
  meta: {},
  lastValidatedAt: null,
  lastUsedAt: null,
  lastError: null,
  createdAt: null,
  updatedAt: null,
  createdBy: 'uid-9',
  createdByType: 'user',
  hasCredentials: true,
}

describe('creative canvas connections API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('POST /connections', () => {
    it('validates then persists, returns 201 with masked connection (no raw key in body)', async () => {
      const { POST } = await import('@/app/api/v1/creative-canvas/connections/route')
      mockGetCreativeCanvasProvider.mockReturnValue(XAI_PROVIDER)
      mockValidateProviderCredentials.mockResolvedValue({ ok: true })
      mockUpsertCreativeProviderConnection.mockResolvedValue(MASKED_CONNECTION)

      const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/connections?orgId=org-1', {
        method: 'POST',
        body: JSON.stringify({ provider: 'xai', scope: 'org', credentials: { apiKey: 'xai-secret-key-12345' } }),
      }))
      const body = await res.json()
      const rawBody = JSON.stringify(body)

      expect(res.status).toBe(201)
      expect(mockValidateProviderCredentials).toHaveBeenCalledWith('xai', { apiKey: 'xai-secret-key-12345' })
      expect(mockUpsertCreativeProviderConnection).toHaveBeenCalled()
      expect(body).toMatchObject({ success: true, data: { connection: MASKED_CONNECTION } })
      expect(rawBody).not.toContain('xai-secret-key-12345')
    })

    it('rejects invalid key with 400 and does not call upsert', async () => {
      const { POST } = await import('@/app/api/v1/creative-canvas/connections/route')
      mockGetCreativeCanvasProvider.mockReturnValue(XAI_PROVIDER)
      mockValidateProviderCredentials.mockResolvedValue({ ok: false, error: 'Provider rejected the key (401)' })

      const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/connections?orgId=org-1', {
        method: 'POST',
        body: JSON.stringify({ provider: 'xai', scope: 'org', credentials: { apiKey: 'bad-key' } }),
      }))
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body).toMatchObject({ success: false, error: 'Provider rejected the key (401)' })
      expect(mockUpsertCreativeProviderConnection).not.toHaveBeenCalled()
    })

    it('rejects unknown provider with 400', async () => {
      const { POST } = await import('@/app/api/v1/creative-canvas/connections/route')
      mockGetCreativeCanvasProvider.mockReturnValue(null)

      const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/connections?orgId=org-1', {
        method: 'POST',
        body: JSON.stringify({ provider: 'nonexistent', scope: 'org', credentials: { apiKey: 'x' } }),
      }))
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body).toMatchObject({ success: false, error: 'Provider does not support connections' })
      expect(mockUpsertCreativeProviderConnection).not.toHaveBeenCalled()
    })

    it('sets ownerUid to the caller uid for user scope', async () => {
      const { POST } = await import('@/app/api/v1/creative-canvas/connections/route')
      mockGetCreativeCanvasProvider.mockReturnValue(XAI_PROVIDER)
      mockValidateProviderCredentials.mockResolvedValue({ ok: true })
      mockUpsertCreativeProviderConnection.mockResolvedValue(MASKED_CONNECTION)

      await POST(new NextRequest('http://test.local/api/v1/creative-canvas/connections?orgId=org-1', {
        method: 'POST',
        body: JSON.stringify({ provider: 'xai', scope: 'user', credentials: { apiKey: 'xai-secret-key-12345' } }),
      }))

      expect(mockUpsertCreativeProviderConnection).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'user', ownerUid: 'uid-9' }),
        expect.objectContaining({ uid: 'uid-9' }),
      )
    })

    it('strips undeclared credential fields before persisting', async () => {
      const { POST } = await import('@/app/api/v1/creative-canvas/connections/route')
      mockGetCreativeCanvasProvider.mockReturnValue(XAI_PROVIDER)
      mockValidateProviderCredentials.mockResolvedValue({ ok: true })
      mockUpsertCreativeProviderConnection.mockResolvedValue(MASKED_CONNECTION)

      await POST(new NextRequest('http://test.local/api/v1/creative-canvas/connections?orgId=org-1', {
        method: 'POST',
        body: JSON.stringify({ provider: 'xai', scope: 'org', credentials: { apiKey: 'k', evil: 'x' } }),
      }))

      expect(mockValidateProviderCredentials).toHaveBeenCalledWith('xai', { apiKey: 'k' })
      expect(mockUpsertCreativeProviderConnection).toHaveBeenCalledWith(
        expect.objectContaining({ credentials: { apiKey: 'k' } }),
        expect.anything(),
      )
    })
  })

  describe('GET /connections', () => {
    it('returns the masked list', async () => {
      const { GET } = await import('@/app/api/v1/creative-canvas/connections/route')
      mockListCreativeProviderConnections.mockResolvedValue([MASKED_CONNECTION])

      const res = await GET(new NextRequest('http://test.local/api/v1/creative-canvas/connections?orgId=org-1'))
      const body = await res.json()

      expect(mockListCreativeProviderConnections).toHaveBeenCalledWith({ orgId: 'org-1', uid: 'uid-9' })
      expect(body).toMatchObject({ success: true, data: { connections: [MASKED_CONNECTION] } })
    })
  })

  describe('DELETE /connections/[id]', () => {
    it('revokes happy path', async () => {
      const { DELETE } = await import('@/app/api/v1/creative-canvas/connections/[id]/route')
      mockRevokeCreativeProviderConnection.mockResolvedValue({ ...MASKED_CONNECTION, status: 'revoked' })

      const res = await DELETE(
        new NextRequest('http://test.local/api/v1/creative-canvas/connections/org:org-1:xai?orgId=org-1', { method: 'DELETE' }),
        { params: Promise.resolve({ id: 'org:org-1:xai' }) },
      )
      const body = await res.json()

      expect(mockRevokeCreativeProviderConnection).toHaveBeenCalledWith(
        'org:org-1:xai',
        { orgId: 'org-1', uid: 'uid-9' },
        { uid: 'uid-9', type: 'user' },
      )
      expect(body).toMatchObject({ success: true, data: { connection: { status: 'revoked' } } })
    })

    it('returns 403 Forbidden when revoke throws Forbidden', async () => {
      const { DELETE } = await import('@/app/api/v1/creative-canvas/connections/[id]/route')
      mockRevokeCreativeProviderConnection.mockRejectedValue(new Error('Forbidden'))

      const res = await DELETE(
        new NextRequest('http://test.local/api/v1/creative-canvas/connections/user:uid-2:xai?orgId=org-1', { method: 'DELETE' }),
        { params: Promise.resolve({ id: 'user:uid-2:xai' }) },
      )
      const body = await res.json()

      expect(res.status).toBe(403)
      expect(body).toMatchObject({ success: false, error: 'Forbidden' })
    })
  })

  describe('POST /connections/[id]/validate', () => {
    it('returns validation.ok false with reconnect message on decrypt failure, and still marks validation', async () => {
      const { POST } = await import('@/app/api/v1/creative-canvas/connections/[id]/validate/route')
      const rawConnection = {
        ...MASKED_CONNECTION,
        credentialsEnc: { ciphertext: 'abc', iv: 'def', tag: 'ghi' },
      }
      mockGetCreativeProviderConnection.mockResolvedValue(rawConnection)
      mockCanManageConnection.mockReturnValue(true)
      mockDecryptConnectionCredentials.mockImplementation(() => {
        throw new Error('bad tag')
      })
      mockMarkConnectionValidation.mockResolvedValue(undefined)

      const res = await POST(
        new NextRequest('http://test.local/api/v1/creative-canvas/connections/org:org-1:xai/validate?orgId=org-1', { method: 'POST' }),
        { params: Promise.resolve({ id: 'org:org-1:xai' }) },
      )
      const body = await res.json()

      expect(mockMarkConnectionValidation).toHaveBeenCalledWith(
        'org:org-1:xai',
        { ok: false, error: 'Stored credentials could not be decrypted — reconnect the provider' },
      )
      expect(body).toMatchObject({
        success: true,
        data: { validation: { ok: false, error: 'Stored credentials could not be decrypted — reconnect the provider' } },
      })
    })
  })
})
