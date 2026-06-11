/**
 * Consolidated cross-tenant isolation suite for quotes routes.
 *
 * Mirrors the same where-respecting mock pattern from
 * forms-tenant-isolation.test.ts (PR 6 / commit a443f43).
 *
 * Distinct uids avoid substring collisions (PR 3 lesson):
 *   uid-amem  → member in org-a
 *   uid-aadm  → admin  in org-a
 *   uid-bmem  → member in org-b
 *
 * Fixtures:
 *   quoteA  (org-a, id=q-a, status=draft, quoteNumber=Q-TST-001, total=1000)
 *   quoteB  (org-b, id=q-b)
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn(), runTransaction: jest.fn() },
}))

jest.mock('@/lib/webhooks/dispatch', () => ({
  dispatchWebhook: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/invoices/invoice-number', () => ({
  generateInvoiceNumber: jest.fn().mockResolvedValue('INV-TST-001'),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__serverTimestamp__' },
  Timestamp: { fromDate: (d: Date) => d.toISOString() },
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../helpers/crm'
import { makePortalAuthCollections, makePortalAuthCollectionsForMembers } from '../../../helpers/firebase-admin'

const AI_API_KEY = 'test-ai-key'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ── Actors ───────────────────────────────────────────────────────────────────

const memberA = seedOrgMember('org-a', 'uid-amem', { role: 'member', firstName: 'A', lastName: 'M' })
const adminA  = seedOrgMember('org-a', 'uid-aadm', { role: 'admin',  firstName: 'A', lastName: 'A' })
const memberB = seedOrgMember('org-b', 'uid-bmem', { role: 'member', firstName: 'B', lastName: 'M' })
const viewerA = seedOrgMember('org-a', 'uid-aviw', { role: 'viewer', firstName: 'A', lastName: 'V' })

// ── Fixtures ──────────────────────────────────────────────────────────────────

const quoteA = {
  id:           'q-a',
  orgId:        'org-a',
  quoteNumber:  'Q-TST-001',
  status:       'draft',
  total:        1000,
  currency:     'ZAR',
  subtotal:     1000,
  taxRate:      0,
  taxAmount:    0,
  notes:        '',
  lineItems:    [{ description: 'Consulting', quantity: 1, unitPrice: 1000, amount: 1000 }],
  fromDetails:  { companyName: 'Partners in Biz' },
  clientDetails: { name: 'Org A Client' },
  convertedInvoiceId: null,
  sentAt:       null,
  acceptedAt:   null,
  deleted:      false,
}

const quoteB = {
  id:           'q-b',
  orgId:        'org-b',
  quoteNumber:  'Q-TST-002',
  status:       'draft',
  total:        500,
  currency:     'ZAR',
  subtotal:     500,
  taxRate:      0,
  taxAmount:    0,
  notes:        '',
  lineItems:    [{ description: 'Design', quantity: 1, unitPrice: 500, amount: 500 }],
  fromDetails:  { companyName: 'Partners in Biz' },
  clientDetails: { name: 'Org B Client' },
  convertedInvoiceId: null,
  sentAt:       null,
  acceptedAt:   null,
  deleted:      false,
}

// ── Route context helper ──────────────────────────────────────────────────────

const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) })

// ── Core isolation fixture setup ──────────────────────────────────────────────

/**
 * where-respecting mock pattern (PR 3 lesson):
 * Captures the orgId filter set by .where('orgId', '==', value) and returns
 * only matching docs from get(). A route that forgets to call .where('orgId')
 * would return docs for both orgs, causing isolation tests to fail.
 */
