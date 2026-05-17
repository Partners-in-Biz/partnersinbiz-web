// __tests__/api/integrations-encryption.test.ts
//
// Tests that CRM integration config is encrypted before Firestore writes
// and decrypted internally before building the public view.

// ── Crypto — use real encrypt/decrypt to verify round-trip correctness ────────
// We still need SOCIAL_TOKEN_MASTER_KEY set for the helper.
process.env.SOCIAL_TOKEN_MASTER_KEY = 'a'.repeat(64) // 64 hex chars = 32-byte key

import { encryptCredentials, decryptCredentials } from '@/lib/integrations/crypto'

// ── Firebase mock ─────────────────────────────────────────────────────────────
const mockAdd = jest.fn()
const mockGet = jest.fn()
const mockUpdate = jest.fn()
const mockWhere = jest.fn()
const mockDocGet = jest.fn()

// The docRef object that snap.ref points back to
const mockDocRef = {
  get: mockDocGet,
  update: mockUpdate,
}

// snap returned by doc().get() — ref points back to the docRef so snap.ref.update / snap.ref.get work
function makeMockSnap(dataFn: () => unknown, existsVal = true) {
  return { exists: existsVal, data: dataFn, id: 'int-1', ref: mockDocRef }
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn(() => ({
      where: mockWhere,
      get: mockGet,
      add: mockAdd,
      doc: jest.fn(() => mockDocRef),
    })),
  },
}))

// ── Auth mock — withCrmAuth passes (req, ctx, routeCtx) to handler ────────────
// We mock it to call the handler directly with a synthetic CrmAuthContext,
// matching the shape expected by routes migrated to withCrmAuth.
jest.mock('@/lib/auth/crm-middleware', () => ({
  withCrmAuth: (_role: string, handler: Function) =>
    (req: Request, routeCtx?: unknown) =>
      handler(req, { uid: 'user-1', orgId: 'org-1', role: 'admin', isAgent: false, actor: { uid: 'user-1', displayName: 'Test User', kind: 'human' }, permissions: {} }, routeCtx),
}))

jest.mock('@/lib/api/response', () => ({
  apiSuccess: jest.fn((data: unknown, status = 200) => ({ _data: data, _status: status })),
  apiError: jest.fn((msg: string, status = 400) => ({ _error: msg, _status: status })),
}))

// ── FieldValue mock ───────────────────────────────────────────────────────────
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => '__SERVER_TIMESTAMP__',
    increment: (n: number) => ({ _increment: n }),
  },
  Timestamp: {
    now: () => ({ toDate: () => new Date() }),
  },
}))

// ── Imports under test ────────────────────────────────────────────────────────
import { POST, GET } from '@/app/api/v1/crm/integrations/route'
import { PUT } from '@/app/api/v1/crm/integrations/[id]/route'

const ORG_ID = 'org-1'
const PLAIN_CONFIG = { apiKey: 'test-api-key-placeholder-us21', listId: 'list-abc' }

function makeRequest(body: unknown): Request {
  return {
    json: () => Promise.resolve(body),
    url: 'https://example.com/api/v1/crm/integrations?orgId=org-1',
  } as unknown as Request
}

const mockContext = { params: Promise.resolve({ id: 'int-1' }) }

beforeEach(() => {
  jest.clearAllMocks()
  const query = { where: mockWhere, get: mockGet }
  mockWhere.mockReturnValue(query)
})

