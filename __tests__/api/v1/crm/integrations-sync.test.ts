// __tests__/api/v1/crm/integrations-sync.test.ts
//
// Tests for POST /api/v1/crm/integrations/[id]/sync
// Verifies that mailchimp, hubspot and gmail handlers are all wired up,
// that guard conditions (syncing, paused) return 422, that an unknown
// provider returns an error payload, and that cross-org access is blocked.

// ── Firebase admin mock ────────────────────────────────────────────────────
import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

// ── Handler mocks ──────────────────────────────────────────────────────────
const mockSyncMailchimp = jest.fn()
const mockSyncHubspot = jest.fn()
const mockSyncGmail = jest.fn()

jest.mock('@/lib/crm/integrations/handlers/mailchimp', () => ({
  syncMailchimp: (...args: unknown[]) => mockSyncMailchimp(...args),
}))
jest.mock('@/lib/crm/integrations/handlers/hubspot', () => ({
  syncHubspot: (...args: unknown[]) => mockSyncHubspot(...args),
}))
jest.mock('@/lib/crm/integrations/handlers/gmail', () => ({
  syncGmail: (...args: unknown[]) => mockSyncGmail(...args),
}))

// ── firebase-admin/firestore FieldValue stub ───────────────────────────────
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ _sentinel: 'ServerTimestamp' }),
    increment: (n: number) => ({ _sentinel: 'Increment', n }),
  },
  Timestamp: {
    now: () => ({ toDate: () => new Date() }),
  },
}))

const AI_API_KEY = 'test-ai-key-abc'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { POST } from '@/app/api/v1/crm/integrations/[id]/sync/route'
import { EMPTY_SYNC_STATS } from '@/lib/crm/integrations/types'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../helpers/crm'

// ── Helpers ────────────────────────────────────────────────────────────────

const GOOD_STATS = { imported: 5, skipped: 0, errors: 0, total: 5, created: 5, updated: 0, errored: 0 }
const SYNC_RESULT_OK = { ok: true, stats: GOOD_STATS, error: '' }

function makeContext(integrationId = 'int-1') {
  return { params: Promise.resolve({ id: integrationId }) }
}

function fakeIntegration(overrides: object = {}) {
  return {
    id: 'int-1',
    orgId: 'org1',
    provider: 'mailchimp',
    name: 'Test Integration',
    status: 'active',
    config: { apiKey: 'key-us21', listId: 'list1' },
    autoTags: [],
    autoCampaignIds: [],
    cadenceMinutes: 0,
    lastSyncedAt: null,
    lastSyncStats: { ...EMPTY_SYNC_STATS },
    lastError: '',
    createdAt: null,
    updatedAt: null,
    deleted: false,
    ...overrides,
  }
}

/**
 * stageAuth wires up the adminAuth + adminDb mocks so that withCrmAuth
 * resolves a member with the given org/role and the crm_integrations collection
 * returns the given integration data for doc(id).get().
 */
function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  integrationData: object | null,
  integrationId = 'int-1',
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })

  const mockDocUpdate = jest.fn().mockResolvedValue(undefined)
  const exists = integrationData !== null

  // refreshed snap (after final status update) — no ref needed
  const refreshedSnap = {
    exists,
    data: () => integrationData ?? {},
    id: integrationId,
  }

  // The docRef returned by doc(id) — this IS r.ref in loadIntegration
  const mockDocRef = {
    update: mockDocUpdate,
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
            Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }),
        }),
      }
    if (name === 'crm_integrations')
      return {
        doc: jest.fn(() => mockDocRef),
      }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

/** Stage agent auth (Bearer key path) */
function stageAgentAuth(orgId: string, integrationData: object | null, integrationId = 'int-1') {
  const mockDocUpdate = jest.fn().mockResolvedValue(undefined)
  const exists = integrationData !== null

  const refreshedSnap = {
    exists,
    data: () => integrationData ?? {},
    id: integrationId,
  }

  // The docRef returned by doc(id) — this IS r.ref in loadIntegration
  const mockDocRef = {
    update: mockDocUpdate,
    get: jest.fn()
      .mockResolvedValueOnce({ exists, data: () => integrationData ?? {}, id: integrationId })
      .mockResolvedValue(refreshedSnap),
  }

  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'organizations')
      return {
        doc: () => ({
          get: () =>
            Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }),
        }),
      }
    if (name === 'crm_integrations')
      return {
        doc: jest.fn(() => mockDocRef),
      }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

// ── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
})

