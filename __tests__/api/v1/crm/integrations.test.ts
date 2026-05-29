/**
 * Route-level tests for GET + POST /api/v1/crm/integrations
 *
 * Auth: GET → admin, POST → admin
 * Encryption: mocked to identity so we don't need SOCIAL_TOKEN_MASTER_KEY
 */

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

jest.mock('@/lib/integrations/crypto', () => ({
  encryptCredentials: jest.fn(() => ({
    enc: 'ENCRYPTED',
    tag: 'tag',
    iv: 'iv',
    keyVersion: 1,
  })),
  decryptCredentials: jest.fn(() => ({ apiKey: 'decrypted-key' })),
}))

import { NextRequest } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { decryptCredentials, encryptCredentials } from '@/lib/integrations/crypto'
import { syncMailchimp } from '@/lib/crm/integrations/handlers/mailchimp'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../helpers/crm'

const AI_API_KEY = 'test-ai-key-abc'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ---------------------------------------------------------------------------
// stageAuth helper
// ---------------------------------------------------------------------------

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  perms: Record<string, unknown> = {},
  opts?: {
    capturedAdd?: jest.Mock
    existingIntegrations?: Array<{ id: string; data: Record<string, unknown> }>
    addDocId?: string
  },
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users')
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }),
        }),
      }
    if (name === 'orgMembers')
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => member }),
        }),
        where: (_field: string, _op: string, value: string) => ({
          get: () =>
            Promise.resolve({
              docs:
                value === member.uid
                  ? [{ id: `${member.orgId}_${member.uid}`, data: () => member }]
                  : [],
            }),
        }),
      }
    if (name === 'organizations')
      return {
        doc: () => ({
          get: () =>
            Promise.resolve({ exists: true, data: () => ({ settings: { permissions: perms } }) }),
        }),
      }
    if (name === 'crm_integrations') {
      const listDocs = (opts?.existingIntegrations ?? []).map((s) => ({
        id: s.id,
        data: () => s.data,
      }))
      const docId = opts?.addDocId ?? 'new-int-id'
      const addFn =
        opts?.capturedAdd ??
        jest.fn().mockResolvedValue({
          id: docId,
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              orgId: member.orgId,
              provider: 'mailchimp',
              name: 'Test Integration',
              status: 'pending',
              configEnc: { enc: 'ENCRYPTED', tag: 'tag', iv: 'iv', keyVersion: 1 },
              autoTags: [],
              autoCampaignIds: [],
              cadenceMinutes: 0,
              lastSyncedAt: null,
              lastSyncStats: { imported: 0, created: 0, updated: 0, skipped: 0, errored: 0 },
              lastError: '',
              createdAt: null,
              updatedAt: null,
              deleted: false,
            }),
          }),
        })
      return {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: listDocs }),
        add: addFn,
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

// ---------------------------------------------------------------------------
// GET /api/v1/crm/integrations
// ---------------------------------------------------------------------------

