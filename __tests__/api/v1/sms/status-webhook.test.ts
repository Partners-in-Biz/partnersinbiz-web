import { NextRequest } from 'next/server'

const smsUpdate = jest.fn()
const broadcastUpdate = jest.fn()
const campaignUpdate = jest.fn()

function makeCollection(name: string) {
  if (name === 'sms') {
    return {
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({
        empty: false,
        docs: [
          {
            id: 'sms-1',
            ref: { update: smsUpdate },
            data: () => ({
              orgId: 'org-1',
              contactId: 'contact-1',
              broadcastId: 'broadcast-1',
              campaignId: 'campaign-1',
              to: '+27821234567',
              status: 'delivered',
            }),
          },
        ],
      }),
    }
  }
  if (name === 'broadcasts') return { doc: jest.fn(() => ({ update: broadcastUpdate })) }
  if (name === 'campaigns') return { doc: jest.fn(() => ({ update: campaignUpdate })) }
  if (name === 'contacts') return { doc: jest.fn(() => ({ update: jest.fn() })) }
  if (name === 'suppressions') return { doc: jest.fn(() => ({ get: jest.fn() })) }
  throw new Error(`Unexpected collection ${name}`)
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn(makeCollection) },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    increment: jest.fn((n: number) => ({ __increment: n })),
  },
  Timestamp: {
    fromDate: jest.fn((date: Date) => ({ date })),
  },
}))

describe('POST /api/v1/sms/status-webhook', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.TWILIO_AUTH_TOKEN
  })

  it('does not roll up duplicate terminal delivered callbacks', async () => {
    const { POST } = await import('@/app/api/v1/sms/status-webhook/route')
    const req = new NextRequest('http://localhost/api/v1/sms/status-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        MessageSid: 'SM123',
        MessageStatus: 'delivered',
        To: '+27821234567',
      }).toString(),
    })

    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(smsUpdate).not.toHaveBeenCalled()
    expect(broadcastUpdate).not.toHaveBeenCalled()
    expect(campaignUpdate).not.toHaveBeenCalled()
  })
})
