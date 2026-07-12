const update = jest.fn()
const appendEmailEvent = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((name: string) => {
      if (name === 'emails') {
        return {
          where: () => ({
            limit: () => ({
              get: async () => ({
                empty: false,
                docs: [{
                  id: 'email-doc-1',
                  ref: { id: 'email-doc-1', update },
                  data: () => ({ orgId: 'org-a', to: 'person@example.com', campaignId: 'campaign-1' }),
                }],
              }),
            }),
          }),
        }
      }
      return { doc: () => ({ update: jest.fn() }) }
    }),
  },
}))
jest.mock('@/lib/email-events/store', () => ({ appendEmailEvent: (...args: unknown[]) => appendEmailEvent(...args) }))
jest.mock('@/lib/consent-ledger/store', () => ({ appendConsentEvent: jest.fn() }))
jest.mock('@/lib/email/suppressions', () => ({ addSuppression: jest.fn(), temporaryExpiryFromNow: jest.fn() }))
jest.mock('@/lib/ab-testing/cronHelpers', () => ({ incrementVariantStat: jest.fn() }))

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/v1/email/webhook/ses/route'

describe('SES email event ledger integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.SES_SNS_TOPIC_ARN
  })

  it('uses the SNS message id as the immutable provider-event dedupe key', async () => {
    appendEmailEvent.mockResolvedValue({ id: 'evt-ses', created: false })
    const req = new NextRequest('http://localhost/api/v1/email/webhook/ses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        Type: 'Notification',
        MessageId: 'sns-event-1',
        Timestamp: '2026-07-12T12:00:00.000Z',
        Message: JSON.stringify({
          eventType: 'Delivery',
          mail: { messageId: 'ses-message-1', destination: ['person@example.com'] },
        }),
      }),
    })

    const response = await POST(req)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, replayed: true, eventId: 'evt-ses' })
    expect(appendEmailEvent).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-a',
      provider: 'ses',
      providerEventId: 'sns-event-1',
      providerMessageId: 'ses-message-1',
      event: 'delivered',
    }))
    expect(update).not.toHaveBeenCalled()
  })
})
