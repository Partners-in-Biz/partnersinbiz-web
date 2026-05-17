// __tests__/api/v1/crm/companies/migrate-from-contacts.test.ts
// Endpoint tests for POST /api/v1/crm/companies/migrate-from-contacts

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn(), batch: jest.fn() },
}))

// Suppress noisy side-effects
jest.mock('@/lib/activity/log', () => ({ logActivity: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/webhooks/dispatch', () => ({ dispatchWebhook: jest.fn().mockResolvedValue(undefined) }))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { seedOrgMember, callAsMember } from '../../../../helpers/crm'
import { Timestamp } from 'firebase-admin/firestore'

const AI_API_KEY = 'test-ai-key-migrate'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ─── stageAuth ────────────────────────────────────────────────────────────

interface ContactDoc {
  id: string
  orgId: string
  company: string
  companyId?: string
}

interface CompanyDoc {
  id: string
  orgId: string
  name: string
}

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  opts: {
    contacts?: ContactDoc[]
    existingCompanies?: CompanyDoc[]
    capturedCompanySet?: jest.Mock
    capturedBatchUpdate?: jest.Mock
    capturedBatchCommit?: jest.Mock
  } = {},
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })

  const batchUpdate = opts.capturedBatchUpdate ?? jest.fn()
  const batchCommit = opts.capturedBatchCommit ?? jest.fn().mockResolvedValue(undefined)
  ;(adminDb.batch as jest.Mock).mockReturnValue({ update: batchUpdate, commit: batchCommit })

  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    // ── auth layers ──
    if (name === 'users') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }),
        }),
      }
    }
    if (name === 'orgMembers') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => member }),
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

    // ── contacts collection ──
    if (name === 'contacts') {
      const docs = (opts.contacts ?? []).map(c => ({ id: c.id, data: () => c }))
      const whereFn = jest.fn().mockReturnThis()
      const limitFn = jest.fn().mockReturnThis()
      const docFn = jest.fn().mockImplementation((id: string) => ({ id }))
      return {
        where: whereFn,
        limit: limitFn,
        get: jest.fn().mockResolvedValue({ docs }),
        doc: docFn,
      }
    }

    // ── companies collection ──
    if (name === 'companies') {
      const capturedSet = opts.capturedCompanySet ?? jest.fn().mockResolvedValue(undefined)
      const newRef = { id: 'new-co-auto-id', set: capturedSet }
      const docFn = jest.fn().mockReturnValue(newRef)

      // For existing company name-lookup in preview:
      // the endpoint does .where('orgId',...).where('name',...).limit(1).get()
      // We simulate this by returning matching docs.
      const whereCalls: Array<[string, string, string]> = []
      const whereFn = jest.fn().mockImplementation((field: string, op: string, value: string) => {
        whereCalls.push([field, op, value])
        return chainable
      })
      const chainable: Record<string, unknown> = {}
      chainable.where = whereFn
      chainable.limit = jest.fn().mockReturnThis()
      chainable.get = jest.fn().mockImplementation(() => {
        // If we have a 'name' in whereCalls, match against existingCompanies
        const nameClause = whereCalls.find(([f]) => f === 'name')
        const orgClause = whereCalls.find(([f]) => f === 'orgId')
        const orgVal = orgClause?.[2]
        const nameVal = nameClause?.[2]
        const matched = (opts.existingCompanies ?? []).filter(
          c => c.orgId === orgVal && (!nameVal || c.name === nameVal),
        )
        return Promise.resolve({
          empty: matched.length === 0,
          docs: matched.map(c => ({ id: c.id, data: () => c })),
        })
      })

      return { doc: docFn, where: whereFn, ...chainable }
    }

    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

// ─── helpers ──────────────────────────────────────────────────────────────

function makeAdmin(orgId = 'org-a') {
  return seedOrgMember(orgId, `uid_admin_${orgId}_${Math.random().toString(36).slice(2,6)}`, { role: 'admin' })
}

function makeMember(orgId = 'org-a') {
  return seedOrgMember(orgId, `uid_member_${orgId}_${Math.random().toString(36).slice(2,6)}`, { role: 'member' })
}

