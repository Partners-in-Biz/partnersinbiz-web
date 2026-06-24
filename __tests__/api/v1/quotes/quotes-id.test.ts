import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn(), runTransaction: jest.fn(), batch: jest.fn() },
}))

jest.mock('@/lib/webhooks/dispatch', () => ({
  dispatchWebhook: jest.fn().mockResolvedValue({ queued: 0 }),
}))

jest.mock('@/lib/invoices/invoice-number', () => ({
  generateInvoiceNumber: jest.fn().mockResolvedValue('TES-001'),
}))

jest.mock('@/lib/companies/store', () => ({
  loadCompany: jest.fn(),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { generateInvoiceNumber } from '@/lib/invoices/invoice-number'
import { loadCompany } from '@/lib/companies/store'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../helpers/crm'
import { makePortalAuthCollections } from '../../../helpers/firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'

const AI_API_KEY = 'test-ai-key'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ---------------------------------------------------------------------------
// Stage helpers
// ---------------------------------------------------------------------------

interface QuoteDoc {
  id: string
  data: Record<string, unknown>
}

interface InvoiceCapture {
  capturedAdd?: jest.Mock
}

interface ActivitiesCapture {
  capturedAdd?: jest.Mock
}

interface ContactDoc {
  orgId?: string
  companyId?: string
  companyName?: string
  [key: string]: unknown
}

function makeQuoteDoc(id: string, partial: Record<string, unknown>): QuoteDoc {
  return {
    id,
    data: {
      orgId: 'org-1',
      quoteNumber: 'Q-TES-001',
      status: 'draft',
      total: 1000,
      currency: 'ZAR',
      notes: '',
      lineItems: [],
      subtotal: 1000,
      taxRate: 0,
      taxAmount: 0,
      fromDetails: {},
      clientDetails: {},
      ...partial,
    },
  }
}

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  opts?: {
    quotes?: QuoteDoc[]
    invoiceCapture?: InvoiceCapture
    activitiesCapture?: ActivitiesCapture
    contactDoc?: ContactDoc | null
  },
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  const authCollections = makePortalAuthCollections(member)

  ;(adminDb.runTransaction as jest.Mock).mockImplementation(
    async (cb: (tx: any) => Promise<unknown>) => {
      const fakeTx = {
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ count: 5 }) }),
        set: jest.fn(),
        update: jest.fn(),
      }
      return cb(fakeTx)
    },
  )

  const quotes = opts?.quotes ?? []
  const capturedAdd = opts?.invoiceCapture?.capturedAdd ?? jest.fn().mockResolvedValue({ id: 'inv-new' })

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
          collection: () => ({ doc: () => ({}) }),
        }),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      }

    if (name === 'quotes') {
      const docsById = new Map(quotes.map((q) => [q.id, q]))
      return {
        doc: jest.fn((id?: string) => {
          if (id && docsById.has(id)) {
            const q = docsById.get(id)!
            const updateMock = jest.fn().mockResolvedValue(undefined)
            const deleteMock = jest.fn().mockResolvedValue(undefined)
            return {
              get: () => Promise.resolve({ exists: true, data: () => q.data, id: q.id }),
              update: updateMock,
              delete: deleteMock,
              id,
            }
          }
          return {
            get: () => Promise.resolve({ exists: false }),
            update: jest.fn().mockResolvedValue(undefined),
            delete: jest.fn().mockResolvedValue(undefined),
          }
        }),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: quotes.map((q) => ({ id: q.id, data: () => q.data })) }),
        add: jest.fn().mockResolvedValue({ id: 'new-quote-id' }),
      }
    }

    if (name === 'invoices')
      return {
        add: capturedAdd,
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
      const activitiesAddFn = opts?.activitiesCapture?.capturedAdd ?? jest.fn().mockResolvedValue({ id: 'act-new' })
      return { add: activitiesAddFn }
    }

    if (name === 'outbound_webhooks')
      return {
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: [] }),
      }

    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

// ---------------------------------------------------------------------------
// GET /api/v1/quotes/:id
// ---------------------------------------------------------------------------

