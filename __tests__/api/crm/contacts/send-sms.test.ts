// __tests__/api/crm/contacts/send-sms.test.ts
import { NextRequest } from 'next/server'

// ── Firebase mock ─────────────────────────────────────────────────────────────
const mockContactGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((name: string) => {
      if (name === 'contacts') {
        return { doc: jest.fn(() => ({ get: mockContactGet })) }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
  },
}))

// ── SMS pipeline mock ─────────────────────────────────────────────────────────
const mockSendSmsToContact = jest.fn()
jest.mock('@/lib/sms/send', () => ({ sendSmsToContact: mockSendSmsToContact }))

// ── CRM auth mock — pass-through with injected ctx ───────────────────────────
const ACTOR_REF = { uid: 'uid-tester', displayName: 'Tester', kind: 'human' as const }
const ORG_ID = 'org-abc'

jest.mock('@/lib/auth/crm-middleware', () => ({
  withCrmAuth:
    (_minRole: string, handler: (req: NextRequest, ctx: unknown, routeCtx?: unknown) => unknown) =>
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
})

describe('POST /api/v1/crm/contacts/:id/send-sms', () => {
  it('uses the shared SMS send pipeline so suppressions/preferences/frequency gates apply', async () => {
    mockContactGet.mockResolvedValue(
      contactSnap({ orgId: ORG_ID, phone: '+27821234567', name: 'Test Contact' }),
    )
    mockSendSmsToContact.mockResolvedValue({ status: 'sent', twilioSid: 'SM123', smsId: 'sms-1', segmentsCount: 1 })

    const { POST } = await import('@/app/api/v1/crm/contacts/[id]/send-sms/route')
    const res = await POST(makeReq({ message: 'Hello there' }), makeRouteCtx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.sent).toBe(true)
    expect(body.data.smsId).toBe('sms-1')
    expect(mockSendSmsToContact).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG_ID, contactId: 'contact-1', body: 'Hello there', topicId: 'transactional' }),
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

  it('pipeline failure → 502', async () => {
    mockContactGet.mockResolvedValue(
      contactSnap({ orgId: ORG_ID, phone: '+27821234567' }),
    )
    mockSendSmsToContact.mockResolvedValue({ status: 'failed', reason: 'Invalid number', smsId: 'sms-failed' })
    const { POST } = await import('@/app/api/v1/crm/contacts/[id]/send-sms/route')
    const res = await POST(makeReq({ message: 'Hi' }), makeRouteCtx())
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toMatch(/Invalid number/i)
  })

  it('suppression/preference skip returns 200 skipped without sending directly', async () => {
    mockContactGet.mockResolvedValue(
      contactSnap({ orgId: ORG_ID, phone: '+27821234567' }),
    )
    mockSendSmsToContact.mockResolvedValue({ status: 'skipped', reason: 'sms-suppressed' })
    const { POST } = await import('@/app/api/v1/crm/contacts/[id]/send-sms/route')
    const res = await POST(makeReq({ message: 'Hi' }), makeRouteCtx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.sent).toBe(false)
    expect(body.data.status).toBe('skipped')
    expect(body.data.reason).toBe('sms-suppressed')
  })
})