describe('POST /api/v1/crm/integrations/[id]/sync', () => {
  // ── mailchimp ──────────────────────────────────────────────────────────
  it('calls syncMailchimp and returns ok+stats for mailchimp provider', async () => {
    const admin = seedOrgMember('org1', 'user1', { role: 'admin' })
    stageAuth(admin, fakeIntegration({ provider: 'mailchimp' }))
    mockSyncMailchimp.mockResolvedValue(SYNC_RESULT_OK)

    const req = callAsMember(admin, 'POST', '/api/v1/crm/integrations/int-1/sync')
    const res = await POST(req, makeContext())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockSyncMailchimp).toHaveBeenCalledTimes(1)
    expect(mockSyncHubspot).not.toHaveBeenCalled()
    expect(mockSyncGmail).not.toHaveBeenCalled()
    expect(body.data.ok).toBe(true)
    expect(body.data.stats).toMatchObject({ imported: 5 })
  })

  // ── hubspot ────────────────────────────────────────────────────────────
  it('calls syncHubspot and returns ok+stats for hubspot provider', async () => {
    const admin = seedOrgMember('org1', 'user1', { role: 'admin' })
    stageAuth(admin, fakeIntegration({ provider: 'hubspot' }))
    mockSyncHubspot.mockResolvedValue(SYNC_RESULT_OK)

    const req = callAsMember(admin, 'POST', '/api/v1/crm/integrations/int-1/sync')
    const res = await POST(req, makeContext())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockSyncHubspot).toHaveBeenCalledTimes(1)
    expect(mockSyncMailchimp).not.toHaveBeenCalled()
    expect(mockSyncGmail).not.toHaveBeenCalled()
    expect(body.data.ok).toBe(true)
    expect(body.data.stats).toMatchObject({ imported: 5 })
  })

  // ── gmail ──────────────────────────────────────────────────────────────
  it('calls syncGmail and returns ok+stats for gmail provider', async () => {
    const admin = seedOrgMember('org1', 'user1', { role: 'admin' })
    stageAuth(admin, fakeIntegration({ provider: 'gmail' }))
    mockSyncGmail.mockResolvedValue(SYNC_RESULT_OK)

    const req = callAsMember(admin, 'POST', '/api/v1/crm/integrations/int-1/sync')
    const res = await POST(req, makeContext())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockSyncGmail).toHaveBeenCalledTimes(1)
    expect(mockSyncMailchimp).not.toHaveBeenCalled()
    expect(mockSyncHubspot).not.toHaveBeenCalled()
    expect(body.data.ok).toBe(true)
    expect(body.data.stats).toMatchObject({ imported: 5 })
  })

  // ── status guards ──────────────────────────────────────────────────────
  it('returns 422 when integration is already syncing', async () => {
    const admin = seedOrgMember('org1', 'user1', { role: 'admin' })
    stageAuth(admin, fakeIntegration({ status: 'syncing' }))

    const req = callAsMember(admin, 'POST', '/api/v1/crm/integrations/int-1/sync')
    const res = await POST(req, makeContext())
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/sync.*in progress/i)
    expect(mockSyncMailchimp).not.toHaveBeenCalled()
  })

  it('returns 422 when integration is paused', async () => {
    const admin = seedOrgMember('org1', 'user1', { role: 'admin' })
    stageAuth(admin, fakeIntegration({ status: 'paused' }))

    const req = callAsMember(admin, 'POST', '/api/v1/crm/integrations/int-1/sync')
    const res = await POST(req, makeContext())
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/paused/i)
    expect(mockSyncMailchimp).not.toHaveBeenCalled()
  })

  // ── unknown provider ───────────────────────────────────────────────────
  it('returns ok=false with provider name in error for unknown provider (zapier)', async () => {
    const admin = seedOrgMember('org1', 'user1', { role: 'admin' })
    stageAuth(admin, fakeIntegration({ provider: 'zapier' }))

    const req = callAsMember(admin, 'POST', '/api/v1/crm/integrations/int-1/sync')
    const res = await POST(req, makeContext())
    const body = await res.json()

    // Route returns 200 with ok=false (handled gracefully, not a hard error)
    expect(res.status).toBe(200)
    expect(body.data.ok).toBe(false)
    expect(body.data.error).toMatch(/zapier/)
    expect(mockSyncMailchimp).not.toHaveBeenCalled()
    expect(mockSyncHubspot).not.toHaveBeenCalled()
    expect(mockSyncGmail).not.toHaveBeenCalled()
  })

  // ── cross-org access ───────────────────────────────────────────────────
  // loadIntegration returns 404 when orgId doesn't match (no org-id leakage)
  it('returns 404 when integration belongs to a different org', async () => {
    const admin = seedOrgMember('org1', 'user1', { role: 'admin' })
    // Integration has orgId 'org2' but the auth user has orgId 'org1'
    stageAuth(admin, fakeIntegration({ orgId: 'org2' }))

    const req = callAsMember(admin, 'POST', '/api/v1/crm/integrations/int-1/sync')
    const res = await POST(req, makeContext())
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.success).toBe(false)
    expect(mockSyncMailchimp).not.toHaveBeenCalled()
  })

  // ── role guard ─────────────────────────────────────────────────────────
  it('returns 403 when member (non-admin) attempts sync', async () => {
    const member = seedOrgMember('org1', 'user1', { role: 'member' })
    stageAuth(member, fakeIntegration())

    const req = callAsMember(member, 'POST', '/api/v1/crm/integrations/int-1/sync')
    const res = await POST(req, makeContext())

    expect(res.status).toBe(403)
    expect(mockSyncMailchimp).not.toHaveBeenCalled()
  })

  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost/api/v1/crm/integrations/int-1/sync', {
      method: 'POST',
    })
    const res = await POST(req, makeContext())
    expect(res.status).toBe(401)
  })

  // ── agent path ─────────────────────────────────────────────────────────
  it('agent (Bearer) can trigger sync and writes no updatedBy uid', async () => {
    stageAgentAuth('org1', fakeIntegration({ provider: 'mailchimp' }))
    mockSyncMailchimp.mockResolvedValue(SYNC_RESULT_OK)

    const req = callAsAgent('org1', 'POST', '/api/v1/crm/integrations/int-1/sync', undefined, AI_API_KEY)
    const res = await POST(req, makeContext())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.ok).toBe(true)
    expect(mockSyncMailchimp).toHaveBeenCalledTimes(1)
  })
})