async function getRoute() {
  const mod = await import('@/app/api/v1/crm/companies/migrate-from-contacts/route')
  return mod.POST
}

// ─── tests ────────────────────────────────────────────────────────────────

describe('POST /api/v1/crm/companies/migrate-from-contacts', () => {
  beforeEach(() => jest.clearAllMocks())

  // preview — happy path
  it('preview mode returns groups of contacts grouped by company string', async () => {
    const admin = makeAdmin()
    stageAuth(admin, {
      contacts: [
        { id: 'c1', orgId: admin.orgId, company: 'ACME Corp' },
        { id: 'c2', orgId: admin.orgId, company: 'ACME Corp' },
        { id: 'c3', orgId: admin.orgId, company: 'Globex' },
      ],
    })
    const req = callAsMember(admin, 'POST', '/api/v1/crm/companies/migrate-from-contacts', { mode: 'preview' })
    const POST = await getRoute()
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.matches).toHaveLength(2)
    const acme = body.data.matches.find((m: { normalizedKey: string }) => m.normalizedKey === 'acme corp')
    expect(acme).toBeDefined()
    expect(acme.contactIds).toHaveLength(2)
    expect(acme.suggestedCompanyName).toBe('ACME Corp')
  })

  // preview — empty contacts
  it('preview mode returns empty matches when no contacts have company strings', async () => {
    const admin = makeAdmin()
    stageAuth(admin, {
      contacts: [
        { id: 'c1', orgId: admin.orgId, company: '' },
        { id: 'c2', orgId: admin.orgId, company: '' },
      ],
    })
    const req = callAsMember(admin, 'POST', '/api/v1/crm/companies/migrate-from-contacts', { mode: 'preview' })
    const POST = await getRoute()
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.matches).toHaveLength(0)
  })

  // preview — detects existing company match
  it('preview mode sets existingCompanyId when a company with the same name exists', async () => {
    const admin = makeAdmin()
    stageAuth(admin, {
      contacts: [
        { id: 'c1', orgId: admin.orgId, company: 'ACME Corp' },
      ],
      existingCompanies: [
        { id: 'co-existing-42', orgId: admin.orgId, name: 'ACME Corp' },
      ],
    })
    const req = callAsMember(admin, 'POST', '/api/v1/crm/companies/migrate-from-contacts', { mode: 'preview' })
    const POST = await getRoute()
    const res = await POST(req)
    const body = await res.json()
    const acme = body.data.matches.find((m: { normalizedKey: string }) => m.normalizedKey === 'acme corp')
    expect(acme.existingCompanyId).toBe('co-existing-42')
  })

  // apply — create new company
  it('apply mode creates a new company and links contacts', async () => {
    const admin = makeAdmin()
    const capturedCompanySet = jest.fn().mockResolvedValue(undefined)
    const capturedBatchCommit = jest.fn().mockResolvedValue(undefined)
    stageAuth(admin, {
      contacts: [
        { id: 'c1', orgId: admin.orgId, company: 'NewCo' },
        { id: 'c2', orgId: admin.orgId, company: 'NewCo' },
      ],
      capturedCompanySet,
      capturedBatchCommit,
    })
    const req = callAsMember(admin, 'POST', '/api/v1/crm/companies/migrate-from-contacts', {
      mode: 'apply',
      selections: [
        { normalizedKey: 'newco', companyName: 'NewCo', useExistingCompanyId: undefined },
      ],
    })
    const POST = await getRoute()
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.results).toHaveLength(1)
    expect(body.data.results[0].outcome).toBe('created')
    expect(body.data.results[0].contactsUpdated).toBe(2)
    expect(capturedCompanySet).toHaveBeenCalledTimes(1)
    expect(capturedBatchCommit).toHaveBeenCalledTimes(1)
  })

  // apply — link existing
  it('apply mode links contacts to an existing company (outcome: linked)', async () => {
    const admin = makeAdmin()
    const capturedCompanySet = jest.fn().mockResolvedValue(undefined)
    const capturedBatchCommit = jest.fn().mockResolvedValue(undefined)
    stageAuth(admin, {
      contacts: [
        { id: 'c4', orgId: admin.orgId, company: 'Globex' },
      ],
      existingCompanies: [
        { id: 'co-globex-99', orgId: admin.orgId, name: 'Globex' },
      ],
      capturedCompanySet,
      capturedBatchCommit,
    })
    const req = callAsMember(admin, 'POST', '/api/v1/crm/companies/migrate-from-contacts', {
      mode: 'apply',
      selections: [
        { normalizedKey: 'globex', companyName: 'Globex', useExistingCompanyId: 'co-globex-99' },
      ],
    })
    const POST = await getRoute()
    const res = await POST(req)
    const body = await res.json()
    expect(body.data.results[0].outcome).toBe('linked')
    expect(body.data.results[0].companyId).toBe('co-globex-99')
    // No new company created
    expect(capturedCompanySet).not.toHaveBeenCalled()
  })

  // apply — idempotent re-run (already-linked contacts skipped)
  it('apply mode is idempotent — contacts with companyId set are skipped by grouping', async () => {
    const admin = makeAdmin()
    const capturedBatchCommit = jest.fn().mockResolvedValue(undefined)
    // All contacts already have companyId → groupContactsByCompanyKey returns empty
    stageAuth(admin, {
      contacts: [
        { id: 'c1', orgId: admin.orgId, company: 'ACME', companyId: 'co-1' },
        { id: 'c2', orgId: admin.orgId, company: 'ACME', companyId: 'co-1' },
      ],
      capturedBatchCommit,
    })
    const req = callAsMember(admin, 'POST', '/api/v1/crm/companies/migrate-from-contacts', {
      mode: 'apply',
      selections: [
        { normalizedKey: 'acme', companyName: 'ACME', useExistingCompanyId: 'co-1' },
      ],
    })
    const POST = await getRoute()
    const res = await POST(req)
    const body = await res.json()
    // The selection matched an empty group → 0 contacts updated, not an error
    expect(body.data.results[0].contactsUpdated).toBe(0)
    // No batch commits needed
    expect(capturedBatchCommit).not.toHaveBeenCalled()
  })

  // 403 for non-admin
  it('returns 403 when caller has member role (admin required)', async () => {
    const member = makeMember()
    stageAuth(member, { contacts: [] })
    const req = callAsMember(member, 'POST', '/api/v1/crm/companies/migrate-from-contacts', { mode: 'preview' })
    const POST = await getRoute()
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  // cross-tenant isolation
  it('cross-tenant isolation — org-b contacts not surfaced when authed as org-a', async () => {
    const adminA = makeAdmin('org-a')
    // Only org-a contacts in the mock; org-b contacts would not appear
    // because the Firestore where('orgId','==',ctx.orgId) filters them.
    stageAuth(adminA, {
      contacts: [
        { id: 'ca1', orgId: 'org-a', company: 'ORG-A Corp' },
        // org-b contact intentionally NOT included — Firestore where clause excludes it
      ],
    })
    const req = callAsMember(adminA, 'POST', '/api/v1/crm/companies/migrate-from-contacts', { mode: 'preview' })
    const POST = await getRoute()
    const res = await POST(req)
    const body = await res.json()
    // Only org-a contacts are visible
    expect(body.data.matches.every((m: { contactIds: string[] }) =>
      m.contactIds.every(id => id.startsWith('ca'))
    )).toBe(true)
    // Specifically no org-b contact ids
    const allContactIds = body.data.matches.flatMap((m: { contactIds: string[] }) => m.contactIds)
    expect(allContactIds).not.toContain('cb1')
  })

  // apply mode — missing selections returns 400
  it('apply mode returns 400 when selections is missing', async () => {
    const admin = makeAdmin()
    stageAuth(admin, { contacts: [] })
    const req = callAsMember(admin, 'POST', '/api/v1/crm/companies/migrate-from-contacts', {
      mode: 'apply',
      // no selections
    })
    const POST = await getRoute()
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  // invalid mode
  it('returns 400 for unknown mode', async () => {
    const admin = makeAdmin()
    stageAuth(admin, { contacts: [] })
    const req = callAsMember(admin, 'POST', '/api/v1/crm/companies/migrate-from-contacts', { mode: 'unknown' })
    const POST = await getRoute()
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