describe('CRM integration config encryption', () => {
  it('POST encrypts config before storing in Firestore (configEnc present, no plaintext config)', async () => {
    // Mock the doc add + get back
    const fakeDocRef = {
      id: 'int-new',
      get: jest.fn(),
    }
    // Returned integration data after add — simulate what Firestore returns (no plain config)
    const encryptedConfig = encryptCredentials(PLAIN_CONFIG, ORG_ID)
    fakeDocRef.get.mockResolvedValueOnce({
      data: () => ({
        orgId: ORG_ID,
        provider: 'mailchimp',
        name: 'My list',
        status: 'pending',
        configEnc: encryptedConfig,
        autoTags: [],
        autoCampaignIds: [],
        cadenceMinutes: 0,
        lastSyncedAt: null,
        lastSyncStats: { imported: 0, created: 0, updated: 0, skipped: 0, errored: 0 },
        lastError: '',
        deleted: false,
        createdAt: '__SERVER_TIMESTAMP__',
        updatedAt: '__SERVER_TIMESTAMP__',
      }),
    })
    mockAdd.mockResolvedValueOnce(fakeDocRef)

    await POST(
      makeRequest({
        orgId: ORG_ID,
        provider: 'mailchimp',
        name: 'My list',
        config: PLAIN_CONFIG,
      }) as Request,
    )

    expect(mockAdd).toHaveBeenCalledTimes(1)
    const storedDoc = mockAdd.mock.calls[0][0]

    // configEnc must be present and be a valid EncryptedCredentials object
    expect(storedDoc.configEnc).toBeDefined()
    expect(storedDoc.configEnc).toHaveProperty('ciphertext')
    expect(storedDoc.configEnc).toHaveProperty('iv')
    expect(storedDoc.configEnc).toHaveProperty('tag')

    // Plain config must NOT be stored
    expect(storedDoc.config).toBeUndefined()

    // Decrypt and verify round-trip
    const decrypted = decryptCredentials<Record<string, string>>(storedDoc.configEnc, ORG_ID)
    expect(decrypted).toEqual(PLAIN_CONFIG)
  })

  it('GET decrypts config internally but returns only configPreview (no raw credentials)', async () => {
    const encryptedConfig = encryptCredentials(PLAIN_CONFIG, ORG_ID)

    // Mock list query
    mockGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'int-1',
          data: () => ({
            orgId: ORG_ID,
            provider: 'mailchimp',
            name: 'My list',
            status: 'active',
            configEnc: encryptedConfig,
            autoTags: [],
            autoCampaignIds: [],
            cadenceMinutes: 60,
            lastSyncedAt: null,
            lastSyncStats: { imported: 0, created: 0, updated: 0, skipped: 0, errored: 0 },
            lastError: '',
            deleted: false,
            createdAt: null,
            updatedAt: null,
          }),
        },
      ],
    })

    const req = {
      url: `https://example.com/api/v1/crm/integrations?orgId=${ORG_ID}`,
    } as Request

    const response = await GET(req)
    const publicViews = (response as { _data: unknown })._data as Array<Record<string, unknown>>

    expect(Array.isArray(publicViews)).toBe(true)
    expect(publicViews).toHaveLength(1)

    const view = publicViews[0]
    // configPreview must exist and have redacted apiKey
    expect(view.configPreview).toBeDefined()
    const preview = view.configPreview as Record<string, string>
    expect(preview.apiKey).toMatch(/^•+/)
    expect(preview.listId).toBe(PLAIN_CONFIG.listId) // non-sensitive field shown

    // Raw config must NOT appear in the public view
    expect(view.config).toBeUndefined()
  })

  it('PUT with new config re-encrypts and stores configEnc (not plaintext)', async () => {
    const existingEncrypted = encryptCredentials(PLAIN_CONFIG, ORG_ID)
    const newConfig = { apiKey: 'test-new-api-key-us6', listId: 'list-new' }

    const docData = () => ({
      orgId: ORG_ID,
      provider: 'mailchimp',
      name: 'My list',
      status: 'active',
      configEnc: existingEncrypted,
      autoTags: [],
      autoCampaignIds: [],
      cadenceMinutes: 0,
      lastSyncedAt: null,
      lastSyncStats: { imported: 0, created: 0, updated: 0, skipped: 0, errored: 0 },
      lastError: '',
      deleted: false,
      createdAt: null,
      updatedAt: null,
    })

    const snap = makeMockSnap(docData)
    // doc().get() is called twice: once to fetch, once after update via r.ref.get()
    mockDocRef.get
      .mockResolvedValueOnce(snap)
      .mockResolvedValueOnce(snap)
    mockDocRef.update.mockResolvedValueOnce(undefined)

    await PUT(
      makeRequest({ config: newConfig }) as Request,
      mockContext,
    )

    expect(mockDocRef.update).toHaveBeenCalledTimes(1)
    const updatePayload = (mockDocRef.update as jest.Mock).mock.calls[0][0]

    // configEnc must be present and be newly encrypted
    expect(updatePayload.configEnc).toBeDefined()
    expect(updatePayload.configEnc).toHaveProperty('ciphertext')

    // Plain config must NOT be stored
    expect(updatePayload.config).toBeUndefined()

    // Decrypted value must match the new config
    const decrypted = decryptCredentials<Record<string, string>>(updatePayload.configEnc, ORG_ID)
    expect(decrypted).toEqual(newConfig)
  })
})