describe('GET /api/v1/crm/integrations', () => {
  beforeEach(() => jest.clearAllMocks())

  it('admin can GET list — returns array of toPublicView shape', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin' })
    stageAuth(admin, {}, {
      existingIntegrations: [
        {
          id: 'int-1',
          data: {
            orgId: 'org-1',
            provider: 'mailchimp',
            name: 'MC Integration',
            status: 'active',
            configEnc: { enc: 'ENC', tag: 't', iv: 'i', keyVersion: 1 },
            autoTags: [],
            autoCampaignIds: [],
            cadenceMinutes: 60,
            lastSyncedAt: null,
            lastSyncStats: { imported: 0, created: 0, updated: 0, skipped: 0, errored: 0 },
            lastError: '',
            createdAt: null,
            updatedAt: null,
            deleted: false,
          },
        },
      ],
    })
    const req = callAsMember(admin, 'GET', '/api/v1/crm/integrations')
    const { GET } = await import('@/app/api/v1/crm/integrations/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    // Returns an array at the top level of data
    const list = Array.isArray(body.data) ? body.data : body.data.integrations
    expect(Array.isArray(list)).toBe(true)
    const item = list[0]
    // toPublicView shape — no raw configEnc, has configPreview
    expect(item).toHaveProperty('id')
    expect(item).toHaveProperty('provider')
    expect(item).toHaveProperty('configPreview')
    expect(item).not.toHaveProperty('configEnc')
    expect(item).not.toHaveProperty('config')
  })

  it('member cannot GET (403 — credential surface area)', async () => {
    const member = seedOrgMember('org-1', 'uid-member', { role: 'member' })
    stageAuth(member)
    const req = callAsMember(member, 'GET', '/api/v1/crm/integrations')
    const { GET } = await import('@/app/api/v1/crm/integrations/route')
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it('viewer cannot GET (403 — admin-only route)', async () => {
    const viewer = seedOrgMember('org-1', 'uid-viewer', { role: 'viewer' })
    stageAuth(viewer)
    const req = callAsMember(viewer, 'GET', '/api/v1/crm/integrations')
    const { GET } = await import('@/app/api/v1/crm/integrations/route')
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it('GET soft-deleted integrations are filtered from response', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin' })
    stageAuth(admin, {}, {
      existingIntegrations: [
        {
          id: 'int-deleted',
          data: {
            orgId: 'org-1',
            provider: 'mailchimp',
            name: 'Deleted Integration',
            status: 'paused',
            configEnc: { enc: 'ENC', tag: 't', iv: 'i', keyVersion: 1 },
            autoTags: [],
            autoCampaignIds: [],
            cadenceMinutes: 0,
            lastSyncedAt: null,
            lastSyncStats: { imported: 0, created: 0, updated: 0, skipped: 0, errored: 0 },
            lastError: '',
            createdAt: null,
            updatedAt: null,
            deleted: true,
          },
        },
      ],
    })
    const req = callAsMember(admin, 'GET', '/api/v1/crm/integrations')
    const { GET } = await import('@/app/api/v1/crm/integrations/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const list = Array.isArray(body.data) ? body.data : body.data.integrations
    expect(list.length).toBe(0)
  })

  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost/api/v1/crm/integrations')
    const { GET } = await import('@/app/api/v1/crm/integrations/route')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/crm/integrations
// ---------------------------------------------------------------------------

describe('POST /api/v1/crm/integrations', () => {
  beforeEach(() => jest.clearAllMocks())

  it('admin POST with valid provider+config — encrypts, writes configEnc, returns toPublicView', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin', firstName: 'Ada', lastName: 'Min' })
    const capturedAdd = jest.fn().mockResolvedValue({
      id: 'int-new',
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          orgId: 'org-1',
          provider: 'mailchimp',
          name: 'My Mailchimp',
          status: 'pending',
          configEnc: { enc: 'ENCRYPTED', tag: 'tag', iv: 'iv', keyVersion: 1 },
          autoTags: [],
          autoCampaignIds: [],
          cadenceMinutes: 0,
          lastSyncedAt: null,
          lastSyncStats: { imported: 0, created: 0, updated: 0, skipped: 0, errored: 0 },
          lastError: '',
          createdAt: null,
          updatedAt: null,
          deleted: false,
        }),
      }),
    })
    stageAuth(admin, {}, { capturedAdd })

    const config = { apiKey: 'test-api-key-us21', listId: 'abc123' }
    const req = callAsMember(admin, 'POST', '/api/v1/crm/integrations', {
      provider: 'mailchimp',
      name: 'My Mailchimp',
      config,
    })
    const { POST } = await import('@/app/api/v1/crm/integrations/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)

    // encryptCredentials was called with the validated config
    expect(encryptCredentials).toHaveBeenCalled()
    const callArgs = (encryptCredentials as jest.Mock).mock.calls[0]
    expect(callArgs[0]).toMatchObject({ apiKey: 'test-api-key-us21', listId: 'abc123' })

    // Firestore .add was called with configEnc (encrypted blob)
    expect(capturedAdd).toHaveBeenCalled()
    const addArg = capturedAdd.mock.calls[0][0]
    expect(addArg).toHaveProperty('configEnc')
    expect(addArg.configEnc).toMatchObject({ enc: 'ENCRYPTED', tag: 'tag', iv: 'iv', keyVersion: 1 })
    expect(addArg).not.toHaveProperty('config')

    // Response is toPublicView — no raw configEnc, has configPreview
    expect(body.data).toHaveProperty('configPreview')
    expect(body.data).not.toHaveProperty('configEnc')
    expect(body.data).not.toHaveProperty('config')
    expect(body.data.provider).toBe('mailchimp')
  })

  it('admin POST writes createdByRef and updatedByRef', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin', firstName: 'Ada', lastName: 'Min' })
    const capturedAdd = jest.fn().mockResolvedValue({
      id: 'int-new',
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          orgId: 'org-1',
          provider: 'mailchimp',
          name: 'My Mailchimp',
          status: 'pending',
          configEnc: { enc: 'ENCRYPTED', tag: 'tag', iv: 'iv', keyVersion: 1 },
          autoTags: [],
          autoCampaignIds: [],
          cadenceMinutes: 0,
          lastSyncedAt: null,
          lastSyncStats: { imported: 0, created: 0, updated: 0, skipped: 0, errored: 0 },
          lastError: '',
          createdAt: null,
          updatedAt: null,
          deleted: false,
        }),
      }),
    })
    stageAuth(admin, {}, { capturedAdd })

    const req = callAsMember(admin, 'POST', '/api/v1/crm/integrations', {
      provider: 'mailchimp',
      name: 'My Mailchimp',
      config: { apiKey: 'key-us21', listId: 'list1' },
    })
    const { POST } = await import('@/app/api/v1/crm/integrations/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()

    // Check Firestore write includes attribution refs
    const addArg = capturedAdd.mock.calls[0][0]
    expect(addArg).toHaveProperty('createdByRef')
    expect(addArg).toHaveProperty('updatedByRef')
    expect(addArg.createdByRef.displayName).toBe('Ada Min')
    expect(addArg.createdByRef.kind).toBe('human')
    expect(addArg.createdBy).toBe('uid-admin')

    // Response contains configPreview from toPublicView
    expect(body.data.configPreview).toBeDefined()
  })

  it('agent POST writes AGENT_PIP_REF and omits createdBy uid', async () => {
    const capturedAdd = jest.fn().mockResolvedValue({
      id: 'int-agent',
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          orgId: 'org-1',
          provider: 'mailchimp',
          name: 'Agent Integration',
          status: 'pending',
          configEnc: { enc: 'ENCRYPTED', tag: 'tag', iv: 'iv', keyVersion: 1 },
          autoTags: [],
          autoCampaignIds: [],
          cadenceMinutes: 0,
          lastSyncedAt: null,
          lastSyncStats: { imported: 0, created: 0, updated: 0, skipped: 0, errored: 0 },
          lastError: '',
          createdAt: null,
          updatedAt: null,
          deleted: false,
        }),
      }),
    })
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'organizations')
        return {
          doc: () => ({
            get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }),
          }),
        }
      if (name === 'crm_integrations')
        return {
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ docs: [] }),
          add: capturedAdd,
        }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsAgent('org-1', 'POST', '/api/v1/crm/integrations', {
      provider: 'mailchimp',
      name: 'Agent Integration',
      config: { apiKey: 'key-us21', listId: 'list1' },
    }, AI_API_KEY)
    const { POST } = await import('@/app/api/v1/crm/integrations/route')
    const res = await POST(req)
    expect(res.status).toBe(201)

    const addArg = capturedAdd.mock.calls[0][0]
    expect(addArg.createdByRef.uid).toBe('agent:pip')
    expect(addArg.createdByRef.kind).toBe('agent')
    expect(addArg.createdBy).toBeUndefined()
  })

  it('POST with unknown provider → 400', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin' })
    stageAuth(admin)
    const req = callAsMember(admin, 'POST', '/api/v1/crm/integrations', {
      provider: 'unknown-crm',
      name: 'Bad provider',
      config: {},
    })
    const { POST } = await import('@/app/api/v1/crm/integrations/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('POST with missing required config field → 400', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin' })
    stageAuth(admin)
    // mailchimp requires apiKey and listId — omit apiKey
    const req = callAsMember(admin, 'POST', '/api/v1/crm/integrations', {
      provider: 'mailchimp',
      name: 'Incomplete MC',
      config: { listId: 'abc123' }, // missing apiKey
    })
    const { POST } = await import('@/app/api/v1/crm/integrations/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('POST without provider → 400', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin' })
    stageAuth(admin)
    const req = callAsMember(admin, 'POST', '/api/v1/crm/integrations', {
      name: 'No provider',
      config: {},
    })
    const { POST } = await import('@/app/api/v1/crm/integrations/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('POST without name → 400', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin' })
    stageAuth(admin)
    const req = callAsMember(admin, 'POST', '/api/v1/crm/integrations', {
      provider: 'mailchimp',
      config: { apiKey: 'key', listId: 'list' },
    })
    const { POST } = await import('@/app/api/v1/crm/integrations/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('member cannot POST (403)', async () => {
    const member = seedOrgMember('org-1', 'uid-member', { role: 'member' })
    stageAuth(member)
    const req = callAsMember(member, 'POST', '/api/v1/crm/integrations', {
      provider: 'mailchimp',
      name: 'Attempt',
      config: { apiKey: 'key', listId: 'list' },
    })
    const { POST } = await import('@/app/api/v1/crm/integrations/route')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('viewer cannot POST (403)', async () => {
    const viewer = seedOrgMember('org-1', 'uid-viewer', { role: 'viewer' })
    stageAuth(viewer)
    const req = callAsMember(viewer, 'POST', '/api/v1/crm/integrations', {
      provider: 'mailchimp',
      name: 'Attempt',
      config: { apiKey: 'key', listId: 'list' },
    })
    const { POST } = await import('@/app/api/v1/crm/integrations/route')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// stageAuthWithDoc — extends stageAuth to support single-doc fetch (crm_integrations.doc(id).get())
// ---------------------------------------------------------------------------

function stageAuthWithDoc(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  integrationData: Record<string, unknown> | null,
  opts: {
    integrationId?: string
    perms?: Record<string, unknown>
    capturedUpdate?: jest.Mock
  } = {},
) {
  const integrationId = opts.integrationId ?? 'int-1'
  const perms = opts.perms ?? {}
  const capturedUpdate = opts.capturedUpdate ?? jest.fn().mockResolvedValue(undefined)

  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })

  const exists = integrationData !== null

  // refreshed snap returned by r.ref.get() after update
  const refreshedSnap = {
    exists,
    data: () => integrationData ?? {},
    id: integrationId,
  }

  // The docRef returned by doc(id) — this IS r.ref in loadIntegration
  const mockDocRef = {
    update: capturedUpdate,
    get: jest.fn()
      .mockResolvedValueOnce({ exists, data: () => integrationData ?? {}, id: integrationId })
      .mockResolvedValue(refreshedSnap),
  }

  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users')
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }),
        }),
      }
    if (name === 'orgMembers')
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => member }),
        }),
        where: (_field: string, _op: string, value: string) => ({
          get: () =>
            Promise.resolve({
              docs:
                value === member.uid
                  ? [{ id: `${member.orgId}_${member.uid}`, data: () => member }]
                  : [],
            }),
        }),
      }
    if (name === 'organizations')
      return {
        doc: () => ({
          get: () =>
            Promise.resolve({ exists: true, data: () => ({ settings: { permissions: perms } }) }),
        }),
      }
    if (name === 'crm_integrations')
      return {
        doc: jest.fn(() => mockDocRef),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: [] }),
      }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })

  return { mockDocRef, capturedUpdate }
}

