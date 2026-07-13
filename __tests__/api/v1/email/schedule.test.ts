// __tests__/api/v1/email/schedule.test.ts
import { POST as SCHEDULE } from '@/app/api/v1/email/schedule/route'
import { PUT, DELETE } from '@/app/api/v1/email/[id]/route'
import { GET as CRON } from '@/app/api/cron/emails/route'
import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifyIdToken: jest.fn(), verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

jest.mock('@/lib/email/resend', () => ({
  getResendClient: jest.fn(() => ({
    emails: {
      send: jest.fn().mockResolvedValue({ data: { id: 'resend-sched-1' }, error: null }),
    },
  })),
  sendCampaignEmail: jest.fn().mockResolvedValue({ ok: true, resendId: 'resend-sched-1' }),
  FROM_ADDRESS: 'peet@partnersinbiz.online',
  plainTextToHtml: jest.fn((t: string) => `<p>${t}</p>`),
  htmlToPlainText: jest.fn((h: string) => h),
}))

// Canonical consent enforcement has its own focused send-gate suite. These
// scheduling tests exercise queue lifecycle behaviour with consent allowed.
jest.mock('@/lib/consent-ledger/decision', () => ({
  resolveCanonicalEmailConsent: jest.fn().mockResolvedValue({
    allowed: true,
    precedence: 'default-allow',
  }),
}))

import { adminDb } from '@/lib/firebase/admin'
process.env.AI_API_KEY = 'test-key'
process.env.CRON_SECRET = 'cron-secret'

const mockAdd = jest.fn().mockResolvedValue({ id: 'sched-email-1' })
const mockDocRef = {
  get: jest.fn(),
  update: jest.fn().mockResolvedValue(undefined),
}

function mockDb(existingDoc?: object) {
  mockDocRef.get.mockResolvedValue({
    exists: !!existingDoc,
    id: 'sched-email-1',
    data: () => existingDoc ?? {},
  })
  ;(adminDb.collection as jest.Mock).mockImplementation((col: string) => {
    if (col === 'emails') {
      return {
        add: mockAdd,
        doc: jest.fn().mockReturnValue(mockDocRef),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          docs: existingDoc
            ? [{ id: 'sched-email-1', data: () => existingDoc }]
            : [],
        }),
      }
    }
    if (col === 'activities') {
      return { add: jest.fn().mockResolvedValue({ id: 'act-1' }) }
    }
    return {}
  })
}

function makeReq(method: string, body?: object, url = 'http://localhost/api/v1/email/schedule') {
  return new NextRequest(url, {
    method,
    headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

// ── Schedule ──────────────────────────────────────────────────────────────────

describe('POST /api/v1/email/schedule', () => {
  beforeEach(() => { jest.clearAllMocks(); mockDb() })

  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost/api/v1/email/schedule', { method: 'POST' })
    const res = await SCHEDULE(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when scheduledFor is missing', async () => {
    const res = await SCHEDULE(makeReq('POST', { to: 'a@b.com', subject: 'Hi', bodyText: 'hi' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when to is missing', async () => {
    const res = await SCHEDULE(makeReq('POST', { subject: 'Hi', bodyText: 'hi', scheduledFor: '2099-01-01T00:00:00Z' }))
    expect(res.status).toBe(400)
  })

  it('creates a scheduled email doc and returns 201', async () => {
    const res = await SCHEDULE(makeReq('POST', {
      orgId: 'org-test',
      to: 'client@example.com',
      subject: 'Future email',
      bodyText: 'See you later.',
      scheduledFor: '2099-01-01T00:00:00Z',
    }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.id).toBe('sched-email-1')
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ status: 'scheduled' }))
  })

  it('does NOT call Resend on schedule', async () => {
    const { getResendClient } = require('@/lib/email/resend')
    await SCHEDULE(makeReq('POST', {
      orgId: 'org-test',
      to: 'a@b.com', subject: 'Hi', bodyText: 'body',
      scheduledFor: '2099-01-01T00:00:00Z',
    }))
    expect(getResendClient).not.toHaveBeenCalled()
  })
})

// ── Update + Delete ───────────────────────────────────────────────────────────

describe('PUT /api/v1/email/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDb({ orgId: 'org-test', status: 'draft', subject: 'Old subject', deleted: false })
  })

  it('returns 404 when email does not exist', async () => {
    mockDocRef.get.mockResolvedValueOnce({ exists: false })
    const res = await PUT(
      makeReq('PUT', { subject: 'New subject' }, 'http://localhost/api/v1/email/sched-email-1'),
      { params: Promise.resolve({ id: 'sched-email-1' }) },
    )
    expect(res.status).toBe(404)
  })

  it('updates the email and returns 200', async () => {
    const res = await PUT(
      makeReq('PUT', { subject: 'New subject' }, 'http://localhost/api/v1/email/sched-email-1'),
      { params: Promise.resolve({ id: 'sched-email-1' }) },
    )
    expect(res.status).toBe(200)
    expect(mockDocRef.update).toHaveBeenCalledWith(expect.objectContaining({ subject: 'New subject' }))
  })
})

describe('DELETE /api/v1/email/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDb({ orgId: 'org-test', status: 'draft', deleted: false })
  })

  it('soft-deletes and returns 200', async () => {
    const res = await DELETE(
      makeReq('DELETE', undefined, 'http://localhost/api/v1/email/sched-email-1'),
      { params: Promise.resolve({ id: 'sched-email-1' }) },
    )
    expect(res.status).toBe(200)
    expect(mockDocRef.update).toHaveBeenCalledWith(expect.objectContaining({ deleted: true }))
  })
})

// ── Cron ──────────────────────────────────────────────────────────────────────

describe('GET /api/cron/emails', () => {
  it('returns 401 without CRON_SECRET', async () => {
    const req = new NextRequest('http://localhost/api/cron/emails', {
      headers: { authorization: 'Bearer wrong-secret' },
    })
    const res = await CRON(req)
    expect(res.status).toBe(401)
  })

  it('processes due scheduled emails and returns processed count', async () => {
    const scheduledEmail = {
      id: 'sched-email-1',
      to: 'client@example.com',
      from: 'peet@partnersinbiz.online',
      cc: [],
      subject: 'Scheduled hello',
      bodyHtml: '<p>Hi</p>',
      bodyText: 'Hi',
      status: 'scheduled',
      contactId: '',
      sequenceId: '',
    }
    ;(adminDb.collection as jest.Mock).mockImplementation((col: string) => {
      if (col === 'emails') {
        return {
          where: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({
            docs: [{ id: 'sched-email-1', data: () => scheduledEmail }],
          }),
          doc: jest.fn().mockReturnValue({ update: mockDocRef.update }),
        }
      }
      if (col === 'activities') {
        return { add: jest.fn().mockResolvedValue({}) }
      }
      return {}
    })

    const req = new NextRequest('http://localhost/api/cron/emails', {
      headers: { authorization: 'Bearer cron-secret' },
    })
    const res = await CRON(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.processed).toBe(1)
  })
})
