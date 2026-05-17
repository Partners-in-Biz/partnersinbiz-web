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

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
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
      return {
        doc: () => ({
          get: () =>
            Promise.resolve({
              exists: true,
              data: () => member,
            }),
        }),
      }
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
      if (name === 'orgMembers') return {
        doc: jest.fn().mockImplementation((id: string) => ({
          get: () => Promise.resolve(
            id === 'org-1_uid-1' ? { exists: true, data: () => member }
              : id === 'org-1_uid-2' ? { exists: true, data: () => ({ uid: 'uid-2', firstName: 'Bob', lastName: 'C' }) }
              : { exists: false },
          ),
        })),
      }
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
