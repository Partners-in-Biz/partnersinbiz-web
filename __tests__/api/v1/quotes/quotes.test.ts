import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn(), runTransaction: jest.fn(), batch: jest.fn() },
}))

jest.mock('@/lib/webhooks/dispatch', () => ({
  dispatchWebhook: jest.fn().mockResolvedValue({ queued: 0 }),
}))

jest.mock('@/lib/companies/store', () => ({
  loadCompany: jest.fn(),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { loadCompany } from '@/lib/companies/store'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../helpers/crm'
import { makePortalAuthCollections } from '../../../helpers/firebase-admin'

const AI_API_KEY = 'test-ai-key'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

const VALID_LINE_ITEMS = [
  { description: 'Consulting', quantity: 2, unitPrice: 500 },
]

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  opts?: {
    existingQuotes?: Array<{ id: string; data: Record<string, unknown> }>
    capturedSet?: jest.Mock
    capturedActivitiesAdd?: jest.Mock
    contactDoc?: Record<string, unknown> | null
  },
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  const authCollections = makePortalAuthCollections(member)

  // Mock runTransaction for atomic quote numbering
  ;(adminDb.runTransaction as jest.Mock).mockImplementation(async (cb: (tx: any) => Promise<unknown>) => {
    const fakeTx = {
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ count: 5 }) }),
      set: jest.fn(),
      update: jest.fn(),
    }
    return cb(fakeTx)
  })

  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users' || name === 'orgMembers') return authCollections[name]
    if (name === 'organizations')
      return {
        doc: (orgId: string) => ({
          get: () =>
            Promise.resolve({
              exists: true,
              data: () => ({
                name: 'Test Client Org',
                settings: { permissions: {}, currency: 'ZAR' },
                billingDetails: {},
              }),
            }),
          collection: (subName: string) => {
            if (subName === 'counters') {
              return {
                doc: () => ({
                  // The route uses refs in a runTransaction — the ref itself isn't called directly
                }),
              }
            }
            return { doc: () => ({}) }
          },
        }),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      }
    if (name === 'quotes') {
      const docs = (opts?.existingQuotes ?? []).map((q) => ({ id: q.id, data: () => q.data }))
      const newDocId = 'new-quote-id'
      return {
        doc: jest.fn().mockReturnValue({
          id: newDocId,
          set: opts?.capturedSet ?? jest.fn().mockResolvedValue(undefined),
        }),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs }),
        add: jest.fn().mockResolvedValue({ id: newDocId }),
      }
    }
    if (name === 'contacts') {
      const contactDoc = opts?.contactDoc ?? null
      return {
        doc: () => ({
          get: () =>
            Promise.resolve(
              contactDoc
                ? { exists: true, data: () => contactDoc }
                : { exists: false },
            ),
        }),
      }
    }
    if (name === 'activities') {
      const addFn = opts?.capturedActivitiesAdd ?? jest.fn().mockResolvedValue({ id: 'act-new' })
      return { add: addFn }
    }
    if (name === 'outbound_webhooks') {
      return {
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: [] }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

// ---------------------------------------------------------------------------
// GET /api/v1/quotes
// ---------------------------------------------------------------------------

describe('GET /api/v1/quotes', () => {
  beforeEach(() => jest.clearAllMocks())

  it('viewer can GET list (own org scoped)', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      existingQuotes: [
        { id: 'q-1', data: { orgId: 'org-1', quoteNumber: 'Q-TES-001', status: 'draft' } },
        { id: 'q-2', data: { orgId: 'org-1', quoteNumber: 'Q-TES-002', status: 'sent' } },
      ],
    })
    const req = callAsMember(viewer, 'GET', '/api/v1/quotes')
    const { GET } = await import('@/app/api/v1/quotes/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.quotes).toHaveLength(2)
  })

  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost/api/v1/quotes')
    const { GET } = await import('@/app/api/v1/quotes/route')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/quotes
// ---------------------------------------------------------------------------

describe('POST /api/v1/quotes', () => {
  beforeEach(() => jest.clearAllMocks())

  it('viewer cannot POST → 403', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer)
    const req = callAsMember(viewer, 'POST', '/api/v1/quotes', {
      lineItems: VALID_LINE_ITEMS,
    })
    const { POST } = await import('@/app/api/v1/quotes/route')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('member POST creates quote with createdByRef + quoteNumber auto-generated', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member', firstName: 'Jane', lastName: 'Doe' })
    stageAuth(member)
    const req = callAsMember(member, 'POST', '/api/v1/quotes', {
      lineItems: VALID_LINE_ITEMS,
      currency: 'ZAR',
    })
    const { POST } = await import('@/app/api/v1/quotes/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    // quoteNumber must match Q-{PREFIX}-{PADDED} format
    expect(body.data.quoteNumber).toMatch(/^Q-[A-Z]{3}-\d{3}$/)
    // createdByRef must be present
    expect(body.data.createdByRef).toBeDefined()
    expect(body.data.createdByRef.uid).toBe('uid-m')
    expect(body.data.createdByRef.kind).toBe('human')
  })

  it('agent (Bearer) POST uses AGENT_PIP_REF', async () => {
    // Stage minimal org + quotes mocks for agent path (no cookie/session needed)
    ;(adminDb.runTransaction as jest.Mock).mockImplementation(async (cb: (tx: any) => Promise<unknown>) => {
      const fakeTx = {
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ count: 2 }) }),
        set: jest.fn(),
      }
      return cb(fakeTx)
    })
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'organizations')
        return {
          doc: () => ({
            get: () =>
              Promise.resolve({
                exists: true,
                data: () => ({
                  name: 'Agent Corp',
                  settings: { permissions: {}, currency: 'ZAR' },
                  billingDetails: {},
                }),
              }),
            collection: (subName: string) => {
              if (subName === 'counters') {
                return { doc: () => ({ /* ref only, tx uses it */ }) }
              }
              return { doc: () => ({}) }
            },
          }),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
        }
      if (name === 'quotes') {
        return {
          doc: jest.fn().mockReturnValue({
            id: 'agent-quote-id',
            set: jest.fn().mockResolvedValue(undefined),
          }),
          add: jest.fn().mockResolvedValue({ id: 'agent-quote-id' }),
        }
      }
      if (name === 'outbound_webhooks') {
        return {
          where: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ docs: [] }),
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsAgent('org-1', 'POST', '/api/v1/quotes', {
      lineItems: VALID_LINE_ITEMS,
    }, AI_API_KEY)
    const { POST } = await import('@/app/api/v1/quotes/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.createdByRef.uid).toBe('agent:pip')
    expect(body.data.createdByRef.kind).toBe('agent')
    // No uid-keyed createdBy for agent calls
    expect(body.data.createdBy).toBeUndefined()
  })

  it('POST validation: lineItems required → 400', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member' })
    stageAuth(member)
    const req = callAsMember(member, 'POST', '/api/v1/quotes', {
      currency: 'ZAR',
      // no lineItems
    })
    const { POST } = await import('@/app/api/v1/quotes/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('POST validation: empty lineItems array → 400', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member' })
    stageAuth(member)
    const req = callAsMember(member, 'POST', '/api/v1/quotes', {
      lineItems: [],
    })
    const { POST } = await import('@/app/api/v1/quotes/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('POST with contactId writes activities entry for contact timeline', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member', firstName: 'Jane', lastName: 'Doe' })
    const capturedActivitiesAdd = jest.fn().mockResolvedValue({ id: 'act-1' })
    stageAuth(member, { capturedActivitiesAdd })

    const req = callAsMember(member, 'POST', '/api/v1/quotes', {
      lineItems: VALID_LINE_ITEMS,
      currency: 'ZAR',
      contactId: 'c-123',
    })
    const { POST } = await import('@/app/api/v1/quotes/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(capturedActivitiesAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        contactId: 'c-123',
        type: 'note',
        summary: expect.stringContaining('Quote created:'),
      }),
    )
    // dealId must NOT be on quote activities
    const call = capturedActivitiesAdd.mock.calls[0][0]
    expect(call.dealId).toBeUndefined()
  })

  it('POST without contactId does NOT call activities.add', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member' })
    const capturedActivitiesAdd = jest.fn().mockResolvedValue({ id: 'act-1' })
    stageAuth(member, { capturedActivitiesAdd })

    const req = callAsMember(member, 'POST', '/api/v1/quotes', {
      lineItems: VALID_LINE_ITEMS,
      currency: 'ZAR',
      // no contactId
    })
    const { POST } = await import('@/app/api/v1/quotes/route')
    await POST(req)
    expect(capturedActivitiesAdd).not.toHaveBeenCalled()
  })

  it('webhook quote.created dispatched with explicit fields only (no body spread)', async () => {
    const member = seedOrgMember('org-2', 'uid-w', { role: 'member', firstName: 'Web', lastName: 'Hook' })
    stageAuth(member)
    ;(dispatchWebhook as jest.Mock).mockClear()

    const req = callAsMember(member, 'POST', '/api/v1/quotes', {
      lineItems: VALID_LINE_ITEMS,
      currency: 'ZAR',
      validUntil: '2026-12-31',
    })
    const { POST } = await import('@/app/api/v1/quotes/route')
    const res = await POST(req)
    expect(res.status).toBe(201)

    expect(dispatchWebhook).toHaveBeenCalledTimes(1)
    const [calledOrgId, calledEvent, calledPayload] = (dispatchWebhook as jest.Mock).mock.calls[0]
    expect(calledOrgId).toBe('org-2')
    expect(calledEvent).toBe('quote.created')

    // Explicit fields: id, quoteNumber, status, total, currency, validUntil, createdByRef
    expect(calledPayload).toHaveProperty('id')
    expect(calledPayload).toHaveProperty('quoteNumber')
    expect(calledPayload).toHaveProperty('status', 'draft')
    expect(calledPayload).toHaveProperty('total')
    expect(calledPayload).toHaveProperty('currency')
    expect(calledPayload).toHaveProperty('validUntil')
    expect(calledPayload).toHaveProperty('createdByRef')

    // Must NOT have body-spread fields like lineItems, notes, fromDetails, etc.
    expect(calledPayload).not.toHaveProperty('lineItems')
    expect(calledPayload).not.toHaveProperty('notes')
    expect(calledPayload).not.toHaveProperty('fromDetails')
    expect(calledPayload).not.toHaveProperty('clientDetails')
    expect(calledPayload).not.toHaveProperty('subtotal')
    expect(calledPayload).not.toHaveProperty('taxRate')
    expect(calledPayload).not.toHaveProperty('orgId')
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/quotes — companyId wiring
// ---------------------------------------------------------------------------

describe('POST /api/v1/quotes — companyId wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(loadCompany as jest.Mock).mockReset()
  })

  it('POST auto-derives companyId from contactId when contact has companyId', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member', firstName: 'Jane', lastName: 'Doe' })
    const capturedSet = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, {
      capturedSet,
      contactDoc: { orgId: 'org-1', companyId: 'co-abc', companyName: 'Acme Corp' },
    })
    ;(loadCompany as jest.Mock).mockResolvedValue(null) // not called on this path

    const req = callAsMember(member, 'POST', '/api/v1/quotes', {
      lineItems: VALID_LINE_ITEMS,
      contactId: 'c-with-company',
    })
    const { POST } = await import('@/app/api/v1/quotes/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.companyId).toBe('co-abc')
    expect(body.data.companyName).toBe('Acme Corp')
  })

  it('POST explicit companyId validates and stamps companyName', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member', firstName: 'Jane', lastName: 'Doe' })
    const capturedSet = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, { capturedSet })
    ;(loadCompany as jest.Mock).mockResolvedValue({
      ref: {},
      data: { id: 'co-xyz', orgId: 'org-1', name: 'XYZ Ltd' },
    })

    const req = callAsMember(member, 'POST', '/api/v1/quotes', {
      lineItems: VALID_LINE_ITEMS,
      companyId: 'co-xyz',
    })
    const { POST } = await import('@/app/api/v1/quotes/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.companyId).toBe('co-xyz')
    expect(body.data.companyName).toBe('XYZ Ltd')
  })

  it('POST invalid companyId → 400', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member' })
    stageAuth(member)
    ;(loadCompany as jest.Mock).mockResolvedValue(null)

    const req = callAsMember(member, 'POST', '/api/v1/quotes', {
      lineItems: VALID_LINE_ITEMS,
      companyId: 'bad-co',
    })
    const { POST } = await import('@/app/api/v1/quotes/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('webhook quote.created payload includes companyId after POST', async () => {
    const member = seedOrgMember('org-1', 'uid-w', { role: 'member', firstName: 'Web', lastName: 'Hook' })
    stageAuth(member)
    ;(loadCompany as jest.Mock).mockResolvedValue({
      ref: {},
      data: { id: 'co-wh', orgId: 'org-1', name: 'Webhook Corp' },
    })
    ;(dispatchWebhook as jest.Mock).mockClear()

    const req = callAsMember(member, 'POST', '/api/v1/quotes', {
      lineItems: VALID_LINE_ITEMS,
      companyId: 'co-wh',
    })
    const { POST } = await import('@/app/api/v1/quotes/route')
    const res = await POST(req)
    expect(res.status).toBe(201)

    const [, , payload] = (dispatchWebhook as jest.Mock).mock.calls[0]
    expect(payload).toHaveProperty('companyId', 'co-wh')
    expect(payload).toHaveProperty('companyName', 'Webhook Corp')
  })
})
