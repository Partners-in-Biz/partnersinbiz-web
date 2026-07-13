// __tests__/api/v1/email/webhook.test.ts
const mockVerify = jest.fn()
const mockAppendEmailEvent = jest.fn()
const mockClaimEmailEventProjection = jest.fn()
const mockCompleteEmailEventProjection = jest.fn()
jest.mock('svix', () => ({
  Webhook: jest.fn().mockImplementation(() => ({ verify: mockVerify })),
}))
jest.mock('@/lib/email-events/store', () => ({
  appendEmailEvent: (...args: unknown[]) => mockAppendEmailEvent(...args),
  claimEmailEventProjection: (...args: unknown[]) => mockClaimEmailEventProjection(...args),
  completeEmailEventProjection: (...args: unknown[]) => mockCompleteEmailEventProjection(...args),
}))
jest.mock('@/lib/email-events/effects', () => ({
  applyFirestoreProjectionEffect: ({ targetRef, update }: {
    targetRef: { update: (value: unknown) => Promise<unknown> }
    update: unknown
  }) => targetRef.update(update),
  applyVariantProjectionEffect: jest.fn().mockResolvedValue(true),
}))

import { POST } from '@/app/api/v1/email/webhook/route'
import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifyIdToken: jest.fn(), verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

import { adminDb } from '@/lib/firebase/admin'

const mockDocUpdate = jest.fn().mockResolvedValue(undefined)
const mockContactUpdate = jest.fn().mockResolvedValue(undefined)
const mockCampaignUpdate = jest.fn().mockResolvedValue(undefined)
const mockQuery = {
  where: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  get: jest.fn(),
}

function mockEmail(
  id: string,
  extra: { orgId?: string; campaignId?: string; contactId?: string } = {},
) {
  mockQuery.get.mockResolvedValue({
    empty: false,
    docs: [
      {
        id,
        ref: { update: mockDocUpdate },
        data: () => ({ orgId: 'org-a', ...extra }),
      },
    ],
  })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'contacts') {
      return { doc: jest.fn().mockReturnValue({ update: mockContactUpdate }) }
    }
    if (name === 'campaigns') {
      return { doc: jest.fn().mockReturnValue({ update: mockCampaignUpdate }) }
    }
    return mockQuery
  })
}

function mockEmails(rows: Array<{ id: string; orgId?: string }>) {
  mockQuery.get.mockResolvedValue({
    empty: rows.length === 0,
    docs: rows.map(({ id, orgId }) => ({
      id,
      ref: { update: mockDocUpdate },
      data: () => ({ orgId }),
    })),
  })
  ;(adminDb.collection as jest.Mock).mockReturnValue(mockQuery)
}

function mockNoEmail() {
  mockQuery.get.mockResolvedValue({ empty: true, docs: [] })
  ;(adminDb.collection as jest.Mock).mockReturnValue(mockQuery)
}

function makeReq(payload: object, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/v1/email/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  })
}

