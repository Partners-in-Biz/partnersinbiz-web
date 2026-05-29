jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

jest.mock('@/lib/webhooks/dispatch', () => ({ dispatchWebhook: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/activity/log', () => ({ logActivity: jest.fn().mockResolvedValue(undefined) }))

jest.mock('@/lib/integrations/crypto', () => ({
  encryptCredentials: jest.fn(() => ({ enc: 'X', tag: 't', iv: 'i', keyVersion: 1 })),
  decryptCredentials: jest.fn(() => ({ apiKey: 'test' })),
}))

// Mock per-provider sync handlers (individually — sync/route.ts imports them by path)
jest.mock('@/lib/crm/integrations/handlers/mailchimp', () => ({
  syncMailchimp: jest.fn().mockResolvedValue({ ok: true, stats: { imported: 1, created: 1, updated: 0, skipped: 0, errored: 0 }, error: '' }),
}))
jest.mock('@/lib/crm/integrations/handlers/hubspot', () => ({
  syncHubspot: jest.fn().mockResolvedValue({ ok: true, stats: { imported: 0, created: 0, updated: 0, skipped: 0, errored: 0 }, error: '' }),
}))
jest.mock('@/lib/crm/integrations/handlers/gmail', () => ({
  syncGmail: jest.fn().mockResolvedValue({ ok: true, stats: { imported: 0, created: 0, updated: 0, skipped: 0, errored: 0 }, error: '' }),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../helpers/crm'

const AI_API_KEY = 'test-ai-key'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

type OrgDoc = { id: string; data: () => { orgId: string } }
type ChainQuery = {
  where: jest.Mock
  orderBy: jest.Mock
  limit: jest.Mock
  get: () => Promise<{ docs: OrgDoc[] }>
}

function memberRef(value: unknown): { uid?: string; displayName?: string } {
  return value as { uid?: string; displayName?: string }
}

// Use distinct uids to avoid substring collisions (PR 3 lesson)
const memberA = seedOrgMember('org-a', 'uid-amem', { role: 'member', firstName: 'A', lastName: 'M' })
const adminA  = seedOrgMember('org-a', 'uid-aadm', { role: 'admin',  firstName: 'A', lastName: 'A' })
const memberB = seedOrgMember('org-b', 'uid-bmem', { role: 'member', firstName: 'B', lastName: 'M' })

const captureSourceA = {
  id: 'cs-a',
  orgId: 'org-a',
  name: 'Form A',
  type: 'form',
  publicKey: 'pk-a',
  enabled: true,
  deleted: false,
  autoTags: [],
  autoCampaignIds: [],
  redirectUrl: '',
  consentRequired: false,
  capturedCount: 0,
  lastCapturedAt: null,
}
const captureSourceB = {
  id: 'cs-b',
  orgId: 'org-b',
  name: 'Form B',
  type: 'form',
  publicKey: 'pk-b',
  enabled: true,
  deleted: false,
  autoTags: [],
  autoCampaignIds: [],
  redirectUrl: '',
  consentRequired: false,
  capturedCount: 0,
  lastCapturedAt: null,
}

const integrationA = {
  id: 'int-a',
  orgId: 'org-a',
  provider: 'mailchimp',
  name: 'MC A',
  status: 'active',
  configEnc: { enc: 'X', tag: 't', iv: 'i', keyVersion: 1 },
  config: { apiKey: 'test' },
  autoTags: [],
  autoCampaignIds: [],
  cadenceMinutes: 0,
  lastSyncedAt: null,
  lastSyncStats: { imported: 0, created: 0, updated: 0, skipped: 0, errored: 0 },
  lastError: '',
  deleted: false,
}
const integrationB = {
  id: 'int-b',
  orgId: 'org-b',
  provider: 'mailchimp',
  name: 'MC B',
  status: 'active',
  configEnc: { enc: 'X', tag: 't', iv: 'i', keyVersion: 1 },
  config: { apiKey: 'test' },
  autoTags: [],
  autoCampaignIds: [],
  cadenceMinutes: 0,
  lastSyncedAt: null,
  lastSyncStats: { imported: 0, created: 0, updated: 0, skipped: 0, errored: 0 },
  lastError: '',
  deleted: false,
}

/**
 * where-respecting mock pattern (PR 3 lesson):
 * Captures the orgId filter set by .where('orgId', '==', value) and returns
 * only matching docs from get(). A route that forgets to call .where('orgId')
 * would return docs for both orgs, causing isolation tests to fail.
 */
function setupIsolationFixtures() {
  const captured = {
    captureSourceAdds:    [] as Array<Record<string, unknown>>,
    captureSourceUpdates: [] as Array<Record<string, unknown>>,
    integrationAdds:      [] as Array<Record<string, unknown>>,
    integrationUpdates:   [] as Array<Record<string, unknown>>,
  }

  ;(adminAuth.verifySessionCookie as jest.Mock).mockImplementation((cookie: string) => {
    if (cookie.endsWith(memberA.uid)) return Promise.resolve({ uid: memberA.uid })
    if (cookie.endsWith(adminA.uid))  return Promise.resolve({ uid: adminA.uid })
    if (cookie.endsWith(memberB.uid)) return Promise.resolve({ uid: memberB.uid })
    return Promise.reject(new Error('invalid'))
  })

  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {

    // ── users ────────────────────────────────────────────────────────
    if (name === 'users') {
      return {
        doc: (uid: string) => ({
          get: () => Promise.resolve({
            exists: true,
            data: () => ({
              activeOrgId:
                uid === memberA.uid || uid === adminA.uid ? 'org-a' : 'org-b',
            }),
          }),
        }),
      }
    }

    // ── orgMembers ───────────────────────────────────────────────────
    if (name === 'orgMembers') {
      return {
        doc: (id: string) => ({
          get: () => Promise.resolve({
            exists: true,
            data: () => (
              id === `org-a_${memberA.uid}` ? memberA :
              id === `org-a_${adminA.uid}`  ? adminA  :
              id === `org-b_${memberB.uid}` ? memberB :
              { uid: id.split('_')[1], firstName: 'X', lastName: 'Y' }
            ),
          }),
        }),
        where: (_field: string, _op: string, value: string) => ({
          get: () =>
            Promise.resolve({
              docs: [
                { id: `org-a_${memberA.uid}`, data: () => memberA },
                { id: `org-a_${adminA.uid}`, data: () => adminA },
                { id: `org-b_${memberB.uid}`, data: () => memberB },
              ].filter((doc) => doc.data().uid === value),
            }),
        }),
      }
    }

    // ── organizations ────────────────────────────────────────────────
    if (name === 'organizations') {
      return {
        doc: () => ({
          get: () => Promise.resolve({
            exists: true,
            data: () => ({ settings: { permissions: {} } }),
          }),
        }),
      }
    }

    // ── capture_sources ──────────────────────────────────────────────
    if (name === 'capture_sources') {
      let whereOrgFilter: string | undefined
      const query = {} as ChainQuery
      query.where = jest.fn((field: string, op: string, value: unknown) => {
          if (field === 'orgId' && op === '==') {
            whereOrgFilter = typeof value === 'string' ? value : undefined
          }
          return query
        })
      query.orderBy = jest.fn(() => query)
      query.limit = jest.fn(() => query)
      query.get = () =>
        Promise.resolve({
          docs: [
            { id: 'cs-a', data: () => captureSourceA },
            { id: 'cs-b', data: () => captureSourceB },
          ].filter(d =>
            whereOrgFilter === undefined ||
            d.data().orgId === whereOrgFilter,
          ),
        })
      return {
        add: jest.fn((data: Record<string, unknown>) => {
          captured.captureSourceAdds.push(data)
          const fakeRef = {
            id: 'auto-cs',
            get: () => Promise.resolve({
              exists: true,
              data: () => ({ ...data, id: 'auto-cs' }),
            }),
          }
          return Promise.resolve(fakeRef)
        }),
        doc: jest.fn().mockImplementation((id?: string) => ({
          id: id ?? 'auto-cs',
          get: () => Promise.resolve({
            exists: id === 'cs-a' || id === 'cs-b',
            id: id ?? 'auto-cs',
            data: () => (
              id === 'cs-a' ? captureSourceA :
              id === 'cs-b' ? captureSourceB :
              undefined
            ),
          }),
          update: jest.fn((data: Record<string, unknown>) => {
            captured.captureSourceUpdates.push(data)
            return Promise.resolve()
          }),
        })),
        ...query,
      }
    }

    // ── crm_integrations ─────────────────────────────────────────────
    if (name === 'crm_integrations') {
      let whereOrgFilter: string | undefined
      const query = {} as ChainQuery
      query.where = jest.fn((field: string, op: string, value: unknown) => {
          if (field === 'orgId' && op === '==') {
            whereOrgFilter = typeof value === 'string' ? value : undefined
          }
          return query
        })
      query.orderBy = jest.fn(() => query)
      query.limit = jest.fn(() => query)
      query.get = () =>
        Promise.resolve({
          docs: [
            { id: 'int-a', data: () => integrationA },
            { id: 'int-b', data: () => integrationB },
          ].filter(d =>
            whereOrgFilter === undefined ||
            d.data().orgId === whereOrgFilter,
          ),
        })
      return {
        add: jest.fn((data: Record<string, unknown>) => {
          captured.integrationAdds.push(data)
          const fakeRef = {
            id: 'auto-int',
            get: () => Promise.resolve({
              exists: true,
              data: () => ({ ...data, id: 'auto-int' }),
            }),
          }
          return Promise.resolve(fakeRef)
        }),
        doc: jest.fn().mockImplementation((id?: string) => ({
          id: id ?? 'auto-int',
          get: () => Promise.resolve({
            exists: id === 'int-a' || id === 'int-b',
            id: id ?? 'auto-int',
            data: () => (
              id === 'int-a' ? integrationA :
              id === 'int-b' ? integrationB :
              undefined
            ),
          }),
          update: jest.fn((data: Record<string, unknown>) => {
            captured.integrationUpdates.push(data)
            return Promise.resolve()
          }),
        })),
        ...query,
      }
    }

    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })

  return captured
}

const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => { jest.clearAllMocks() })

describe('cross-tenant isolation: capture-sources + integrations', () => {

  // ── capture-sources ───────────────────────────────────────────────────────

  it('admin POST capture-source scoped to org-a with createdByRef.displayName=A A', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsMember(adminA, 'POST', '/api/v1/crm/capture-sources', {
      name: 'Test Source', type: 'form',
    })
    const { POST } = await import('@/app/api/v1/crm/capture-sources/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const written = captured.captureSourceAdds.at(-1)
    expect(written?.orgId).toBe('org-a')
    expect(memberRef(written?.createdByRef).displayName).toBe('A A')
  })

  it('agent (Bearer) POST capture-source uses AGENT_PIP_REF', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsAgent('org-a', 'POST', '/api/v1/crm/capture-sources', {
      name: 'Agent Source', type: 'api',
    })
    const { POST } = await import('@/app/api/v1/crm/capture-sources/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const written = captured.captureSourceAdds.at(-1)
    expect(memberRef(written?.createdByRef).uid).toBe('agent:pip')
    expect(written?.orgId).toBe('org-a')
  })

  it('member POST capture-source → 403 (admin required)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberA, 'POST', '/api/v1/crm/capture-sources', {
      name: 'Test Source', type: 'form',
    })
    const { POST } = await import('@/app/api/v1/crm/capture-sources/route')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('admin GET capture-sources returns ONLY org-a (catches missing where clause)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'GET', '/api/v1/crm/capture-sources')
    const { GET } = await import('@/app/api/v1/crm/capture-sources/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const arr = (body.data ?? []) as Array<{ id: string }>
    expect(arr.map(s => s.id)).not.toContain('cs-b')
  })

  it('admin cannot PUT cross-org capture-source → 404', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'PUT', '/api/v1/crm/capture-sources/cs-b', { name: 'Hacked' })
    const { PUT } = await import('@/app/api/v1/crm/capture-sources/[id]/route')
    const res = await PUT(req, routeCtx('cs-b'))
    expect(res.status).toBe(404)
  })

  it('admin cannot DELETE cross-org capture-source → 404', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'DELETE', '/api/v1/crm/capture-sources/cs-b')
    const { DELETE } = await import('@/app/api/v1/crm/capture-sources/[id]/route')
    const res = await DELETE(req, routeCtx('cs-b'))
    expect(res.status).toBe(404)
  })

  // ── integrations ──────────────────────────────────────────────────────────

  it('admin POST integration scoped to org-a with createdByRef', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsMember(adminA, 'POST', '/api/v1/crm/integrations', {
      provider: 'mailchimp',
      name: 'My MC',
      config: { apiKey: 'test-key', listId: 'list-1' },
    })
    const { POST } = await import('@/app/api/v1/crm/integrations/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const written = captured.integrationAdds.at(-1)
    expect(written?.orgId).toBe('org-a')
    expect(memberRef(written?.createdByRef).displayName).toBe('A A')
  })

  it('agent POST integration uses AGENT_PIP_REF and response is toPublicView shape (no raw configEnc)', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsAgent('org-a', 'POST', '/api/v1/crm/integrations', {
      provider: 'mailchimp',
      name: 'Agent MC',
      config: { apiKey: 'agent-key', listId: 'list-2' },
    })
    const { POST } = await import('@/app/api/v1/crm/integrations/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const written = captured.integrationAdds.at(-1)
    expect(memberRef(written?.createdByRef).uid).toBe('agent:pip')
    // Response must be toPublicView shape — no raw configEnc in body
    const body = await res.json()
    expect(body.data).not.toHaveProperty('configEnc')
    expect(body.data).not.toHaveProperty('config')
  })

  it('member POST integration → 403', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberA, 'POST', '/api/v1/crm/integrations', {
      provider: 'mailchimp', name: 'My MC', config: { apiKey: 'k', listId: 'l' },
    })
    const { POST } = await import('@/app/api/v1/crm/integrations/route')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('admin GET integrations list returns ONLY org-a entries', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'GET', '/api/v1/crm/integrations')
    const { GET } = await import('@/app/api/v1/crm/integrations/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const arr = (body.data ?? []) as Array<{ id: string }>
    expect(arr.map(i => i.id)).not.toContain('int-b')
  })

  it('admin cannot GET cross-org integration → 404', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'GET', '/api/v1/crm/integrations/int-b')
    const { GET } = await import('@/app/api/v1/crm/integrations/[id]/route')
    const res = await GET(req, routeCtx('int-b'))
    expect(res.status).toBe(404)
  })

  it('admin cannot PUT cross-org integration → 404', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'PUT', '/api/v1/crm/integrations/int-b', { name: 'Hacked' })
    const { PUT } = await import('@/app/api/v1/crm/integrations/[id]/route')
    const res = await PUT(req, routeCtx('int-b'))
    expect(res.status).toBe(404)
  })

  it('admin cannot DELETE cross-org integration → 404', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'DELETE', '/api/v1/crm/integrations/int-b')
    const { DELETE } = await import('@/app/api/v1/crm/integrations/[id]/route')
    const res = await DELETE(req, routeCtx('int-b'))
    expect(res.status).toBe(404)
  })

  it('admin cannot POST /sync cross-org integration → 404', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'POST', '/api/v1/crm/integrations/int-b/sync')
    const { POST } = await import('@/app/api/v1/crm/integrations/[id]/sync/route')
    const res = await POST(req, routeCtx('int-b'))
    expect(res.status).toBe(404)
  })

  it('sync writes updatedByRef on status transitions', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsMember(adminA, 'POST', '/api/v1/crm/integrations/int-a/sync')
    const { POST } = await import('@/app/api/v1/crm/integrations/[id]/sync/route')
    const res = await POST(req, routeCtx('int-a'))
    expect(res.status).toBeLessThan(300)
    // Should have at least two updates: status→'syncing' and status→'active'/'error'
    const updates = captured.integrationUpdates
    expect(updates.length).toBeGreaterThanOrEqual(2)
    // Each update should carry updatedByRef
    for (const upd of updates) {
      expect(upd).toHaveProperty('updatedByRef')
    }
  })
})
