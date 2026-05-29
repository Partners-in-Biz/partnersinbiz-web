/**
 * Tests for POST /api/v1/crm/companies/bulk
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn(), batch: jest.fn() },
}))

jest.mock('firebase-admin/firestore', () => {
  const serverTimestampSentinel = { _type: 'serverTimestamp' }
  const deleteSentinel = { _type: 'deleteField' }
  return {
    FieldValue: {
      serverTimestamp: () => serverTimestampSentinel,
      delete: () => deleteSentinel,
      arrayUnion: (...vals: unknown[]) => ({ _type: 'arrayUnion', vals }),
      arrayRemove: (...vals: unknown[]) => ({ _type: 'arrayRemove', vals }),
    },
    Timestamp: {
      now: () => ({ seconds: 3000, nanoseconds: 0, toDate: () => new Date() }),
    },
  }
})

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../../helpers/crm'
import { uidFor } from './_fixtures'

const AI_API_KEY = 'test-ai-key-companies-bulk'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ── Test doubles ────────────────────────────────────────────────────────────

function makeCompanySnap(
  id: string,
  orgId: string,
  overrides: Record<string, unknown> = {},
) {
  const data = {
    orgId,
    name: `Company ${id}`,
    deleted: false,
    ...overrides,
  }
  return {
    exists: true,
    id,
    ref: { id, update: jest.fn().mockResolvedValue(undefined) },
    data: () => data,
  }
}

function missingSnap(id: string) {
  return { exists: false, id, ref: { id } }
}

type CompanyDocMap = Record<
  string,
  ReturnType<typeof makeCompanySnap> | ReturnType<typeof missingSnap>
>

// ── stageAuth ────────────────────────────────────────────────────────────────

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  companyDocs: CompanyDocMap = {},
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })

  const batchUpdateFn = jest.fn()
  const batchCommitFn = jest.fn().mockResolvedValue(undefined)
  ;(adminDb.batch as jest.Mock).mockReturnValue({ update: batchUpdateFn, commit: batchCommitFn })

  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }),
        }),
      }
    }
    if (name === 'orgMembers') {
      const callerKey = `${member.orgId}_${member.uid}`
      const callerDoc = {
        id: callerKey,
        exists: true,
        data: () => ({ ...member, orgId: member.orgId, uid: member.uid }),
      }

      return {
        where: (field: string, op: string, value: string) => ({
          get: () => {
            if (field === 'uid' && op === '==' && value === member.uid) {
              return Promise.resolve({ docs: [callerDoc] })
            }
            return Promise.resolve({ docs: [] })
          },
        }),
        doc: () => ({
          get: () => Promise.resolve(callerDoc),
        }),
      }
    }
    if (name === 'organizations') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }),
        }),
      }
    }
    if (name === 'companies') {
      return {
        doc: (id: string) => {
          const snap = companyDocs[id] ?? missingSnap(id)
          return { get: () => Promise.resolve(snap) }
        },
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })

  return { batchUpdateFn, batchCommitFn }
}

function orgCompanies(
  orgId: string,
  ids: string[],
  overrides: Record<string, unknown> = {},
): CompanyDocMap {
  return Object.fromEntries(ids.map((id) => [id, makeCompanySnap(id, orgId, overrides)]))
}

// Import route module once
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let bulkRoute: any
beforeAll(async () => {
  bulkRoute = await import('@/app/api/v1/crm/companies/bulk/route')
})

beforeEach(() => { jest.clearAllMocks() })

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/crm/companies/bulk', () => {
  // ── Happy path ─────────────────────────────────────────────────────────────

  it('bulk-updates tier for 3 own-org companies → updated: 3, skipped: 0', async () => {
    const uid = uidFor('member')
    const member = seedOrgMember('org-A', uid, { role: 'member' })
    const ids = ['co1', 'co2', 'co3']
    const { batchUpdateFn } = stageAuth(member, orgCompanies('org-A', ids))

    const req = callAsMember(member, 'POST', '/api/v1/crm/companies/bulk', {
      ids,
      patch: { tier: 'enterprise' },
    })
    const res = await bulkRoute.POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.updated).toBe(3)
    expect(body.data.skipped).toBe(0)
    expect(batchUpdateFn).toHaveBeenCalledTimes(3)
    const written = batchUpdateFn.mock.calls[0][1]
    expect(written.tier).toBe('enterprise')
    expect(written.updatedByRef).toBeDefined()
  })

  it('bulk-updates lifecycleStage for companies', async () => {
    const uid = uidFor('member2')
    const member = seedOrgMember('org-B', uid, { role: 'member' })
    const ids = ['co4', 'co5']
    const { batchUpdateFn } = stageAuth(member, orgCompanies('org-B', ids))

    const req = callAsMember(member, 'POST', '/api/v1/crm/companies/bulk', {
      ids,
      patch: { lifecycleStage: 'customer' },
    })
    const res = await bulkRoute.POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.updated).toBe(2)
    const written = batchUpdateFn.mock.calls[0][1]
    expect(written.lifecycleStage).toBe('customer')
  })

  // ── Cross-tenant skip ──────────────────────────────────────────────────────

  it('skips cross-org company IDs', async () => {
    const uid = uidFor('member3')
    const member = seedOrgMember('org-A', uid, { role: 'member' })
    const ownId = 'co-own'
    const crossId = 'co-cross'
    const docs: CompanyDocMap = {
      [ownId]: makeCompanySnap(ownId, 'org-A'),
      [crossId]: makeCompanySnap(crossId, 'org-B'), // wrong org
    }
    stageAuth(member, docs)

    const req = callAsMember(member, 'POST', '/api/v1/crm/companies/bulk', {
      ids: [ownId, crossId],
      patch: { tier: 'smb' },
    })
    const res = await bulkRoute.POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.updated).toBe(1)
    expect(body.data.skipped).toBe(1)
  })

  it('skips non-existent company IDs', async () => {
    const uid = uidFor('member4')
    const member = seedOrgMember('org-A', uid, { role: 'member' })
    const ownId = 'co-exists'
    const docs: CompanyDocMap = {
      [ownId]: makeCompanySnap(ownId, 'org-A'),
      'co-ghost': missingSnap('co-ghost'),
    }
    stageAuth(member, docs)

    const req = callAsMember(member, 'POST', '/api/v1/crm/companies/bulk', {
      ids: [ownId, 'co-ghost'],
      patch: { industry: 'SaaS' },
    })
    const res = await bulkRoute.POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.updated).toBe(1)
    expect(body.data.skipped).toBe(1)
  })

  it('skips soft-deleted companies', async () => {
    const uid = uidFor('member5')
    const member = seedOrgMember('org-A', uid, { role: 'member' })
    const activeId = 'co-active'
    const deletedId = 'co-deleted'
    const docs: CompanyDocMap = {
      [activeId]: makeCompanySnap(activeId, 'org-A'),
      [deletedId]: makeCompanySnap(deletedId, 'org-A', { deleted: true }),
    }
    stageAuth(member, docs)

    const req = callAsMember(member, 'POST', '/api/v1/crm/companies/bulk', {
      ids: [activeId, deletedId],
      patch: { size: '51-200' },
    })
    const res = await bulkRoute.POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.updated).toBe(1)
    expect(body.data.skipped).toBe(1)
  })

  // ── Validation ────────────────────────────────────────────────────────────

  it('returns 400 for empty ids array', async () => {
    const uid = uidFor('member6')
    const member = seedOrgMember('org-A', uid, { role: 'member' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/companies/bulk', {
      ids: [],
      patch: { tier: 'smb' },
    })
    const res = await bulkRoute.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/non-empty/i)
  })

  it('returns 400 for more than 200 ids', async () => {
    const uid = uidFor('member7')
    const member = seedOrgMember('org-A', uid, { role: 'member' })
    stageAuth(member)

    const ids = Array.from({ length: 201 }, (_, i) => `co${i}`)
    const req = callAsMember(member, 'POST', '/api/v1/crm/companies/bulk', {
      ids,
      patch: { tier: 'smb' },
    })
    const res = await bulkRoute.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/200/i)
  })

  it('returns 400 for empty patch object', async () => {
    const uid = uidFor('member8')
    const member = seedOrgMember('org-A', uid, { role: 'member' })
    stageAuth(member, orgCompanies('org-A', ['co1']))

    const req = callAsMember(member, 'POST', '/api/v1/crm/companies/bulk', {
      ids: ['co1'],
      patch: {},
    })
    const res = await bulkRoute.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/at least one field/i)
  })

  it('returns 400 for invalid bulk field', async () => {
    const uid = uidFor('member9')
    const member = seedOrgMember('org-A', uid, { role: 'member' })
    stageAuth(member, orgCompanies('org-A', ['co1']))

    const req = callAsMember(member, 'POST', '/api/v1/crm/companies/bulk', {
      ids: ['co1'],
      patch: { deleted: true }, // not in COMPANY_BULK_FIELDS
    })
    const res = await bulkRoute.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Invalid bulk field/i)
  })

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('returns 403 for viewer', async () => {
    const uid = uidFor('viewer')
    const member = seedOrgMember('org-A', uid, { role: 'viewer' })
    stageAuth(member, orgCompanies('org-A', ['co1']))

    const req = callAsMember(member, 'POST', '/api/v1/crm/companies/bulk', {
      ids: ['co1'],
      patch: { tier: 'enterprise' },
    })
    const res = await bulkRoute.POST(req)
    expect(res.status).toBe(403)
  })

  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost/api/v1/crm/companies/bulk', {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ ids: ['co1'], patch: { tier: 'smb' } }),
    })
    const res = await bulkRoute.POST(req)
    expect(res.status).toBe(401)
  })

  it('agent (Bearer) can bulk-update companies', async () => {
    const ids = ['ca1', 'ca2']
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'organizations') {
        return {
          doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }),
        }
      }
      if (name === 'companies') {
        return {
          doc: (id: string) => ({
            get: () => Promise.resolve(makeCompanySnap(id, 'org-agent')),
          }),
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    const batchUpdateFn = jest.fn()
    const batchCommitFn = jest.fn().mockResolvedValue(undefined)
    ;(adminDb.batch as jest.Mock).mockReturnValue({ update: batchUpdateFn, commit: batchCommitFn })

    const req = callAsAgent('org-agent', 'POST', '/api/v1/crm/companies/bulk', {
      ids,
      patch: { tier: 'enterprise' },
    }, AI_API_KEY)
    const res = await bulkRoute.POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.updated).toBe(2)
  })

  // ── Attribution ────────────────────────────────────────────────────────────

  it('writes updatedByRef attribution on batch update', async () => {
    const uid = uidFor('member-attr')
    const member = seedOrgMember('org-attr', uid, { role: 'member', firstName: 'Dan', lastName: 'V' })
    const ids = ['co-attr']
    const { batchUpdateFn } = stageAuth(member, orgCompanies('org-attr', ids))

    const req = callAsMember(member, 'POST', '/api/v1/crm/companies/bulk', {
      ids,
      patch: { accountManagerUid: 'some-am-uid' },
    })
    const res = await bulkRoute.POST(req)
    expect(res.status).toBe(200)
    const written = batchUpdateFn.mock.calls[0][1]
    expect(written.updatedByRef.displayName).toBe('Dan V')
    expect(written.updatedByRef.kind).toBe('human')
    expect(written.updatedAt._type).toBe('serverTimestamp')
  })
})