describe('POST /api/v1/email/webhook', () => {
  const ORIGINAL_ENV = process.env.RESEND_WEBHOOK_SECRET
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.RESEND_WEBHOOK_SECRET
    mockAppendEmailEvent.mockResolvedValue({ id: 'event-1', created: true })
    mockClaimEmailEventProjection.mockResolvedValue('lease-1')
    mockCompleteEmailEventProjection.mockResolvedValue(true)
  })
  afterAll(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.RESEND_WEBHOOK_SECRET
    else process.env.RESEND_WEBHOOK_SECRET = ORIGINAL_ENV
  })

  it('returns 200 for unknown event type (no-op)', async () => {
    mockNoEmail()
    const res = await POST(makeReq({ type: 'email.sent', data: { email_id: 'r1' } }))
    expect(res.status).toBe(200)
  })

  it('returns 200 and skips update when resendId not found', async () => {
    mockNoEmail()
    const res = await POST(makeReq({ type: 'email.opened', data: { email_id: 'unknown' } }))
    expect(res.status).toBe(200)
    expect(mockDocUpdate).not.toHaveBeenCalled()
  })

  it('rejects an email row without tenant ownership', async () => {
    mockEmails([{ id: 'email-doc-1' }])
    const res = await POST(makeReq({ type: 'email.opened', data: { email_id: 'resend-1' } }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Provider event target is not tenant-safe' })
    expect(mockDocUpdate).not.toHaveBeenCalled()
  })

  it('rejects an ambiguous provider id across email rows', async () => {
    mockEmails([
      { id: 'email-doc-1', orgId: 'org-a' },
      { id: 'email-doc-2', orgId: 'org-b' },
    ])
    const res = await POST(makeReq({ type: 'email.opened', data: { email_id: 'resend-1' } }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Provider event target is not tenant-safe' })
    expect(mockDocUpdate).not.toHaveBeenCalled()
  })

  it('updates status to opened on email.opened', async () => {
    mockEmail('email-doc-1')
    const res = await POST(makeReq({ type: 'email.opened', data: { email_id: 'resend-1' } }))
    expect(res.status).toBe(200)
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'opened', openedAt: expect.anything() }),
    )
  })

  it('updates status to clicked on email.clicked', async () => {
    mockEmail('email-doc-1')
    const res = await POST(makeReq({ type: 'email.clicked', data: { email_id: 'resend-1' } }))
    expect(res.status).toBe(200)
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'clicked', clickedAt: expect.anything() }),
    )
  })

  it('keeps status as sent on email.delivered', async () => {
    mockEmail('email-doc-1')
    const res = await POST(makeReq({ type: 'email.delivered', data: { email_id: 'resend-1' } }))
    expect(res.status).toBe(200)
    // delivered does not change status — no update call needed
  })

  it('updates status to failed on email.bounced', async () => {
    mockEmail('email-doc-1')
    const res = await POST(makeReq({ type: 'email.bounced', data: { email_id: 'resend-1' } }))
    expect(res.status).toBe(200)
    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })

  it('updates status to failed on email.delivery_delayed', async () => {
    mockEmail('email-doc-1')
    const res = await POST(makeReq({ type: 'email.delivery_delayed', data: { email_id: 'resend-1' } }))
    expect(res.status).toBe(200)
    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })

  it('returns 400 on malformed payload', async () => {
    const req = new NextRequest('http://localhost/api/v1/email/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  describe('signature verification', () => {
    it('returns 400 when secret is set and verification throws', async () => {
      process.env.RESEND_WEBHOOK_SECRET = 'whsec_test'
      mockVerify.mockImplementationOnce(() => {
        throw new Error('bad signature')
      })
      const res = await POST(
        makeReq(
          { type: 'email.delivered', data: { email_id: 'r1' } },
          { 'svix-id': 'msg_1', 'svix-timestamp': '1', 'svix-signature': 'v1,sig' },
        ),
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body).toEqual({ error: 'Invalid signature' })
    })

    it('returns 200 when secret is set and verification succeeds', async () => {
      process.env.RESEND_WEBHOOK_SECRET = 'whsec_test'
      mockVerify.mockReturnValueOnce(undefined)
      mockEmail('email-doc-1', { campaignId: 'camp-1' })
      const res = await POST(
        makeReq(
          { type: 'email.delivered', data: { email_id: 'resend-1' } },
          { 'svix-id': 'msg_1', 'svix-timestamp': '1', 'svix-signature': 'v1,sig' },
        ),
      )
      expect(res.status).toBe(200)
      expect(mockVerify).toHaveBeenCalled()
    })

    it('returns 200 when secret is NOT set (logs warning, lets request through)', async () => {
      delete process.env.RESEND_WEBHOOK_SECRET
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
      mockEmail('email-doc-1')
      const res = await POST(makeReq({ type: 'email.opened', data: { email_id: 'resend-1' } }))
      expect(res.status).toBe(200)
      expect(mockVerify).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })

  describe('event handling stats', () => {
    beforeEach(() => {
      process.env.RESEND_WEBHOOK_SECRET = 'whsec_test'
      mockVerify.mockReturnValue(undefined)
    })

    it('bumps stats.delivered on email.delivered', async () => {
      mockEmail('email-doc-1', { campaignId: 'camp-1' })
      const res = await POST(
        makeReq(
          { type: 'email.delivered', data: { email_id: 'resend-1' } },
          { 'svix-id': 'm', 'svix-timestamp': '1', 'svix-signature': 's' },
        ),
      )
      expect(res.status).toBe(200)
      expect(mockCampaignUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ 'stats.delivered': expect.anything() }),
      )
    })

    it('flags contact and bumps stats.bounced on email.bounced', async () => {
      mockEmail('email-doc-1', { campaignId: 'camp-1', contactId: 'contact-1' })
      const res = await POST(
        makeReq(
          { type: 'email.bounced', data: { email_id: 'resend-1', bounce_type: 'permanent' } },
          { 'svix-id': 'm', 'svix-timestamp': '1', 'svix-signature': 's' },
        ),
      )
      expect(res.status).toBe(200)
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed', bouncedAt: expect.anything() }),
      )
      expect(mockContactUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ bouncedAt: expect.anything() }),
      )
      expect(mockCampaignUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ 'stats.bounced': expect.anything() }),
      )
    })
  })
})