describe('GET /api/v1/quotes/:id', () => {
  beforeEach(() => jest.clearAllMocks())

  it('viewer GET returns quote for own org', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, { quotes: [makeQuoteDoc('q-1', { orgId: 'org-1', status: 'sent' })] })
    const req = callAsMember(viewer, 'GET', '/api/v1/quotes/q-1')
    const { GET } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await GET(req, { params: Promise.resolve({ id: 'q-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.quote.id).toBe('q-1')
    expect(body.data.quote.status).toBe('sent')
  })

  it('GET cross-org quote → 404', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, { quotes: [makeQuoteDoc('q-2', { orgId: 'org-2' })] })
    const req = callAsMember(viewer, 'GET', '/api/v1/quotes/q-2')
    const { GET } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await GET(req, { params: Promise.resolve({ id: 'q-2' }) })
    expect(res.status).toBe(404)
  })

  it('GET soft-deleted quote → 404', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, { quotes: [makeQuoteDoc('q-3', { deleted: true })] })
    const req = callAsMember(viewer, 'GET', '/api/v1/quotes/q-3')
    const { GET } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await GET(req, { params: Promise.resolve({ id: 'q-3' }) })
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/v1/quotes/:id — status transitions
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/quotes/:id — status transitions', () => {
  beforeEach(() => jest.clearAllMocks())

  it('draft → sent sets sentAt, no webhook', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member' })
    stageAuth(member, {
      quotes: [makeQuoteDoc('q-draft', { status: 'draft' })],
    })
    ;(dispatchWebhook as jest.Mock).mockClear()

    const req = callAsMember(member, 'PATCH', '/api/v1/quotes/q-draft', { status: 'sent' })
    const { PATCH } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-draft' }) })
    expect(res.status).toBe(200)

    // No webhook for draft→sent
    expect(dispatchWebhook).not.toHaveBeenCalled()
  })

  it('PATCH to accepted sets acceptedAt + fires quote.accepted webhook with explicit fields', async () => {
    // Acceptance is only permitted for the RECIPIENT org. Stage the actor as a
    // member of the recipient org (org-1); the quote is owned/sent by org-2.
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member', firstName: 'Jane', lastName: 'Doe' })
    stageAuth(member, {
      quotes: [makeQuoteDoc('q-sent', { status: 'sent', quoteNumber: 'Q-TES-001', total: 2000, currency: 'ZAR', orgId: 'org-2', sourceOrgId: 'org-2', recipientOrgId: 'org-1' })],
    })
    ;(dispatchWebhook as jest.Mock).mockClear()

    const req = callAsMember(member, 'PATCH', '/api/v1/quotes/q-sent', { status: 'accepted' })
    const { PATCH } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-sent' }) })
    expect(res.status).toBe(200)

    expect(dispatchWebhook).toHaveBeenCalledTimes(1)
    const [orgId, event, payload] = (dispatchWebhook as jest.Mock).mock.calls[0]
    expect(orgId).toBe('org-2')
    expect(event).toBe('quote.accepted')
    expect(payload).toHaveProperty('id', 'q-sent')
    expect(payload).toHaveProperty('quoteNumber', 'Q-TES-001')
    expect(payload).toHaveProperty('total', 2000)
    expect(payload).toHaveProperty('currency', 'ZAR')
    expect(payload).toHaveProperty('updatedByRef')
    // No body spread
    expect(payload).not.toHaveProperty('lineItems')
    expect(payload).not.toHaveProperty('orgId')
  })

  it('PATCH to rejected fires quote.rejected webhook with explicit fields', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member' })
    stageAuth(member, {
      quotes: [makeQuoteDoc('q-sent2', { status: 'sent', quoteNumber: 'Q-TES-002', total: 500, currency: 'ZAR', orgId: 'org-2', sourceOrgId: 'org-2', recipientOrgId: 'org-1' })],
    })
    ;(dispatchWebhook as jest.Mock).mockClear()

    const req = callAsMember(member, 'PATCH', '/api/v1/quotes/q-sent2', { status: 'rejected' })
    const { PATCH } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-sent2' }) })
    expect(res.status).toBe(200)

    expect(dispatchWebhook).toHaveBeenCalledTimes(1)
    const [, event, payload] = (dispatchWebhook as jest.Mock).mock.calls[0]
    expect(event).toBe('quote.rejected')
    expect(payload).toHaveProperty('id', 'q-sent2')
    expect(payload).toHaveProperty('quoteNumber', 'Q-TES-002')
    expect(payload).toHaveProperty('updatedByRef')
    expect(payload).not.toHaveProperty('lineItems')
    expect(payload).not.toHaveProperty('orgId')
  })

  it('viewer cannot PATCH → 403', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, { quotes: [makeQuoteDoc('q-1', {})] })
    const req = callAsMember(viewer, 'PATCH', '/api/v1/quotes/q-1', { status: 'sent' })
    const { PATCH } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-1' }) })
    expect(res.status).toBe(403)
  })

  it('PATCH cross-org quote → 404', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member' })
    stageAuth(member, {
      quotes: [makeQuoteDoc('q-other', { orgId: 'org-2' })],
    })
    const req = callAsMember(member, 'PATCH', '/api/v1/quotes/q-other', { status: 'sent' })
    const { PATCH } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-other' }) })
    expect(res.status).toBe(404)
  })

  it('draft → sent with contactId writes email activity to contact timeline', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member' })
    const capturedActivitiesAdd = jest.fn().mockResolvedValue({ id: 'act-1' })
    stageAuth(member, {
      quotes: [makeQuoteDoc('q-draft-contact', { status: 'draft', contactId: 'c-99', quoteNumber: 'Q-TES-010' })],
      activitiesCapture: { capturedAdd: capturedActivitiesAdd },
    })
    ;(dispatchWebhook as jest.Mock).mockClear()

    const req = callAsMember(member, 'PATCH', '/api/v1/quotes/q-draft-contact', { status: 'sent' })
    const { PATCH } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-draft-contact' }) })
    expect(res.status).toBe(200)
    expect(capturedActivitiesAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        contactId: 'c-99',
        type: 'email',
        summary: 'Quote sent: Q-TES-010',
      }),
    )
  })

  it('→ accepted with contactId writes note activity to contact timeline', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member' })
    const capturedActivitiesAdd = jest.fn().mockResolvedValue({ id: 'act-2' })
    stageAuth(member, {
      quotes: [makeQuoteDoc('q-sent-contact', { status: 'sent', contactId: 'c-99', quoteNumber: 'Q-TES-011', orgId: 'org-2', sourceOrgId: 'org-2', recipientOrgId: 'org-1' })],
      activitiesCapture: { capturedAdd: capturedActivitiesAdd },
    })
    ;(dispatchWebhook as jest.Mock).mockClear()

    const req = callAsMember(member, 'PATCH', '/api/v1/quotes/q-sent-contact', { status: 'accepted' })
    const { PATCH } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-sent-contact' }) })
    expect(res.status).toBe(200)
    expect(capturedActivitiesAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-2',
        contactId: 'c-99',
        type: 'note',
        summary: 'Quote accepted: Q-TES-011',
      }),
    )
  })

  it('→ rejected with contactId writes note activity to contact timeline', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member' })
    const capturedActivitiesAdd = jest.fn().mockResolvedValue({ id: 'act-3' })
    stageAuth(member, {
      quotes: [makeQuoteDoc('q-sent-rej', { status: 'sent', contactId: 'c-99', quoteNumber: 'Q-TES-012', orgId: 'org-2', sourceOrgId: 'org-2', recipientOrgId: 'org-1' })],
      activitiesCapture: { capturedAdd: capturedActivitiesAdd },
    })
    ;(dispatchWebhook as jest.Mock).mockClear()

    const req = callAsMember(member, 'PATCH', '/api/v1/quotes/q-sent-rej', { status: 'rejected' })
    const { PATCH } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-sent-rej' }) })
    expect(res.status).toBe(200)
    expect(capturedActivitiesAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-2',
        contactId: 'c-99',
        type: 'note',
        summary: 'Quote rejected: Q-TES-012',
      }),
    )
  })

  it('status change WITHOUT contactId does NOT call activities.add', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member' })
    const capturedActivitiesAdd = jest.fn().mockResolvedValue({ id: 'act-1' })
    stageAuth(member, {
      quotes: [makeQuoteDoc('q-no-contact', { status: 'draft' })],  // no contactId
      activitiesCapture: { capturedAdd: capturedActivitiesAdd },
    })

    const req = callAsMember(member, 'PATCH', '/api/v1/quotes/q-no-contact', { status: 'sent' })
    const { PATCH } = await import('@/app/api/v1/quotes/[id]/route')
    await PATCH(req, { params: Promise.resolve({ id: 'q-no-contact' }) })
    expect(capturedActivitiesAdd).not.toHaveBeenCalled()
  })

  it('PATCH empty body → 400', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member' })
    stageAuth(member, { quotes: [makeQuoteDoc('q-1', {})] })
    const req = callAsMember(member, 'PATCH', '/api/v1/quotes/q-1', {})
    const { PATCH } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-1' }) })
    expect(res.status).toBe(400)
  })

  it('PATCH always writes updatedByRef and updatedAt', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member', firstName: 'Jane', lastName: 'Doe' })
    const authCollections = makePortalAuthCollections(member)
    let capturedPatch: Record<string, unknown> = {}
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'users' || name === 'orgMembers') return authCollections[name]
      if (name === 'organizations')
        return {
          doc: () => ({
            get: () =>
              Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }),
          }),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
        }
      if (name === 'quotes')
        return {
          doc: () => ({
            get: () =>
              Promise.resolve({
                exists: true,
                id: 'q-x',
                data: () => ({ orgId: 'org-1', status: 'draft', quoteNumber: 'Q-X', total: 100, currency: 'ZAR' }),
              }),
            update: jest.fn().mockImplementation((p: Record<string, unknown>) => {
              capturedPatch = p
              return Promise.resolve()
            }),
          }),
        }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsMember(member, 'PATCH', '/api/v1/quotes/q-x', { notes: 'updated note' })
    const { PATCH } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-x' }) })
    expect(res.status).toBe(200)
    expect(capturedPatch).toHaveProperty('updatedByRef')
    expect(capturedPatch).toHaveProperty('updatedAt')
    expect((capturedPatch.updatedByRef as any).uid).toBe('uid-m')
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/v1/quotes/:id — convert-to-invoice
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/quotes/:id — convert-to-invoice', () => {
  beforeEach(() => jest.clearAllMocks())

  it('converts accepted quote to invoice, marks quote converted, returns invoiceId', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member', firstName: 'Jane', lastName: 'Doe' })
    const capturedAdd = jest.fn().mockResolvedValue({ id: 'inv-123' })
    ;(generateInvoiceNumber as jest.Mock).mockResolvedValue('TES-006')

    stageAuth(member, {
      quotes: [
        makeQuoteDoc('q-accepted', {
          status: 'accepted',
          orgId: 'org-1',
          quoteNumber: 'Q-TES-001',
          total: 5000,
          currency: 'ZAR',
          lineItems: [{ description: 'Dev', quantity: 1, unitPrice: 5000, amount: 5000 }],
          subtotal: 5000,
          taxRate: 0,
          taxAmount: 0,
          notes: 'Test notes',
          fromDetails: { companyName: 'Partners in Biz' },
          clientDetails: { name: 'Acme' },
        }),
      ],
      invoiceCapture: { capturedAdd },
    })

    const req = callAsMember(member, 'PATCH', '/api/v1/quotes/q-accepted', {
      action: 'convert-to-invoice',
    })
    const { PATCH } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-accepted' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.invoiceId).toBe('inv-123')
    expect(body.data.invoiceNumber).toBe('TES-006')

    // Invoice doc was created with correct fields
    expect(capturedAdd).toHaveBeenCalledTimes(1)
    const invoiceDoc = capturedAdd.mock.calls[0][0]
    expect(invoiceDoc).toHaveProperty('orgId', 'org-1')
    expect(invoiceDoc).toHaveProperty('invoiceNumber', 'TES-006')
    expect(invoiceDoc).toHaveProperty('status', 'draft')
    expect(invoiceDoc.lineItems).toBeDefined()
    expect(invoiceDoc.total).toBe(5000)

    // generateInvoiceNumber was called
    expect(generateInvoiceNumber).toHaveBeenCalledWith('org-1', expect.any(String))
  })

  it('convert-to-invoice on non-accepted quote → 400', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member' })
    stageAuth(member, {
      quotes: [makeQuoteDoc('q-draft2', { status: 'draft' })],
    })

    const req = callAsMember(member, 'PATCH', '/api/v1/quotes/q-draft2', {
      action: 'convert-to-invoice',
    })
    const { PATCH } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-draft2' }) })
    expect(res.status).toBe(400)
  })

  it('convert-to-invoice when already converted → 400', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member' })
    stageAuth(member, {
      quotes: [
        makeQuoteDoc('q-already', {
          status: 'accepted',
          convertedInvoiceId: 'existing-inv',
        }),
      ],
    })

    const req = callAsMember(member, 'PATCH', '/api/v1/quotes/q-already', {
      action: 'convert-to-invoice',
    })
    const { PATCH } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-already' }) })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/v1/quotes/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/quotes/:id', () => {
  beforeEach(() => jest.clearAllMocks())

  it('admin DELETE → 200 and hard deletes the doc', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin' })
    stageAuth(admin, { quotes: [makeQuoteDoc('q-del', {})] })

    const req = callAsMember(admin, 'DELETE', '/api/v1/quotes/q-del')
    const { DELETE } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await DELETE(req, { params: Promise.resolve({ id: 'q-del' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('id', 'q-del')
  })

  it('member DELETE → 403', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member' })
    stageAuth(member, { quotes: [makeQuoteDoc('q-del2', {})] })

    const req = callAsMember(member, 'DELETE', '/api/v1/quotes/q-del2')
    const { DELETE } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await DELETE(req, { params: Promise.resolve({ id: 'q-del2' }) })
    expect(res.status).toBe(403)
  })

  it('DELETE cross-org → 404', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin' })
    stageAuth(admin, { quotes: [makeQuoteDoc('q-cross', { orgId: 'org-2' })] })

    const req = callAsMember(admin, 'DELETE', '/api/v1/quotes/q-cross')
    const { DELETE } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await DELETE(req, { params: Promise.resolve({ id: 'q-cross' }) })
    expect(res.status).toBe(404)
  })

  it('agent (Bearer) can DELETE (bypasses admin gate)', async () => {
    ;(adminDb.runTransaction as jest.Mock).mockImplementation(
      async (cb: (tx: any) => Promise<unknown>) => cb({ get: jest.fn(), set: jest.fn() }),
    )

    let deleteCalled = false
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'organizations')
        return {
          doc: () => ({
            get: () =>
              Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }),
          }),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
        }
      if (name === 'quotes')
        return {
          doc: () => ({
            get: () =>
              Promise.resolve({
                exists: true,
                data: () => ({ orgId: 'org-1', status: 'draft', quoteNumber: 'Q-1', total: 0, currency: 'ZAR' }),
              }),
            delete: jest.fn().mockImplementation(() => {
              deleteCalled = true
              return Promise.resolve()
            }),
            update: jest.fn().mockResolvedValue(undefined),
          }),
        }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsAgent('org-1', 'DELETE', '/api/v1/quotes/q-agent-del', undefined, AI_API_KEY)
    const { DELETE } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await DELETE(req, { params: Promise.resolve({ id: 'q-agent-del' }) })
    expect(res.status).toBe(200)
    expect(deleteCalled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Agent PATCH uses AGENT_PIP_REF as updatedByRef
// ---------------------------------------------------------------------------

describe('agent PATCH uses AGENT_PIP_REF', () => {
  beforeEach(() => jest.clearAllMocks())

  it('agent PATCH updatedByRef is AGENT_PIP_REF', async () => {
    let capturedPatch: Record<string, unknown> = {}
    ;(adminDb.runTransaction as jest.Mock).mockImplementation(
      async (cb: (tx: any) => Promise<unknown>) => cb({ get: jest.fn(), set: jest.fn() }),
    )
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'organizations')
        return {
          doc: () => ({
            get: () =>
              Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }),
          }),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
        }
      if (name === 'quotes')
        return {
          doc: () => ({
            get: () =>
              Promise.resolve({
                exists: true,
                data: () => ({
                  orgId: 'org-1',
                  status: 'draft',
                  quoteNumber: 'Q-A',
                  total: 100,
                  currency: 'ZAR',
                }),
              }),
            update: jest.fn().mockImplementation((p: Record<string, unknown>) => {
              capturedPatch = p
              return Promise.resolve()
            }),
          }),
        }
      if (name === 'outbound_webhooks')
        return {
          where: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ docs: [] }),
        }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsAgent('org-1', 'PATCH', '/api/v1/quotes/q-agent', { notes: 'agent note' }, AI_API_KEY)
    const { PATCH } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-agent' }) })
    expect(res.status).toBe(200)
    expect((capturedPatch.updatedByRef as any).uid).toBe('agent:pip')
    expect((capturedPatch.updatedByRef as any).kind).toBe('agent')
    // agent path: no updatedBy uid field
    expect(capturedPatch.updatedBy).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/v1/quotes/:id — companyId wiring
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/quotes/:id — companyId wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(loadCompany as jest.Mock).mockReset()
  })

  it('PATCH contactId change re-derives companyId from new contact', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member', firstName: 'Jane', lastName: 'Doe' })
    let capturedPatch: Record<string, unknown> = {}
    stageAuth(member, {
      quotes: [makeQuoteDoc('q-contact-change', { status: 'draft', contactId: 'c-old' })],
      contactDoc: { orgId: 'org-1', companyId: 'co-new', companyName: 'New Corp' },
    })
    ;(loadCompany as jest.Mock).mockResolvedValue(null)

    // Intercept the update to capture what was written
    const origCollection = (adminDb.collection as jest.Mock).getMockImplementation()
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      const result = origCollection!(name)
      if (name === 'quotes') {
        return {
          ...result,
          doc: jest.fn((id?: string) => {
            const orig = result.doc(id)
            return {
              ...orig,
              update: jest.fn().mockImplementation((p: Record<string, unknown>) => {
                capturedPatch = p
                return Promise.resolve()
              }),
            }
          }),
        }
      }
      return result
    })

    const req = callAsMember(member, 'PATCH', '/api/v1/quotes/q-contact-change', { contactId: 'c-new' })
    const { PATCH } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-contact-change' }) })
    expect(res.status).toBe(200)
    expect(capturedPatch.companyId).toBe('co-new')
    expect(capturedPatch.companyName).toBe('New Corp')
  })

  it('PATCH { companyId: "" } clears both fields via FieldValue.delete()', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member', firstName: 'Jane', lastName: 'Doe' })
    let capturedPatch: Record<string, unknown> = {}
    stageAuth(member, {
      quotes: [makeQuoteDoc('q-clear-co', { status: 'draft', companyId: 'co-existing', companyName: 'Old Corp' })],
    })
    ;(loadCompany as jest.Mock).mockResolvedValue(null)

    const origCollection = (adminDb.collection as jest.Mock).getMockImplementation()
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      const result = origCollection!(name)
      if (name === 'quotes') {
        return {
          ...result,
          doc: jest.fn((id?: string) => {
            const orig = result.doc(id)
            return {
              ...orig,
              update: jest.fn().mockImplementation((p: Record<string, unknown>) => {
                capturedPatch = p
                return Promise.resolve()
              }),
            }
          }),
        }
      }
      return result
    })

    const req = callAsMember(member, 'PATCH', '/api/v1/quotes/q-clear-co', { companyId: '' })
    const { PATCH } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-clear-co' }) })
    // companyId: '' counts as an editable field, so should not return 400
    expect(res.status).toBe(200)
    // Both companyId and companyName should be FieldValue.delete() sentinels
    expect(capturedPatch.companyId).toBeDefined()
    expect(capturedPatch.companyName).toBeDefined()
    // FieldValue.delete() is an object, not a string — verify it's not a plain value
    expect(typeof capturedPatch.companyId).not.toBe('string')
  })

  it('webhook quote.accepted payload includes companyId', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member', firstName: 'Jane', lastName: 'Doe' })
    stageAuth(member, {
      quotes: [makeQuoteDoc('q-co-accepted', {
        status: 'sent',
        quoteNumber: 'Q-TES-099',
        total: 3000,
        currency: 'ZAR',
        companyId: 'co-xyz',
        companyName: 'XYZ Ltd',
        orgId: 'org-2',
        sourceOrgId: 'org-2',
        recipientOrgId: 'org-1',
      })],
    })
    ;(loadCompany as jest.Mock).mockResolvedValue(null)
    ;(dispatchWebhook as jest.Mock).mockClear()

    const req = callAsMember(member, 'PATCH', '/api/v1/quotes/q-co-accepted', { status: 'accepted' })
    const { PATCH } = await import('@/app/api/v1/quotes/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'q-co-accepted' }) })
    expect(res.status).toBe(200)

    const [, event, payload] = (dispatchWebhook as jest.Mock).mock.calls[0]
    expect(event).toBe('quote.accepted')
    expect(payload).toHaveProperty('companyId', 'co-xyz')
    expect(payload).toHaveProperty('companyName', 'XYZ Ltd')
  })
})
