// __tests__/api/crm/contacts/send-email.test.ts
import { NextRequest } from 'next/server'

// ── Firebase mock ─────────────────────────────────────────────────────────────
const mockContactGet = jest.fn()
const mockActivityDoc = jest.fn()
const mockBatchSet = jest.fn()
const mockBatchUpdate = jest.fn()
const mockBatchCommit = jest.fn()
const mockBatch = jest.fn(() => ({
  set: mockBatchSet,
  update: mockBatchUpdate,
  commit: mockBatchCommit,
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((name: string) => {
      if (name === 'contacts') {
        return { doc: jest.fn(() => ({ get: mockContactGet })) }
      }
      if (name === 'activities') {
        return { doc: mockActivityDoc }
      }
      if (name === 'suppressions') {
        // isSuppressed() does collection('suppressions').doc(id).get().
        // Return not-suppressed so the happy path proceeds.
        return { doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false }) })) }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    batch: mockBatch,
  },
}))

// ── Email mock ────────────────────────────────────────────────────────────────
const mockSendEmail = jest.fn()
jest.mock('@/lib/email/send', () => ({ sendEmail: mockSendEmail }))

// ── CRM auth mock — pass-through with injected ctx ───────────────────────────
const ACTOR_REF = { uid: 'uid-tester', displayName: 'Tester', kind: 'human' as const }
const ORG_ID = 'org-abc'

jest.mock('@/lib/auth/crm-middleware', () => ({
  withCrmAuth:
    (_minRole: string, handler: Function) =>
    (req: NextRequest, routeCtx?: unknown) =>
      handler(req, { orgId: ORG_ID, actor: ACTOR_REF, role: 'member', isAgent: false, permissions: {} }, routeCtx),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeReq(body: unknown, contactId = 'contact-1') {
  return new NextRequest(`http://localhost/api/v1/crm/contacts/${contactId}/send-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeRouteCtx(id = 'contact-1') {
  return { params: Promise.resolve({ id }) }
}

function contactSnap(data: Record<string, unknown> | null) {
  return { exists: data !== null, data: () => data ?? undefined }
}

beforeEach(() => {
  jest.clearAllMocks()
  // Default: batch methods succeed
  mockBatchCommit.mockResolvedValue(undefined)
  mockActivityDoc.mockReturnValue({ id: 'new-activity' })
})

describe('POST /api/v1/crm/contacts/:id/send-email', () => {
  it('happy path → { sent: true }', async () => {
    mockContactGet.mockResolvedValue(
      contactSnap({ orgId: ORG_ID, email: 'user@example.com', name: 'Test Contact' }),
    )
    mockSendEmail.mockResolvedValue({ success: true })

    const { POST } = await import(
      '@/app/api/v1/crm/contacts/[id]/send-email/route'
    )
    const res = await POST(makeReq({ subject: 'Hello', bodyText: 'World' }), makeRouteCtx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.sent).toBe(true)
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@example.com', subject: 'Hello' }),
    )
  })

  it('missing subject → 400', async () => {
    const { POST } = await import(
      '@/app/api/v1/crm/contacts/[id]/send-email/route'
    )
    const res = await POST(makeReq({ bodyText: 'Hi' }), makeRouteCtx())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/subject/i)
  })

  it('missing bodyText → 400', async () => {
    const { POST } = await import(
      '@/app/api/v1/crm/contacts/[id]/send-email/route'
    )
    const res = await POST(makeReq({ subject: 'Hi' }), makeRouteCtx())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/bodyText/i)
  })

  it('contact not found → 404', async () => {
    mockContactGet.mockResolvedValue(contactSnap(null))
    const { POST } = await import(
      '@/app/api/v1/crm/contacts/[id]/send-email/route'
    )
    const res = await POST(makeReq({ subject: 'Hi', bodyText: 'Hey' }), makeRouteCtx('ghost'))
    expect(res.status).toBe(404)
  })

  it('wrong orgId on contact → 404', async () => {
    mockContactGet.mockResolvedValue(contactSnap({ orgId: 'other-org', email: 'x@x.com' }))
    const { POST } = await import(
      '@/app/api/v1/crm/contacts/[id]/send-email/route'
    )
    const res = await POST(makeReq({ subject: 'Hi', bodyText: 'Hey' }), makeRouteCtx())
    expect(res.status).toBe(404)
  })

  it('contact has no email → 400', async () => {
    mockContactGet.mockResolvedValue(contactSnap({ orgId: ORG_ID, name: 'No Email' }))
    const { POST } = await import(
      '@/app/api/v1/crm/contacts/[id]/send-email/route'
    )
    const res = await POST(makeReq({ subject: 'Hi', bodyText: 'Hey' }), makeRouteCtx())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/email/i)
  })

  it('sendEmail failure → 500', async () => {
    mockContactGet.mockResolvedValue(
      contactSnap({ orgId: ORG_ID, email: 'user@example.com' }),
    )
    mockSendEmail.mockResolvedValue({ success: false, error: 'SMTP timeout' })
    const { POST } = await import(
      '@/app/api/v1/crm/contacts/[id]/send-email/route'
    )
    const res = await POST(makeReq({ subject: 'Hi', bodyText: 'Hey' }), makeRouteCtx())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/SMTP timeout/i)
  })

  it('bodyHtml used as html when provided', async () => {
    mockContactGet.mockResolvedValue(
      contactSnap({ orgId: ORG_ID, email: 'user@example.com' }),
    )
    mockSendEmail.mockResolvedValue({ success: true })
    const { POST } = await import(
      '@/app/api/v1/crm/contacts/[id]/send-email/route'
    )
    const res = await POST(
      makeReq({ subject: 'Hi', bodyText: 'plain', bodyHtml: '<b>rich</b>' }),
      makeRouteCtx(),
    )
    expect(res.status).toBe(200)
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ html: '<b>rich</b>' }),
    )
  })

  it('activity write failure does NOT block the 200 response', async () => {
    mockContactGet.mockResolvedValue(
      contactSnap({ orgId: ORG_ID, email: 'user@example.com' }),
    )
    mockSendEmail.mockResolvedValue({ success: true })
    mockBatchCommit.mockRejectedValue(new Error('Firestore down'))
    const { POST } = await import(
      '@/app/api/v1/crm/contacts/[id]/send-email/route'
    )
    const res = await POST(makeReq({ subject: 'Hi', bodyText: 'Hey' }), makeRouteCtx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.sent).toBe(true)
  })
})
