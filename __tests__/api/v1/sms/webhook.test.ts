import { NextRequest } from 'next/server'

const validateRequest = jest.fn()
const smsAdd = jest.fn()
const activityAdd = jest.fn()

function querySnapshot(docs: Array<{ id: string; data?: () => Record<string, unknown> }>) {
  return { empty: docs.length === 0, docs }
}

function queryChain(result: unknown) {
  return {
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue(result),
  }
}

jest.mock('twilio', () => ({
  validateRequest: (...args: unknown[]) => validateRequest(...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((name: string) => {
      if (name === 'organizations') {
        return {
          where: jest.fn(() => ({
            limit: jest.fn(() => ({
              get: jest.fn().mockResolvedValue(querySnapshot([{ id: 'org-1' }])),
            })),
          })),
          doc: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({
              exists: true,
              data: () => ({
                name: 'Partners in Biz',
                settings: { notificationEmail: 'ops@example.com' },
              }),
            }),
          })),
        }
      }
      if (name === 'contacts') {
        return queryChain(querySnapshot([{ id: 'contact-1' }]))
      }
      if (name === 'sms') {
        return {
          where: jest.fn(() => queryChain(querySnapshot([]))),
          add: smsAdd,
        }
      }
      if (name === 'activities') {
        return { add: activityAdd }
      }
      throw new Error(`Unexpected collection ${name}`)
    }),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

jest.mock('@/lib/email/suppressions', () => ({
  addSuppression: jest.fn(),
  removeSuppression: jest.fn(),
  isSuppressed: jest.fn(),
}))

jest.mock('@/lib/email/resend', () => ({
  getResendClient: jest.fn(),
}))

jest.mock('@/lib/email/resolveFrom', () => ({
  resolveFrom: jest.fn(),
}))

function makeReq(body: URLSearchParams, headers: Record<string, string> = {}) {
  return new NextRequest('https://partnersinbiz.online/api/v1/sms/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: body.toString(),
  })
}

const validInboundBody = new URLSearchParams({
  From: '+27821234567',
  To: '+27827654321',
  Body: 'HELP',
  MessageSid: 'SM123',
  NumSegments: '1',
})

describe('POST /api/v1/sms/webhook', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    process.env = { ...originalEnv }
    delete process.env.TWILIO_AUTH_TOKEN
    delete process.env.VERCEL_ENV
    smsAdd.mockResolvedValue({ id: 'sms-1' })
    activityAdd.mockResolvedValue(undefined)
    validateRequest.mockReturnValue(true)
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('rejects production webhooks when TWILIO_AUTH_TOKEN is missing', async () => {
    process.env.VERCEL_ENV = 'production'

    const { POST } = await import('@/app/api/v1/sms/webhook/route')
    const res = await POST(makeReq(validInboundBody))

    expect(res.status).toBe(403)
    expect(validateRequest).not.toHaveBeenCalled()
    expect(smsAdd).not.toHaveBeenCalled()
  })

  it('preserves valid signed public webhook behavior when TWILIO_AUTH_TOKEN is set', async () => {
    process.env.VERCEL_ENV = 'production'
    process.env.TWILIO_AUTH_TOKEN = 'twilio-token'

    const { POST } = await import('@/app/api/v1/sms/webhook/route')
    const res = await POST(makeReq(validInboundBody, { 'x-twilio-signature': 'valid-signature' }))

    expect(res.status).toBe(200)
    expect(validateRequest).toHaveBeenCalledWith(
      'twilio-token',
      'valid-signature',
      'https://partnersinbiz.online/api/v1/sms/webhook',
      expect.objectContaining({
        From: '+27821234567',
        To: '+27827654321',
        Body: 'HELP',
        MessageSid: 'SM123',
      }),
    )
    expect(smsAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      direction: 'inbound',
      contactId: 'contact-1',
      twilioSid: 'SM123',
      from: '+27821234567',
      to: '+27827654321',
      body: 'HELP',
      status: 'delivered',
    }))
  })
})
