import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

jest.mock('@/lib/companies/store', () => ({
  loadCompany: jest.fn(),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { loadCompany } from '@/lib/companies/store'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../helpers/crm'

const AI_API_KEY = 'test-ai-key-abc'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  perms: Record<string, unknown> = {},
  opts?: {
    capturedActivityAdd?: jest.Mock
    existingActivities?: Array<{ id: string; data: () => Record<string, unknown> }>
    contactData?: Record<string, unknown> | null
  },
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }) }) }
    if (name === 'orgMembers') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => member }) }) }
    if (name === 'organizations') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: perms } }) }) }) }
    if (name === 'contacts') {
      const cd = opts?.contactData !== undefined ? opts.contactData : null
      return {
        doc: () => ({
          get: () =>
            Promise.resolve(
              cd
                ? { exists: true, data: () => cd }
                : { exists: false },
            ),
        }),
      }
    }
    if (name === 'activities') {
      const addFn = opts?.capturedActivityAdd ?? jest.fn().mockResolvedValue({ id: 'auto-act-id' })
      return {
        add: addFn,
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: opts?.existingActivities ?? [], size: (opts?.existingActivities ?? []).length }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

describe('POST /api/v1/crm/activities', () => {
  beforeEach(() => jest.clearAllMocks())

  const validBody = {
    contactId: 'c1',
    type: 'note',
    summary: 'Called the client',
  }

  it('logs activity and returns 201', async () => {
    const member = seedOrgMember('org-test', 'uid-member', { role: 'member' })
    stageAuth(member)
    const req = callAsMember(member, 'POST', '/api/v1/crm/activities', validBody)
    const { POST } = await import('@/app/api/v1/crm/activities/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.id).toBe('auto-act-id')
  })

  it('returns 400 when contactId is missing', async () => {
    const member = seedOrgMember('org-test', 'uid-member', { role: 'member' })
    stageAuth(member)
    const req = callAsMember(member, 'POST', '/api/v1/crm/activities', { ...validBody, contactId: '' })
    const { POST } = await import('@/app/api/v1/crm/activities/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when type is invalid', async () => {
    const member = seedOrgMember('org-test', 'uid-member', { role: 'member' })
    stageAuth(member)
    const req = callAsMember(member, 'POST', '/api/v1/crm/activities', { ...validBody, type: 'unknown' })
    const { POST } = await import('@/app/api/v1/crm/activities/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost/api/v1/crm/activities', { method: 'POST' })
    const { POST } = await import('@/app/api/v1/crm/activities/route')
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('writes createdByRef on POST (member)', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member', firstName: 'Alice', lastName: 'B' })
    const captured = jest.fn().mockResolvedValue({ id: 'act-1' })
    stageAuth(member, {}, { capturedActivityAdd: captured })
    const req = callAsMember(member, 'POST', '/api/v1/crm/activities', {
      contactId: 'c1', type: 'note', summary: 'Test note',
    })
    const { POST } = await import('@/app/api/v1/crm/activities/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const data = captured.mock.calls[0][0]
    expect(data.createdByRef.displayName).toBe('Alice B')
    expect(data.createdByRef.kind).toBe('human')
    expect(data.createdBy).toBe('uid-1')  // legacy field — preserve when human
    expect(data.orgId).toBe('org-1')
  })

  it('agent POST uses AGENT_PIP_REF and omits createdBy uid', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue({ id: 'act-2' })
    stageAuth(member, {}, { capturedActivityAdd: captured })
    const req = callAsAgent('org-1', 'POST', '/api/v1/crm/activities', {
      contactId: 'c1', type: 'note', summary: 'Agent note',
    })
    const { POST } = await import('@/app/api/v1/crm/activities/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const data = captured.mock.calls[0][0]
    expect(data.createdByRef.uid).toBe('agent:pip')
    expect(data.createdByRef.kind).toBe('agent')
    expect(data.createdBy).toBeUndefined()
  })

  it('viewer cannot POST activity (403)', async () => {
    const viewer = seedOrgMember('org-1', 'uid-1', { role: 'viewer' })
    stageAuth(viewer)
    const req = callAsMember(viewer, 'POST', '/api/v1/crm/activities', {
      contactId: 'c1', type: 'note', summary: 'x',
    })
    const { POST } = await import('@/app/api/v1/crm/activities/route')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })
})

describe('POST /api/v1/crm/activities — companyId wiring (A1 W3-K)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(loadCompany as jest.Mock).mockReset()
  })

  it('auto-populates companyId from contact when contact has companyId', async () => {
    const member = seedOrgMember('org-cid', 'uid-cid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue({ id: 'act-cid-1' })
    stageAuth(member, {}, {
      capturedActivityAdd: captured,
      contactData: { orgId: 'org-cid', companyId: 'co-abc', name: 'Alice' },
    })

    const req = callAsMember(member, 'POST', '/api/v1/crm/activities', {
      contactId: 'c-with-company', type: 'call', summary: 'Discussed renewal',
    })
    const { POST } = await import('@/app/api/v1/crm/activities/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const written = captured.mock.calls[0][0]
    expect(written.companyId).toBe('co-abc')
  })

  it('uses explicit body.companyId override when provided and valid', async () => {
    const member = seedOrgMember('org-cid', 'uid-cid-2', { role: 'member' })
    const captured = jest.fn().mockResolvedValue({ id: 'act-cid-2' })
    // No contact data — override should come from explicit body field
    stageAuth(member, {}, { capturedActivityAdd: captured, contactData: null })
    ;(loadCompany as jest.Mock).mockResolvedValue({ data: { id: 'co-explicit', orgId: 'org-cid', name: 'Explicit Corp', tags: [], notes: '', createdAt: null, updatedAt: null } })

    const req = callAsMember(member, 'POST', '/api/v1/crm/activities', {
      contactId: 'c-no-company', type: 'note', summary: 'Manual override', companyId: 'co-explicit',
    })
    const { POST } = await import('@/app/api/v1/crm/activities/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const written = captured.mock.calls[0][0]
    expect(written.companyId).toBe('co-explicit')
  })

  it('returns 400 when explicit body.companyId is invalid or cross-tenant', async () => {
    const member = seedOrgMember('org-cid', 'uid-cid-3', { role: 'member' })
    stageAuth(member, {}, { contactData: null })
    ;(loadCompany as jest.Mock).mockResolvedValue(null)  // cross-tenant / not found

    const req = callAsMember(member, 'POST', '/api/v1/crm/activities', {
      contactId: 'c1', type: 'note', summary: 'Bad company', companyId: 'co-wrong-org',
    })
    const { POST } = await import('@/app/api/v1/crm/activities/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('succeeds without companyId when contact has none (no 500)', async () => {
    const member = seedOrgMember('org-cid', 'uid-cid-4', { role: 'member' })
    const captured = jest.fn().mockResolvedValue({ id: 'act-cid-4' })
    stageAuth(member, {}, {
      capturedActivityAdd: captured,
      contactData: { orgId: 'org-cid', name: 'Bob' },  // no companyId on contact
    })

    const req = callAsMember(member, 'POST', '/api/v1/crm/activities', {
      contactId: 'c-no-company', type: 'email_sent', summary: 'Sent intro email',
    })
    const { POST } = await import('@/app/api/v1/crm/activities/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const written = captured.mock.calls[0][0]
    expect(written.companyId).toBeUndefined()
  })
})