function setupIsolationFixtures() {
  const authCollections = makePortalAuthCollectionsForMembers([memberA, adminA, memberB, viewerA])
  const captured = {
    quoteAdds:    [] as Array<Record<string, unknown>>,
    quoteSets:    [] as Array<Record<string, unknown>>,
    quoteUpdates: [] as Array<Record<string, unknown>>,
    invoiceAdds:  [] as Array<Record<string, unknown>>,
  }

  ;(adminAuth.verifySessionCookie as jest.Mock).mockImplementation((cookie: string) => {
    if (cookie.endsWith(memberA.uid)) return Promise.resolve({ uid: memberA.uid })
    if (cookie.endsWith(adminA.uid))  return Promise.resolve({ uid: adminA.uid })
    if (cookie.endsWith(memberB.uid)) return Promise.resolve({ uid: memberB.uid })
    if (cookie.endsWith(viewerA.uid)) return Promise.resolve({ uid: viewerA.uid })
    return Promise.reject(new Error('invalid'))
  })

  ;(adminDb.runTransaction as jest.Mock).mockImplementation(async (cb: any) => {
    const fakeTx = {
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ count: 0 }) }),
      set: jest.fn(),
      update: jest.fn(),
    }
    return cb(fakeTx)
  })

  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {

    if (name === 'users' || name === 'orgMembers') return authCollections[name]

    // ── organizations ──────────────────────────────────────────────────────
    if (name === 'organizations') {
      return {
        doc: (orgId?: string) => ({
          get: () => Promise.resolve({
            exists: true,
            data: () => ({
              name: orgId === 'org-b' ? 'Org B Corp' : 'Org A Corp',
              settings: { permissions: {}, currency: 'ZAR' },
              billingDetails: {},
            }),
          }),
          collection: (subName: string) => {
            if (subName === 'counters') {
              return { doc: () => ({ /* ref only — tx uses it */ }) }
            }
            return { doc: () => ({}) }
          },
        }),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      }
    }

    // ── quotes ─────────────────────────────────────────────────────────────
    if (name === 'quotes') {
      let whereOrgFilter: string | undefined
      const query: any = {
        where: jest.fn((field: string, op: string, value: any) => {
          if (field === 'orgId' && op === '==') whereOrgFilter = value
          return query
        }),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        get: () => Promise.resolve({
          docs: [
            { id: 'q-a', data: () => quoteA },
            { id: 'q-b', data: () => quoteB },
          ].filter(d => {
            const data = d.data() as any
            if (whereOrgFilter !== undefined && data.orgId !== whereOrgFilter) return false
            return true
          }),
        }),
      }
      return {
        add: jest.fn((data: Record<string, unknown>) => {
          captured.quoteAdds.push(data)
          return Promise.resolve({ id: 'auto-quote' })
        }),
        doc: jest.fn().mockImplementation((id?: string) => {
          const docData = id === 'q-a' ? quoteA : id === 'q-b' ? quoteB : undefined
          return {
            id: id ?? 'auto-quote',
            get: () => Promise.resolve({
              exists: !!docData,
              id: id ?? 'auto-quote',
              data: () => docData,
            }),
            set: jest.fn((data: Record<string, unknown>) => {
              captured.quoteSets.push({ ...data, _docId: id ?? 'auto-quote' })
              return Promise.resolve()
            }),
            update: jest.fn((data: Record<string, unknown>) => {
              captured.quoteUpdates.push({ ...data, _docId: id })
              return Promise.resolve()
            }),
            delete: jest.fn().mockResolvedValue(undefined),
          }
        }),
        ...query,
      }
    }

    // ── invoices ───────────────────────────────────────────────────────────
    if (name === 'invoices') {
      return {
        add: jest.fn((data: Record<string, unknown>) => {
          captured.invoiceAdds.push(data)
          return Promise.resolve({ id: 'auto-invoice' })
        }),
      }
    }

    // ── outbound_webhooks ──────────────────────────────────────────────────
    if (name === 'outbound_webhooks') {
      return {
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: [] }),
      }
    }

    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })

  return captured
}

