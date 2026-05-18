// __tests__/api/crm/contacts/send-sms.test.ts
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
      throw new Error(`Unexpected collection: ${name}`)
    }),
    batch: mockBatch,
  },
}))

// ── SMS mock ──────────────────────────────────────────────────────────────────
const mockSendSms = jest.fn()
jest.mock('@/lib/sms/twilio', () => ({ sendSms: mockSendSms }))

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
  return new NextRequest(`http://localhost/api/v1/crm/contacts/${contactId}/send-sms`, {
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
  mockBatchCommit.mockResolvedValue(undefined)
  mockActivityDoc.mockReturnValue({ id: 'new-activity' })
})

describe('POST /api/v1/crm/contacts/:id/send-sms', () => {
  it('happy path → { sent: true }', async () => {
    mockContactGet.mockResolvedValue(
      contactSnap({ orgId: ORG_ID, phone: '+27821234567', name: 'Test Contact' }),
    )
    mockSendSms.mockResolvedValue({ ok: true, twilioSid: 'SM123', segmentsCount: 1 })

    const { POST } = await import('@/app/api/v1/crm/contacts/[id]/send-sms/route')
    const res = await POST(makeReq({ message: 'Hello there' }), makeRouteCtx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.sent).toBe(true)
    expect(mockSendSms).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+27821234567', body: 'Hello there' }),
    )
  })

  it('missing message → 400', async () => {
    const { POST } = await import('@/app/api/v1/crm/contacts/[id]/send-sms/route')
    const res = await POST(makeReq({}), makeRouteCtx())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/message/i)
  })

  it('empty message string → 400', async () => {
    const { POST } = await import('@/app/api/v1/crm/contacts/[id]/send-sms/route')
    const res = await POST(makeReq({ message: '   ' }), makeRouteCtx())
    expect(res.status).toBe(400)
  })

  it('contact not found → 404', async () => {
    mockContactGet.mockResolvedValue(contactSnap(null))
    const { POST } = await import('@/app/api/v1/crm/contacts/[id]/send-sms/route')
    const res = await POST(makeReq({ message: 'Hi' }), makeRouteCtx('ghost'))
    expect(res.status).toBe(404)
  })

  it('wrong orgId on contact → 404', async () => {
    mockContactGet.mockResolvedValue(contactSnap({ orgId: 'other-org', phone: '+27821234567' }))
    const { POST } = await import('@/app/api/v1/crm/contacts/[id]/send-sms/route')
    const res = await POST(makeReq({ message: 'Hi' }), makeRouteCtx())
    expect(res.status).toBe(404)
  })

  it('contact has no phone → 400', async () => {
    mockContactGet.mockResolvedValue(contactSnap({ orgId: ORG_ID, name: 'No Phone' }))
    const { POST } = await import('@/app/api/v1/crm/contacts/[id]/send-sms/route')
    const res = await POST(makeReq({ message: 'Hi' }), makeRouteCtx())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/phone/i)
  })

  it('sendSms failure → 500', async () => {
    mockContactGet.mockResolvedValue(
      contactSnap({ orgId: ORG_ID, phone: '+27821234567' }),
    )
    mockSendSms.mockResolvedValue({ ok: false, twilioSid: '', error: 'Invalid number', segmentsCount: 1 })
    const { POST } = await import('@/app/api/v1/crm/contacts/[id]/send-sms/route')
    const res = await POST(makeReq({ message: 'Hi' }), makeRouteCtx())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/Invalid number/i)
  })

  it('activity write failure does NOT block the 200 response', async () => {
    mockContactGet.mockResolvedValue(
      contactSnap({ orgId: ORG_ID, phone: '+27821234567' }),
    )
    mockSendSms.mockResolvedValue({ ok: true, twilioSid: 'SM999', segmentsCount: 1 })
    mockBatchCommit.mockRejectedValue(new Error('Firestore down'))
    const { POST } = await import('@/app/api/v1/crm/contacts/[id]/send-sms/route')
    const res = await POST(makeReq({ message: 'Hi' }), makeRouteCtx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.sent).toBe(true)
  })
})