function fakeIntegrationData(orgId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    orgId,
    provider: 'mailchimp',
    name: 'Test Integration',
    status: 'active',
    configEnc: { enc: 'ENCRYPTED', tag: 'tag', iv: 'iv', keyVersion: 1 },
    autoTags: [],
    autoCampaignIds: [],
    cadenceMinutes: 60,
    lastSyncedAt: null,
    lastSyncStats: { imported: 0, created: 0, updated: 0, skipped: 0, errored: 0 },
    lastError: '',
    createdAt: null,
    updatedAt: null,
    deleted: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/crm/integrations/[id]
// ---------------------------------------------------------------------------

describe('GET /api/v1/crm/integrations/[id]', () => {
  beforeEach(() => jest.clearAllMocks())

  it('admin can GET own-org integration — returns toPublicView shape', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin' })
    stageAuthWithDoc(admin, fakeIntegrationData('org-1'))

    const req = callAsMember(admin, 'GET', '/api/v1/crm/integrations/int-1')
    const { GET } = await import('@/app/api/v1/crm/integrations/[id]/route')
    const res = await GET(req, { params: Promise.resolve({ id: 'int-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('id')
    expect(body.data).toHaveProperty('provider')
    expect(body.data).toHaveProperty('configPreview')
    expect(body.data).not.toHaveProperty('configEnc')
    expect(body.data).not.toHaveProperty('config')
  })

  it('cross-org integration → 404 (no leakage)', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin' })
    // Integration belongs to org-2
    stageAuthWithDoc(admin, fakeIntegrationData('org-2'))

    const req = callAsMember(admin, 'GET', '/api/v1/crm/integrations/int-1')
    const { GET } = await import('@/app/api/v1/crm/integrations/[id]/route')
    const res = await GET(req, { params: Promise.resolve({ id: 'int-1' }) })
    expect(res.status).toBe(404)
  })

  it('soft-deleted integration → 404', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin' })
    stageAuthWithDoc(admin, fakeIntegrationData('org-1', { deleted: true }))

    const req = callAsMember(admin, 'GET', '/api/v1/crm/integrations/int-1')
    const { GET } = await import('@/app/api/v1/crm/integrations/[id]/route')
    const res = await GET(req, { params: Promise.resolve({ id: 'int-1' }) })
    expect(res.status).toBe(404)
  })

  it('member (non-admin) → 403', async () => {
    const member = seedOrgMember('org-1', 'uid-member', { role: 'member' })
    stageAuthWithDoc(member, fakeIntegrationData('org-1'))

    const req = callAsMember(member, 'GET', '/api/v1/crm/integrations/int-1')
    const { GET } = await import('@/app/api/v1/crm/integrations/[id]/route')
    const res = await GET(req, { params: Promise.resolve({ id: 'int-1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost/api/v1/crm/integrations/int-1')
    const { GET } = await import('@/app/api/v1/crm/integrations/[id]/route')
    const res = await GET(req, { params: Promise.resolve({ id: 'int-1' }) })
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// PUT /api/v1/crm/integrations/[id]
// ---------------------------------------------------------------------------

describe('PUT /api/v1/crm/integrations/[id]', () => {
  beforeEach(() => jest.clearAllMocks())

  it('admin updates name, autoTags, cadenceMinutes, status', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin', firstName: 'Ada', lastName: 'Min' })
    const capturedUpdate = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDoc(admin, fakeIntegrationData('org-1'), { capturedUpdate })

    const req = callAsMember(admin, 'PUT', '/api/v1/crm/integrations/int-1', {
      name: 'Updated Name',
      autoTags: ['tag-a'],
      cadenceMinutes: 120,
      status: 'paused',
    })
    const { PUT } = await import('@/app/api/v1/crm/integrations/[id]/route')
    const res = await PUT(req, { params: Promise.resolve({ id: 'int-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)

    expect(capturedUpdate).toHaveBeenCalledTimes(1)
    const updateArg = capturedUpdate.mock.calls[0][0]
    expect(updateArg.name).toBe('Updated Name')
    expect(updateArg.autoTags).toEqual(['tag-a'])
    expect(updateArg.cadenceMinutes).toBe(120)
    expect(updateArg.status).toBe('paused')
  })

  it('admin updates config: decryptCredentials called + encryptCredentials called with merged config', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin' })
    const capturedUpdate = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDoc(admin, fakeIntegrationData('org-1'), { capturedUpdate })

    const mockDecrypt = decryptCredentials as jest.Mock
    const mockEncrypt = encryptCredentials as jest.Mock

    const req = callAsMember(admin, 'PUT', '/api/v1/crm/integrations/int-1', {
      config: { apiKey: 'new-key-us10', listId: 'new-list' },
    })
    const { PUT } = await import('@/app/api/v1/crm/integrations/[id]/route')
    const res = await PUT(req, { params: Promise.resolve({ id: 'int-1' }) })
    expect(res.status).toBe(200)

    // decrypt was called with existing configEnc
    expect(mockDecrypt).toHaveBeenCalled()
    // encrypt was called with merged config
    expect(mockEncrypt).toHaveBeenCalled()
    // configEnc written, not plaintext config
    const updateArg = capturedUpdate.mock.calls[0][0]
    expect(updateArg.configEnc).toBeDefined()
    expect(updateArg.config).toBeUndefined()
  })

  it('admin PUT writes updatedByRef', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin', firstName: 'Ada', lastName: 'Min' })
    const capturedUpdate = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDoc(admin, fakeIntegrationData('org-1'), { capturedUpdate })

    const req = callAsMember(admin, 'PUT', '/api/v1/crm/integrations/int-1', { name: 'New Name' })
    const { PUT } = await import('@/app/api/v1/crm/integrations/[id]/route')
    await PUT(req, { params: Promise.resolve({ id: 'int-1' }) })

    const updateArg = capturedUpdate.mock.calls[0][0]
    expect(updateArg.updatedByRef).toBeDefined()
    expect(updateArg.updatedByRef.kind).toBe('human')
    expect(updateArg.updatedBy).toBe('uid-admin')
  })

  it('cross-org → 404', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin' })
    stageAuthWithDoc(admin, fakeIntegrationData('org-2'))

    const req = callAsMember(admin, 'PUT', '/api/v1/crm/integrations/int-1', { name: 'X' })
    const { PUT } = await import('@/app/api/v1/crm/integrations/[id]/route')
    const res = await PUT(req, { params: Promise.resolve({ id: 'int-1' }) })
    expect(res.status).toBe(404)
  })

  it('soft-deleted → 404', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin' })
    stageAuthWithDoc(admin, fakeIntegrationData('org-1', { deleted: true }))

    const req = callAsMember(admin, 'PUT', '/api/v1/crm/integrations/int-1', { name: 'X' })
    const { PUT } = await import('@/app/api/v1/crm/integrations/[id]/route')
    const res = await PUT(req, { params: Promise.resolve({ id: 'int-1' }) })
    expect(res.status).toBe(404)
  })

  it('member → 403', async () => {
    const member = seedOrgMember('org-1', 'uid-member', { role: 'member' })
    stageAuthWithDoc(member, fakeIntegrationData('org-1'))

    const req = callAsMember(member, 'PUT', '/api/v1/crm/integrations/int-1', { name: 'X' })
    const { PUT } = await import('@/app/api/v1/crm/integrations/[id]/route')
    const res = await PUT(req, { params: Promise.resolve({ id: 'int-1' }) })
    expect(res.status).toBe(403)
  })

  it('PUT with empty body returns 400 (no editable fields)', async () => {
    const admin = seedOrgMember('org-1', 'uid-1', { role: 'admin' })
    stageAuthWithDoc(admin, fakeIntegrationData('org-1'))

    const req = callAsMember(admin, 'PUT', '/api/v1/crm/integrations/int-1', {})
    const { PUT } = await import('@/app/api/v1/crm/integrations/[id]/route')
    const res = await PUT(req, { params: Promise.resolve({ id: 'int-1' }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/no editable fields/i)
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/v1/crm/integrations/[id]
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/crm/integrations/[id]', () => {
  beforeEach(() => jest.clearAllMocks())

  it('admin soft-deletes with updatedByRef and returns {id}', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin', firstName: 'Ada', lastName: 'Min' })
    const capturedUpdate = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDoc(admin, fakeIntegrationData('org-1'), { capturedUpdate })

    const req = callAsMember(admin, 'DELETE', '/api/v1/crm/integrations/int-1')
    const { DELETE } = await import('@/app/api/v1/crm/integrations/[id]/route')
    const res = await DELETE(req, { params: Promise.resolve({ id: 'int-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.id).toBe('int-1')

    expect(capturedUpdate).toHaveBeenCalledTimes(1)
    const updateArg = capturedUpdate.mock.calls[0][0]
    expect(updateArg.deleted).toBe(true)
    expect(updateArg.updatedByRef).toBeDefined()
    expect(updateArg.updatedBy).toBe('uid-admin')
  })

  it('cross-org → 404', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin' })
    stageAuthWithDoc(admin, fakeIntegrationData('org-2'))

    const req = callAsMember(admin, 'DELETE', '/api/v1/crm/integrations/int-1')
    const { DELETE } = await import('@/app/api/v1/crm/integrations/[id]/route')
    const res = await DELETE(req, { params: Promise.resolve({ id: 'int-1' }) })
    expect(res.status).toBe(404)
  })

  it('soft-deleted (already) → 404', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin' })
    stageAuthWithDoc(admin, fakeIntegrationData('org-1', { deleted: true }))

    const req = callAsMember(admin, 'DELETE', '/api/v1/crm/integrations/int-1')
    const { DELETE } = await import('@/app/api/v1/crm/integrations/[id]/route')
    const res = await DELETE(req, { params: Promise.resolve({ id: 'int-1' }) })
    expect(res.status).toBe(404)
  })

  it('member → 403', async () => {
    const member = seedOrgMember('org-1', 'uid-member', { role: 'member' })
    stageAuthWithDoc(member, fakeIntegrationData('org-1'))

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/integrations/int-1')
    const { DELETE } = await import('@/app/api/v1/crm/integrations/[id]/route')
    const res = await DELETE(req, { params: Promise.resolve({ id: 'int-1' }) })
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/crm/integrations/[id]/sync — via integrations.test.ts
// ---------------------------------------------------------------------------

jest.mock('@/lib/crm/integrations/handlers/mailchimp', () => ({
  syncMailchimp: jest.fn(),
}))
jest.mock('@/lib/crm/integrations/handlers/hubspot', () => ({
  syncHubspot: jest.fn(),
}))
jest.mock('@/lib/crm/integrations/handlers/gmail', () => ({
  syncGmail: jest.fn(),
}))

describe('POST /api/v1/crm/integrations/[id]/sync', () => {
  beforeEach(() => jest.clearAllMocks())

  const GOOD_STATS = { imported: 5, skipped: 0, errors: 0, total: 5, created: 5, updated: 0, errored: 0 }
  const SYNC_RESULT_OK = { ok: true, stats: GOOD_STATS, error: '' }

  it('admin triggers sync — status=syncing → handler called → status=active + lastSyncedAt + lastSyncStats', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin', firstName: 'Ada', lastName: 'Min' })
    const capturedUpdate = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDoc(admin, fakeIntegrationData('org-1', { status: 'active' }), { capturedUpdate })

    ;(syncMailchimp as jest.Mock).mockResolvedValue(SYNC_RESULT_OK)

    const req = callAsMember(admin, 'POST', '/api/v1/crm/integrations/int-1/sync')
    const { POST } = await import('@/app/api/v1/crm/integrations/[id]/sync/route')
    const res = await POST(req, { params: Promise.resolve({ id: 'int-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.ok).toBe(true)
    expect(body.data.stats).toMatchObject({ imported: 5 })

    // Two updates: step 1 (syncing) + step 3 (active)
    expect(capturedUpdate).toHaveBeenCalledTimes(2)
    const firstUpdate = capturedUpdate.mock.calls[0][0]
    expect(firstUpdate.status).toBe('syncing')
    const secondUpdate = capturedUpdate.mock.calls[1][0]
    expect(secondUpdate.status).toBe('active')
    expect(secondUpdate.lastSyncedAt).toBeDefined()
    expect(secondUpdate.lastSyncStats).toBeDefined()
    expect(syncMailchimp).toHaveBeenCalledTimes(1)
  })

  it('sync writes updatedByRef on both status transitions', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin', firstName: 'Ada', lastName: 'Min' })
    const capturedUpdate = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDoc(admin, fakeIntegrationData('org-1', { status: 'active' }), { capturedUpdate })

    ;(syncMailchimp as jest.Mock).mockResolvedValue(SYNC_RESULT_OK)

    const req = callAsMember(admin, 'POST', '/api/v1/crm/integrations/int-1/sync')
    const { POST } = await import('@/app/api/v1/crm/integrations/[id]/sync/route')
    await POST(req, { params: Promise.resolve({ id: 'int-1' }) })

    expect(capturedUpdate).toHaveBeenCalledTimes(2)
    for (const call of capturedUpdate.mock.calls) {
      const arg = call[0]
      expect(arg.updatedByRef).toBeDefined()
      expect(arg.updatedByRef.kind).toBe('human')
      expect(arg.updatedBy).toBe('uid-admin')
    }
  })

  it('failed handler → status=error + lastError set', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin' })
    const capturedUpdate = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDoc(admin, fakeIntegrationData('org-1', { status: 'active' }), { capturedUpdate })

    ;(syncMailchimp as jest.Mock).mockResolvedValue({ ok: false, stats: { imported: 0, created: 0, updated: 0, skipped: 0, errored: 1 }, error: 'API rate limit' })

    const req = callAsMember(admin, 'POST', '/api/v1/crm/integrations/int-1/sync')
    const { POST } = await import('@/app/api/v1/crm/integrations/[id]/sync/route')
    const res = await POST(req, { params: Promise.resolve({ id: 'int-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.ok).toBe(false)

    const secondUpdate = capturedUpdate.mock.calls[1][0]
    expect(secondUpdate.status).toBe('error')
    expect(secondUpdate.lastError).toBe('API rate limit')
  })

  it('cross-org → 404', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin' })
    stageAuthWithDoc(admin, fakeIntegrationData('org-2'))

    const req = callAsMember(admin, 'POST', '/api/v1/crm/integrations/int-1/sync')
    const { POST } = await import('@/app/api/v1/crm/integrations/[id]/sync/route')
    const res = await POST(req, { params: Promise.resolve({ id: 'int-1' }) })
    expect(res.status).toBe(404)
  })

  it('member → 403', async () => {
    const member = seedOrgMember('org-1', 'uid-member', { role: 'member' })
    stageAuthWithDoc(member, fakeIntegrationData('org-1'))

    const req = callAsMember(member, 'POST', '/api/v1/crm/integrations/int-1/sync')
    const { POST } = await import('@/app/api/v1/crm/integrations/[id]/sync/route')
    const res = await POST(req, { params: Promise.resolve({ id: 'int-1' }) })
    expect(res.status).toBe(403)
  })
})
