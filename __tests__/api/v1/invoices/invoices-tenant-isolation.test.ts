/**
 * Consolidated cross-tenant isolation suite for invoice routes.
 *
 * Mirrors the same where-respecting mock pattern from
 * quotes-tenant-isolation.test.ts and forms-tenant-isolation.test.ts.
 *
 * Distinct uids avoid substring collisions (PR 3 lesson):
 *   uid-amem  → member in org-a (sender side)
 *   uid-bmem  → member in org-b (recipient side)
 *   uid-cmem  → member in unrelated org-c
 *
 * Fixtures:
 *   invAB  (org-a → org-b, id=inv-ab, status=draft, createdBy=uid-amem)
 *   invB   (org-b only, id=inv-b, status=draft, createdBy=uid-bmem)
 *   invLegacyB (org-b only, no source/recipient, id=inv-legacy-b)
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn(), runTransaction: jest.fn() },
}))

jest.mock('@/lib/notifications/notify', () => ({
  notifyInvoiceSent: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/activity/log', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/webhooks/dispatch', () => ({
  dispatchWebhook: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/email-analytics/attribution-hooks', () => ({
  tryAttributeInvoicePaid: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/invoices/invoice-number', () => ({
  generateInvoiceNumber: jest.fn().mockResolvedValue('INV-TST-001'),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => '__serverTimestamp__',
    increment: (n: number) => ({ __increment: n }),
  },
  Timestamp: { fromDate: (d: Date) => d.toISOString() },
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { seedOrgMember, callAsMember } from '../../../helpers/crm'
import { makePortalAuthCollectionsForMembers } from '../../../helpers/firebase-admin'

const AI_API_KEY = 'test-ai-key'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ── Actors ───────────────────────────────────────────────────────────────────

const memberA = seedOrgMember('org-a', 'uid-amem', { role: 'member', firstName: 'A', lastName: 'M' })
const memberB = seedOrgMember('org-b', 'uid-bmem', { role: 'member', firstName: 'B', lastName: 'M' })
const memberC = seedOrgMember('org-c', 'uid-cmem', { role: 'member', firstName: 'C', lastName: 'M' })

// ── Fixtures ──────────────────────────────────────────────────────────────────

const invAB = {
  id: 'inv-ab',
  orgId: 'org-a',
  sourceOrgId: 'org-a',
  recipientOrgId: 'org-b',
  invoiceNumber: 'INV-AB-001',
  status: 'draft',
  total: 1000,
  currency: 'ZAR',
  subtotal: 1000,
  taxRate: 0,
  taxAmount: 0,
  notes: '',
  lineItems: [{ description: 'Consulting', quantity: 1, unitPrice: 1000, amount: 1000 }],
  fromDetails: { companyName: 'Org A Corp' },
  clientDetails: { name: 'Org B Client' },
  companyId: 'company-a',
  targetCompanyId: 'company-b-sender',
  paidAt: null,
  sentAt: null,
  createdBy: 'uid-amem',
}

const invB = {
  id: 'inv-b',
  orgId: 'org-b',
  invoiceNumber: 'INV-B-001',
  status: 'draft',
  total: 500,
  currency: 'ZAR',
  subtotal: 500,
  taxRate: 0,
  taxAmount: 0,
  notes: '',
  lineItems: [{ description: 'Design', quantity: 1, unitPrice: 500, amount: 500 }],
  fromDetails: { companyName: 'Org B Corp' },
  clientDetails: { name: 'Org B Client' },
  paidAt: null,
  sentAt: null,
  createdBy: 'uid-bmem',
}

const invLegacyB = {
  id: 'inv-legacy-b',
  orgId: 'org-b',
  invoiceNumber: 'INV-B-002',
  status: 'draft',
  total: 250,
  currency: 'ZAR',
  subtotal: 250,
  taxRate: 0,
  taxAmount: 0,
  notes: '',
  lineItems: [{ description: 'Retainer', quantity: 1, unitPrice: 250, amount: 250 }],
  fromDetails: { companyName: 'Org B Corp' },
  clientDetails: { name: 'Org B Client' },
  paidAt: null,
  sentAt: null,
  createdBy: 'uid-bmem',
}

// ── Route context helper ──────────────────────────────────────────────────────

const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) })

// ── Core isolation fixture setup ──────────────────────────────────────────────

let invoiceUpdates: Array<Record<string, unknown>>
let invoiceDeletes: string[]

function setupIsolationFixtures() {
  const authCollections = makePortalAuthCollectionsForMembers([memberA, memberB, memberC])
  invoiceUpdates = []
  invoiceDeletes = []

  // Restricted platform admins for issuer (org-a), recipient (org-b) and unrelated (org-c) sides.
  const adminA = { uid: 'uid-aadm', orgId: 'org-a', role: 'admin', orgIds: ['org-a'], activeOrgId: 'org-a', allowedOrgIds: ['org-a'] }
  const adminB = { uid: 'uid-badm', orgId: 'org-b', role: 'admin', orgIds: ['org-b'], activeOrgId: 'org-b', allowedOrgIds: ['org-b'] }
  const adminC = { uid: 'uid-cadm', orgId: 'org-c', role: 'admin', orgIds: ['org-c'], activeOrgId: 'org-c', allowedOrgIds: ['org-c'] }
  const memberByUid = new Map([memberA, memberB, memberC].map((m) => [m.uid, m]))
  const adminByUid = new Map([adminA, adminB, adminC].map((a) => [a.uid, a]))

  authCollections.users = {
    doc: jest.fn((uid: string) => ({
      get: jest.fn(async () => {
        const admin = adminByUid.get(uid)
        const member = memberByUid.get(uid)
        return {
          exists: !!admin || !!member,
          data: () => admin ?? (member ? { activeOrgId: member.orgId } : undefined),
        }
      }),
    })),
  }
  authCollections.orgMembers = {
    doc: jest.fn((id: string) => {
      const byDocId = new Map<string, unknown>([
        ...Array.from(memberByUid.entries()).map(([uid, m]) => [`${m.orgId}_${uid}`, m]),
        ...Array.from(adminByUid.entries()).map(([uid, a]) => [`${a.orgId}_${uid}`, { orgId: a.orgId, uid, role: 'admin' }]),
      ])
      return {
        get: jest.fn(async () => ({ exists: byDocId.has(id), data: () => byDocId.get(id) })),
      }
    }),
  }

  ;(adminAuth.verifySessionCookie as jest.Mock).mockImplementation((cookie: string) => {
    if (cookie.endsWith(memberA.uid)) return Promise.resolve({ uid: memberA.uid })
    if (cookie.endsWith(memberB.uid)) return Promise.resolve({ uid: memberB.uid })
    if (cookie.endsWith(memberC.uid)) return Promise.resolve({ uid: memberC.uid })
    if (cookie.endsWith(adminA.uid)) return Promise.resolve({ uid: adminA.uid })
    if (cookie.endsWith(adminB.uid)) return Promise.resolve({ uid: adminB.uid })
    if (cookie.endsWith(adminC.uid)) return Promise.resolve({ uid: adminC.uid })
    return Promise.reject(new Error('invalid'))
  })

  ;(adminDb.runTransaction as jest.Mock).mockImplementation(async (cb: any) => {
    const fakeTx = { get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ count: 0 }) }), set: jest.fn(), update: jest.fn() }
    return cb(fakeTx)
  })

  const invoiceDocData = (id?: string) =>
    id === 'inv-ab' ? invAB
      : id === 'inv-b' ? invB
        : id === 'inv-legacy-b' ? invLegacyB
          : undefined

  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users' || name === 'orgMembers' || name === 'organizations') return authCollections[name]

    if (name === 'invoices') {
      return {
        doc: jest.fn().mockImplementation((id?: string) => {
          const docData = invoiceDocData(id)
          return {
            id: id ?? 'invoice',
            get: () => Promise.resolve({ exists: !!docData, id, data: () => docData }),
            update: jest.fn((data: Record<string, unknown>) => {
              invoiceUpdates.push({ ...data, _docId: id })
              return Promise.resolve()
            }),
            delete: jest.fn(() => {
              invoiceDeletes.push(id ?? '')
              return Promise.resolve()
            }),
          }
        }),
      }
    }

    if (name === 'companies' || name === 'contacts') {
      // company-a belongs to the sender's org; company-b-sender belongs to the
      // recipient's org and is assigned to memberB, making invAB readable in
      // org-b's owned_or_linked book.
      const docs: Record<string, { orgId: string; assignedTo?: string; deleted?: boolean }> = {
        'company-a': { orgId: 'org-a', assignedTo: 'uid-amem' },
        'company-b-sender': { orgId: 'org-b', assignedTo: 'uid-bmem' },
      }
      return {
        doc: jest.fn().mockImplementation((id?: string) => ({
          get: () => Promise.resolve({
            exists: !!id && !!docs[id],
            data: () => (id ? docs[id] : undefined),
          }),
        })),
      }
    }

    if (name === 'activities' || name === 'notifications') {
      return {
        add: jest.fn().mockResolvedValue({ id: 'activity-1' }),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: [] }),
      }
    }

    if (name === 'platform_config') {
      return {
        doc: () => ({ get: jest.fn().mockResolvedValue({ exists: false }) }),
      }
    }

    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })

  return { authCollections }
}

beforeEach(() => { jest.clearAllMocks() })

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('cross-tenant isolation + sender/recipient action authority: invoices', () => {

  // ── GET /api/v1/invoices/:id ────────────────────────────────────────────────

  it('sender member can open their issued invoice with issuer capabilities', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberA, 'GET', '/api/v1/invoices/inv-ab')
    const { GET } = await import('@/app/api/v1/invoices/[id]/route')
    const res = await GET(req, routeCtx('inv-ab'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.canEdit).toBe(true)
    expect(body.data.canSend).toBe(true)
    expect(body.data.canCancel).toBe(true)
  })

  it('recipient member can open the same invoice but WITHOUT issuer capabilities', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberB, 'GET', '/api/v1/invoices/inv-ab')
    const { GET } = await import('@/app/api/v1/invoices/[id]/route')
    const res = await GET(req, routeCtx('inv-ab'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.canEdit).toBe(false)
    expect(body.data.canSend).toBe(false)
    expect(body.data.canCancel).toBe(false)
    expect(body.data.canMarkPaid).toBe(false)
  })

  it('unrelated org member GET is a 404, not a forbidden leak', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberC, 'GET', '/api/v1/invoices/inv-ab')
    const { GET } = await import('@/app/api/v1/invoices/[id]/route')
    const res = await GET(req, routeCtx('inv-ab'))
    expect(res.status).toBe(404)
  })

  // ── PATCH /api/v1/invoices/:id — status mutations ──────────────────────────

  it('sender member may send their draft invoice (draft → sent)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberA, 'PATCH', '/api/v1/invoices/inv-ab', { status: 'sent' })
    const { PATCH } = await import('@/app/api/v1/invoices/[id]/route')
    const res = await PATCH(req, routeCtx('inv-ab'))
    expect(res.status).toBe(200)
    expect(invoiceUpdates.some((u) => u._docId === 'inv-ab' && u.status === 'sent')).toBe(true)
  })

  it('recipient member CANNOT mutate issuer-controlled status (send) → 403, no write', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberB, 'PATCH', '/api/v1/invoices/inv-ab', { status: 'sent' })
    const { PATCH } = await import('@/app/api/v1/invoices/[id]/route')
    const res = await PATCH(req, routeCtx('inv-ab'))
    expect(res.status).toBe(403)
    expect(invoiceUpdates).toHaveLength(0)
  })

  it('recipient member CANNOT cancel or flip to overdue → 403, no write', async () => {
    setupIsolationFixtures()
    const { PATCH } = await import('@/app/api/v1/invoices/[id]/route')
    for (const status of ['cancelled', 'overdue']) {
      const req = callAsMember(memberB, 'PATCH', '/api/v1/invoices/inv-ab', { status })
      const res = await PATCH(req, routeCtx('inv-ab'))
      expect(res.status).toBe(403)
    }
    expect(invoiceUpdates).toHaveLength(0)
  })

  it('recipient member CANNOT edit draft commercial fields → 403, no write', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberB, 'PATCH', '/api/v1/invoices/inv-ab', { notes: 'change terms' })
    const { PATCH } = await import('@/app/api/v1/invoices/[id]/route')
    const res = await PATCH(req, routeCtx('inv-ab'))
    expect(res.status).toBe(403)
    expect(invoiceUpdates).toHaveLength(0)
  })

  it('legacy (orgId-only) member is treated as issuer and may send their draft', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberB, 'PATCH', '/api/v1/invoices/inv-legacy-b', { status: 'sent' })
    const { PATCH } = await import('@/app/api/v1/invoices/[id]/route')
    const res = await PATCH(req, routeCtx('inv-legacy-b'))
    expect(res.status).toBe(200)
    expect(invoiceUpdates.some((u) => u._docId === 'inv-legacy-b' && u.status === 'sent')).toBe(true)
  })

  it('unrelated org member CANNOT PATCH a foreign invoice → 404, no write', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberA, 'PATCH', '/api/v1/invoices/inv-b', { status: 'sent' })
    const { PATCH } = await import('@/app/api/v1/invoices/[id]/route')
    const res = await PATCH(req, routeCtx('inv-b'))
    expect(res.status).toBe(404)
    expect(invoiceUpdates).toHaveLength(0)
  })

  // ── DELETE /api/v1/invoices/:id ─────────────────────────────────────────────

  it('restricted admin of the RECIPIENT org CANNOT delete the invoice → 403', async () => {
    setupIsolationFixtures()
    const req = callAsMember({ orgId: 'org-b', uid: 'uid-badm', role: 'admin', firstName: 'B', lastName: 'A' }, 'DELETE', '/api/v1/invoices/inv-ab')
    const { DELETE } = await import('@/app/api/v1/invoices/[id]/route')
    const res = await DELETE(req, routeCtx('inv-ab'))
    expect(res.status).toBe(403)
    expect(invoiceDeletes).toHaveLength(0)
  })

  it('restricted admin of the SENDER org may delete their issued invoice → 200', async () => {
    setupIsolationFixtures()
    const req = callAsMember({ orgId: 'org-a', uid: 'uid-aadm', role: 'admin', firstName: 'A', lastName: 'A' }, 'DELETE', '/api/v1/invoices/inv-ab')
    const { DELETE } = await import('@/app/api/v1/invoices/[id]/route')
    const res = await DELETE(req, routeCtx('inv-ab'))
    expect(res.status).toBe(200)
    expect(invoiceDeletes).toContain('inv-ab')
  })

  it('unrelated org admin CANNOT delete → 404 (no existence leak)', async () => {
    setupIsolationFixtures()
    const req = callAsMember({ orgId: 'org-c', uid: 'uid-cadm', role: 'admin', firstName: 'C', lastName: 'A' }, 'DELETE', '/api/v1/invoices/inv-ab')
    const { DELETE } = await import('@/app/api/v1/invoices/[id]/route')
    const res = await DELETE(req, routeCtx('inv-ab'))
    expect(res.status).toBe(404)
    expect(invoiceDeletes).toHaveLength(0)
  })

  // ── PATCH /api/v1/invoices/:id/mark-paid — issuer verification only ────────

  it('recipient member CANNOT mark-paid (must use payment-proof workflow) → 403', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberB, 'PATCH', '/api/v1/invoices/inv-ab/mark-paid', {
      paymentMethod: 'eft',
    })
    const { PATCH } = await import('@/app/api/v1/invoices/[id]/mark-paid/route')
    const res = await PATCH(req, routeCtx('inv-ab'))
    expect(res.status).toBe(403)
    expect(invoiceUpdates).toHaveLength(0)
    expect(dispatchWebhook).not.toHaveBeenCalled()
  })

  it('sender member may mark-paid their issued invoice → 200', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberA, 'PATCH', '/api/v1/invoices/inv-ab/mark-paid', {
      paymentMethod: 'eft',
      reference: 'REF-1',
    })
    const { PATCH } = await import('@/app/api/v1/invoices/[id]/mark-paid/route')
    const res = await PATCH(req, routeCtx('inv-ab'))
    expect(res.status).toBe(200)
    expect(invoiceUpdates.some((u) => u._docId === 'inv-ab' && u.status === 'paid')).toBe(true)
  })
})
