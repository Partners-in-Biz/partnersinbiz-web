import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../helpers/crm'

const AI_API_KEY = 'test-ai-key-abc'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// Suppress logActivity and dispatchWebhook noise in tests
jest.mock('@/lib/activity/log', () => ({ logActivity: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/webhooks/dispatch', () => ({ dispatchWebhook: jest.fn().mockResolvedValue(undefined) }))

// Mock loadCompany for companyId tests
jest.mock('@/lib/companies/store', () => ({
  loadCompany: jest.fn(),
}))
import { loadCompany } from '@/lib/companies/store'

// Mock custom fields store for validation tests
jest.mock('@/lib/customFields/store', () => ({
  getDefinitionsForResource: jest.fn().mockResolvedValue([]),
}))
import { getDefinitionsForResource } from '@/lib/customFields/store'

type TestMember = { uid: string; orgId: string; role: string; firstName?: string; lastName?: string }

function orgMembersCollection(members: TestMember[]) {
  const docs = members.map((member) => ({ id: `${member.orgId}_${member.uid}`, data: () => member }))
  const collection: {
    doc: jest.Mock
    get: jest.Mock
    where?: jest.Mock
  } = {
    doc: jest.fn((id: string) => {
      const doc = docs.find((candidate) => candidate.id === id)
      return {
        get: () => Promise.resolve(doc ? { exists: true, data: doc.data } : { exists: false }),
      }
    }),
    get: jest.fn(() => Promise.resolve({ docs })),
  }
  collection.where = jest.fn((_field: string, _op: string, value: string) => ({
    get: () => Promise.resolve({
      docs: docs.filter((doc) => doc.data().uid === value),
    }),
  }))
  return collection
}

function stageAuth(
  member: TestMember,
  perms: Record<string, unknown> = {},
  contactsBehavior?: {
    list?: () => Promise<{ docs: Array<{ id: string; data: () => unknown }> }>
    capturedDocSet?: jest.Mock
  },
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users') {
      return {
        doc: () => ({
          get: () =>
            Promise.resolve({
              exists: true,
              data: () => ({ activeOrgId: member.orgId }),
            }),
        }),
      }
    }
    if (name === 'orgMembers') {
      return orgMembersCollection([member])
    }
    if (name === 'organizations') {
      return {
        doc: () => ({
          get: () =>
            Promise.resolve({
              exists: true,
              data: () => ({ settings: { permissions: perms } }),
            }),
        }),
      }
    }
    if (name === 'contacts') {
      const setFn = contactsBehavior?.capturedDocSet ?? jest.fn().mockResolvedValue(undefined)
      return {
        doc: jest.fn().mockReturnValue({
          id: 'auto-id-123',
          set: setFn,
          get: jest.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
        }),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        get: contactsBehavior?.list ?? (() => Promise.resolve({ docs: [] })),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

describe('GET /api/v1/crm/contacts', () => {
  it('returns list of contacts', async () => {
    const member = seedOrgMember('org-test', 'uid-viewer', { role: 'viewer' })
    stageAuth(member, {}, {
      list: () =>
        Promise.resolve({
          docs: [{ id: 'c1', data: () => ({ name: 'John', email: 'john@test.com', deleted: false }) }],
        }),
    })
    const req = callAsMember(member, 'GET', '/api/v1/crm/contacts')
    const { GET } = await import('@/app/api/v1/crm/contacts/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('returns 401 without auth', async () => {
    // No cookie, no Bearer — middleware returns 401
    const req = new NextRequest('http://localhost/api/v1/crm/contacts')
    const { GET } = await import('@/app/api/v1/crm/contacts/route')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns contacts via Bearer (agent)', async () => {
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'organizations') {
        return {
          doc: () => ({
            get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }),
          }),
        }
      }
      if (name === 'contacts') {
        return {
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          offset: jest.fn().mockReturnThis(),
          get: () => Promise.resolve({ docs: [] }),
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    const req = callAsAgent('org-agent', 'GET', '/api/v1/crm/contacts', undefined, AI_API_KEY)
    const { GET } = await import('@/app/api/v1/crm/contacts/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
  })
})

describe('POST /api/v1/crm/contacts', () => {
  const validContact = {
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '',
    company: 'Acme',
    website: '',
    source: 'manual',
    type: 'lead',
    stage: 'new',
    tags: [],
    notes: '',
    assignedTo: '',
  }

  it('creates a contact and returns 201', async () => {
    const member = seedOrgMember('org-test', 'uid-member', { role: 'member' })
    stageAuth(member)
    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts', validContact)
    const { POST } = await import('@/app/api/v1/crm/contacts/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.id).toBe('auto-id-123')
  })

  it('rejects a duplicate contact email inside the same workspace with 409 metadata', async () => {
    const member = seedOrgMember('org-duplicate-contact', 'uid-duplicate-contact', { role: 'member' })
    const emailQuery = jest.fn().mockResolvedValue({
      docs: [{ id: 'existing-contact-id', data: () => ({ orgId: 'org-duplicate-contact', email: 'jane@example.com', deleted: false }) }],
    })
    const where = jest.fn().mockReturnThis()
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'users') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }) }) }
      if (name === 'orgMembers') return orgMembersCollection([member])
      if (name === 'organizations') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
      if (name === 'contacts') {
        return {
          doc: jest.fn().mockReturnValue({ id: 'auto-id-should-not-write', set: jest.fn() }),
          where,
          limit: jest.fn().mockReturnThis(),
          get: emailQuery,
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts', { ...validContact, email: ' Jane@Example.com ' })
    const { POST } = await import('@/app/api/v1/crm/contacts/route')
    const res = await POST(req)

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/already exists in this workspace/i)
    expect(body.duplicate).toMatchObject({ id: 'existing-contact-id', reason: 'email' })
    expect(where).toHaveBeenCalledWith('orgId', '==', 'org-duplicate-contact')
    expect(where).toHaveBeenCalledWith('email', '==', 'jane@example.com')
  })

  it('rejects duplicate linkedUserId inside the same workspace', async () => {
    const member = seedOrgMember('org-linked-user-contact', 'uid-linked-user-contact', { role: 'member' })
    let queryCount = 0
    const where = jest.fn().mockReturnThis()
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'users') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }) }) }
      if (name === 'orgMembers') return orgMembersCollection([member])
      if (name === 'organizations') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
      if (name === 'contacts') {
        return {
          doc: jest.fn().mockReturnValue({ id: 'auto-id-should-not-write', set: jest.fn() }),
          where,
          limit: jest.fn().mockReturnThis(),
          get: jest.fn(() => {
            queryCount += 1
            return Promise.resolve(queryCount === 1
              ? { docs: [] }
              : { docs: [{ id: 'existing-linked-contact', data: () => ({ orgId: member.orgId, linkedUserId: 'linked-user-1', deleted: false }) }] })
          }),
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts', { ...validContact, linkedUserId: 'linked-user-1' })
    const { POST } = await import('@/app/api/v1/crm/contacts/route')
    const res = await POST(req)

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.duplicate).toMatchObject({ id: 'existing-linked-contact', reason: 'linkedUserId' })
    expect(where).toHaveBeenCalledWith('orgId', '==', 'org-linked-user-contact')
    expect(where).toHaveBeenCalledWith('linkedUserId', '==', 'linked-user-1')
  })

  it('defaults a new contact owner to the creating member when assignedTo is blank', async () => {
    const member = seedOrgMember('org-owner-default', 'uid-owner-default', { role: 'member', firstName: 'Owner', lastName: 'Default' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, {}, { capturedDocSet: captured })

    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts', {
      ...validContact,
      assignedTo: '',
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/route')
    const res = await POST(req)

    expect(res.status).toBe(201)
    const writtenData = captured.mock.calls[0][0]
    expect(writtenData.assignedTo).toBe('uid-owner-default')
    expect(writtenData.assignedToRef.uid).toBe('uid-owner-default')
    expect(writtenData.assignedToRef.displayName).toBe('Owner Default')
    expect(writtenData.allowedUserIds).toContain('uid-owner-default')
  })

  it('returns 400 when name is missing', async () => {
    const member = seedOrgMember('org-test', 'uid-member', { role: 'member' })
    stageAuth(member)
    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts', { ...validContact, name: '' })
    const { POST } = await import('@/app/api/v1/crm/contacts/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when email is invalid', async () => {
    const member = seedOrgMember('org-test', 'uid-member', { role: 'member' })
    stageAuth(member)
    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts', { ...validContact, email: 'not-email' })
    const { POST } = await import('@/app/api/v1/crm/contacts/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when stage is invalid', async () => {
    const member = seedOrgMember('org-test', 'uid-member', { role: 'member' })
    stageAuth(member)
    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts', { ...validContact, stage: 'invalid' })
    const { POST } = await import('@/app/api/v1/crm/contacts/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 403 when viewer tries to POST', async () => {
    const member = seedOrgMember('org-test', 'uid-viewer', { role: 'viewer' })
    stageAuth(member)
    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts', validContact)
    const { POST } = await import('@/app/api/v1/crm/contacts/route')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('writes assignedToRef when POST body has assignedTo (resolves via orgMembers)', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member', firstName: 'Alice', lastName: 'B' })
    const captured = jest.fn().mockResolvedValue(undefined)

    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'users') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: 'org-1' }) }) }) }
      if (name === 'orgMembers') return orgMembersCollection([
        member,
        { uid: 'uid-2', orgId: 'org-1', role: 'member', firstName: 'Bob', lastName: 'C' },
      ])
      if (name === 'organizations') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
      if (name === 'contacts') return {
        doc: jest.fn().mockReturnValue({ id: 'auto-id-x', set: captured, get: jest.fn().mockResolvedValue({ exists: true, data: () => ({}) }) }),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: () => Promise.resolve({ docs: [] }),
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts', {
      name: 'X', email: 'x@y.com', source: 'manual', assignedTo: 'uid-2',
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const writtenData = captured.mock.calls[0][0]
    expect(writtenData.assignedTo).toBe('uid-2')
    expect(writtenData.assignedToRef.displayName).toBe('Bob C')
    expect(writtenData.assignedToRef.kind).toBe('human')
  })

  it('writes createdByRef snapshot on POST (member)', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member', firstName: 'Alice', lastName: 'B' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, {}, { capturedDocSet: captured })
    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts', {
      name: 'Test Contact', email: 'test@example.com', source: 'manual',
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const writtenData = captured.mock.calls[0][0]
    expect(writtenData.createdByRef.displayName).toBe('Alice B')
    expect(writtenData.createdByRef.kind).toBe('human')
    expect(writtenData.orgId).toBe('org-1')
  })

  it('captures agreement role metadata on POST', async () => {
    const member = seedOrgMember('org-agreement', 'uid-agreement', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, {}, { capturedDocSet: captured })
    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts', {
      name: 'Jane Signatory',
      email: 'jane@example.com',
      source: 'manual',
      jobTitle: 'Director',
      department: 'Finance',
      agreementRoles: ['primary_contact', 'authorized_signatory', 'accounts_contact'],
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const writtenData = captured.mock.calls[0][0]
    expect(writtenData.jobTitle).toBe('Director')
    expect(writtenData.department).toBe('Finance')
    expect(writtenData.agreementRoles).toEqual(['primary_contact', 'authorized_signatory', 'accounts_contact'])
  })

  it('rejects invalid agreement roles on POST', async () => {
    const member = seedOrgMember('org-agreement', 'uid-agreement-invalid', { role: 'member' })
    stageAuth(member)
    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts', {
      name: 'Invalid Role',
      email: 'invalid@example.com',
      source: 'manual',
      agreementRoles: ['primary_contact', 'owner_id_number'],
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/agreementRoles/i)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/crm/contacts — companyId wiring tests
// ---------------------------------------------------------------------------

describe('POST contacts with companyId', () => {
  beforeEach(() => {
    ;(loadCompany as jest.Mock).mockReset()
  })

  it('writes companyId + companyName cache from valid company lookup', async () => {
    const member = seedOrgMember('org-co', 'uid-co-member', { role: 'member' })
    const capturedSet = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, {}, { capturedDocSet: capturedSet })
    ;(loadCompany as jest.Mock).mockResolvedValue({ data: { name: 'ACME Corp' } })

    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts', {
      name: 'Jane Linked',
      email: 'jane-linked@acme.com',
      source: 'manual',
      companyId: 'co-acme-1',
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const written = capturedSet.mock.calls[0][0]
    expect(written.companyId).toBe('co-acme-1')
    expect(written.companyName).toBe('ACME Corp')
    expect(loadCompany).toHaveBeenCalledWith('co-acme-1', 'org-co')
  })

  it('returns 400 for cross-tenant or non-existent companyId', async () => {
    const member = seedOrgMember('org-co', 'uid-co-member2', { role: 'member' })
    stageAuth(member)
    ;(loadCompany as jest.Mock).mockResolvedValue(null) // cross-tenant → null

    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts', {
      name: 'Bad Company Link',
      email: 'bad@example.com',
      source: 'manual',
      companyId: 'co-other-org',
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/companyId/i)
  })

  it('hybrid mode: only company string set, no companyId written when omitted', async () => {
    const member = seedOrgMember('org-co', 'uid-co-member3', { role: 'member' })
    const capturedSet = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, {}, { capturedDocSet: capturedSet })
    // loadCompany should NOT be called when companyId is absent

    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts', {
      name: 'Hybrid Contact',
      email: 'hybrid@example.com',
      source: 'manual',
      company: 'ACME String Only', // existing legacy field
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const written = capturedSet.mock.calls[0][0]
    expect(written.company).toBe('ACME String Only')
    expect(written.companyId).toBeUndefined() // not set in sanitized output
    expect(loadCompany).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/crm/contacts — custom field validation', () => {
  const validContact = {
    name: 'CF Test',
    email: 'cf@example.com',
    source: 'manual' as const,
  }

  it('accepts write when customFields match definitions', async () => {
    const member = seedOrgMember('org-cf', 'uid-cf-ok', { role: 'member' })
    stageAuth(member)
    ;(getDefinitionsForResource as jest.Mock).mockResolvedValueOnce([
      { id: 'd1', key: 'tier', type: 'dropdown', required: false, options: [{ value: 'gold', label: 'Gold' }], orgId: 'org-cf', resource: 'contact', label: 'Tier', order: 0, createdAt: null, updatedAt: null },
    ])
    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts', {
      ...validContact,
      customFields: { tier: 'gold' },
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
  })

  it('rejects write with 400 when customFields violate definitions', async () => {
    const member = seedOrgMember('org-cf', 'uid-cf-bad', { role: 'member' })
    stageAuth(member)
    ;(getDefinitionsForResource as jest.Mock).mockResolvedValueOnce([
      { id: 'd1', key: 'tier', type: 'dropdown', required: true, options: [{ value: 'gold', label: 'Gold' }], orgId: 'org-cf', resource: 'contact', label: 'Tier', order: 0, createdAt: null, updatedAt: null },
    ])
    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts', {
      ...validContact,
      customFields: { tier: 'unknown' },
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/custom field/i)
  })
})