beforeEach(() => { jest.clearAllMocks() })

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('cross-tenant isolation: quotes routes', () => {

  // ── POST /api/v1/quotes ───────────────────────────────────────────────────

  it('member POST is scoped to org-a with createdByRef.displayName = "A M"', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsMember(memberA, 'POST', '/api/v1/quotes', {
      lineItems: [{ description: 'Work', quantity: 1, unitPrice: 500 }],
    })
    const { POST } = await import('@/app/api/v1/quotes/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const body = await res.json()
    expect(body.data.orgId).toBe('org-a')
    expect(body.data.createdByRef.displayName).toBe('A M')
  })

  it('agent (Bearer) POST uses AGENT_PIP_REF (uid=agent:pip, kind=agent)', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsAgent('org-a', 'POST', '/api/v1/quotes', {
      lineItems: [{ description: 'Agent Work', quantity: 1, unitPrice: 750 }],
    }, AI_API_KEY)
    const { POST } = await import('@/app/api/v1/quotes/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const body = await res.json()
    expect(body.data.createdByRef.uid).toBe('agent:pip')
    expect(body.data.createdByRef.kind).toBe('agent')
    expect(body.data.orgId).toBe('org-a')
    expect(body.data.createdBy).toBeUndefined()
  })

  it('viewer cannot POST → 403', async () => {
    setupIsolationFixtures()
    const req = callAsMember(viewerA, 'POST', '/api/v1/quotes', {
      lineItems: [{ description: 'Try', quantity: 1, unitPrice: 100 }],
    })
    const { POST } = await import('@/app/api/v1/quotes/route')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  // ── GET /api/v1/quotes ────────────────────────────────────────────────────

  it('member GET list returns ONLY org-a quotes (catches missing where("orgId"))', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberA, 'GET', '/api/v1/quotes')
    const { GET } = await import('@/app/api/v1/quotes/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const arr = (body.data?.quotes ?? []) as Array<{ id: string }>
    expect(arr.map((q) => q.id)).not.toContain('q-b')
    expect(arr.map((q) => q.id)).toContain('q-a')
  })

  // ── PATCH /api/v1/quotes/:id ──────────────────────────────────────────────

  it('member cannot PATCH cross-org quote → 404', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberA, 'PATCH', '/api/v1/quotes/q-b', { status: 'sent' })
    const { PATCH } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await PATCH(req, routeCtx('q-b'))
    expect(res.status).toBe(404)
  })

  // ── DELETE /api/v1/quotes/:id ─────────────────────────────────────────────

  it('admin cannot DELETE cross-org quote → 404', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'DELETE', '/api/v1/quotes/q-b')
    const { DELETE } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await DELETE(req, routeCtx('q-b'))
    expect(res.status).toBe(404)
  })

  it('member cannot DELETE → 403 (admin required)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberA, 'DELETE', '/api/v1/quotes/q-a')
    const { DELETE } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await DELETE(req, routeCtx('q-a'))
    expect(res.status).toBe(403)
  })

  it('agent (Bearer) DELETE bypasses admin gate → 200', async () => {
    setupIsolationFixtures()
    const req = callAsAgent('org-a', 'DELETE', '/api/v1/quotes/q-a', undefined, AI_API_KEY)
    const { DELETE } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await DELETE(req, routeCtx('q-a'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  // ── PATCH status accepted — webhook with explicit fields ──────────────────

  it('PATCH status to accepted fires quote.accepted webhook with explicit fields (no body leak)', async () => {
    // Use setupIsolationFixtures but with a 'sent' quote so the transition to 'accepted' is valid.
    // We rebuild the mock from scratch after clearAllMocks so the quotes collection returns sentQuote.
    jest.clearAllMocks()

    ;(adminAuth.verifySessionCookie as jest.Mock).mockImplementation((cookie: string) => {
      if (cookie.endsWith(memberA.uid)) return Promise.resolve({ uid: memberA.uid })
      return Promise.reject(new Error('invalid'))
    })

    ;(adminDb.runTransaction as jest.Mock).mockImplementation(async (cb: any) => {
      const fakeTx = { get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ count: 0 }) }), set: jest.fn(), update: jest.fn() }
      return cb(fakeTx)
    })

    const sentQuote = { ...quoteA, status: 'sent' }
    const authCollections = makePortalAuthCollections(memberA)

    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'users' || name === 'orgMembers') return authCollections[name]
      if (name === 'organizations')
        return {
          doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ name: 'Org A Corp', settings: { permissions: {}, currency: 'ZAR' }, billingDetails: {} }) }) }),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
        }
      if (name === 'quotes')
        return {
          doc: jest.fn().mockImplementation((id?: string) => ({
            id: id ?? 'q-a',
            get: () => Promise.resolve({ exists: true, id: 'q-a', data: () => sentQuote }),
            update: jest.fn().mockResolvedValue(undefined),
            delete: jest.fn().mockResolvedValue(undefined),
          })),
        }
      if (name === 'outbound_webhooks')
        return { where: jest.fn().mockReturnThis(), get: jest.fn().mockResolvedValue({ docs: [] }) }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    ;(dispatchWebhook as jest.Mock).mockClear()

    const req = callAsMember(memberA, 'PATCH', '/api/v1/quotes/q-a', { status: 'accepted' })
    const { PATCH } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await PATCH(req, routeCtx('q-a'))
    expect(res.status).toBe(200)

    expect(dispatchWebhook).toHaveBeenCalledTimes(1)
    const [calledOrgId, calledEvent, calledPayload] = (dispatchWebhook as jest.Mock).mock.calls[0]
    expect(calledOrgId).toBe('org-a')
    expect(calledEvent).toBe('quote.accepted')
    expect(calledPayload).toHaveProperty('id', 'q-a')
    expect(calledPayload).toHaveProperty('quoteNumber', 'Q-TST-001')
    expect(calledPayload).toHaveProperty('total', 1000)
    expect(calledPayload).toHaveProperty('currency', 'ZAR')
    expect(calledPayload).toHaveProperty('updatedByRef')
    // No body spread — explicit fields only
    expect(calledPayload).not.toHaveProperty('lineItems')
    expect(calledPayload).not.toHaveProperty('orgId')
    expect(calledPayload).not.toHaveProperty('notes')
    expect(calledPayload).not.toHaveProperty('fromDetails')
    expect(calledPayload).not.toHaveProperty('clientDetails')
  })

  // ── Convert-to-invoice ────────────────────────────────────────────────────

  it('convert-to-invoice flips status to converted and stores convertedInvoiceId', async () => {
    jest.clearAllMocks()

    const { generateInvoiceNumber } = await import('@/lib/invoices/invoice-number')
    ;(generateInvoiceNumber as jest.Mock).mockResolvedValue('INV-TST-001')

    ;(adminAuth.verifySessionCookie as jest.Mock).mockImplementation((cookie: string) => {
      if (cookie.endsWith(memberA.uid)) return Promise.resolve({ uid: memberA.uid })
      return Promise.reject(new Error('invalid'))
    })

    ;(adminDb.runTransaction as jest.Mock).mockImplementation(async (cb: any) => {
      const fakeTx = { get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ count: 0 }) }), set: jest.fn(), update: jest.fn() }
      return cb(fakeTx)
    })

    const acceptedQuote = { ...quoteA, status: 'accepted', convertedInvoiceId: null }
    let capturedQuoteUpdate: Record<string, unknown> = {}
    let capturedInvoiceAdd: Record<string, unknown> = {}
    const authCollections = makePortalAuthCollections(memberA)

    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'users' || name === 'orgMembers') return authCollections[name]
      if (name === 'organizations')
        return {
          doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ name: 'Org A Corp', settings: { permissions: {}, currency: 'ZAR' }, billingDetails: {} }) }) }),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
        }
      if (name === 'quotes')
        return {
          doc: jest.fn().mockImplementation((id?: string) => ({
            id: id ?? 'q-a',
            get: () => Promise.resolve({ exists: true, id: 'q-a', data: () => acceptedQuote }),
            update: jest.fn().mockImplementation((data: Record<string, unknown>) => {
              capturedQuoteUpdate = data
              return Promise.resolve()
            }),
            delete: jest.fn().mockResolvedValue(undefined),
          })),
        }
      if (name === 'invoices')
        return {
          add: jest.fn().mockImplementation((data: Record<string, unknown>) => {
            capturedInvoiceAdd = data
            return Promise.resolve({ id: 'inv-new-001' })
          }),
        }
      if (name === 'outbound_webhooks')
        return { where: jest.fn().mockReturnThis(), get: jest.fn().mockResolvedValue({ docs: [] }) }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsMember(memberA, 'PATCH', '/api/v1/quotes/q-a', { action: 'convert-to-invoice' })
    const { PATCH } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await PATCH(req, routeCtx('q-a'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.invoiceId).toBe('inv-new-001')

    // Quote should be marked as converted with convertedInvoiceId set
    expect(capturedQuoteUpdate).toHaveProperty('status', 'converted')
    expect(capturedQuoteUpdate).toHaveProperty('convertedInvoiceId', 'inv-new-001')

    // Invoice was created with org-scoped data
    expect(capturedInvoiceAdd).toHaveProperty('orgId', 'org-a')
    expect(capturedInvoiceAdd).toHaveProperty('invoiceNumber', 'INV-TST-001')
    expect(capturedInvoiceAdd).toHaveProperty('status', 'draft')
  })
})
