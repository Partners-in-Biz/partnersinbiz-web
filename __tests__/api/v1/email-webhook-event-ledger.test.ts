const update = jest.fn()
const campaignUpdate = jest.fn()
const appendEmailEvent = jest.fn()
const claimEmailEventProjection = jest.fn()
const appendConsentEvent = jest.fn()

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
                  data: () => ({
                    orgId: 'org-a',
                    to: 'person@example.com',
                    campaignId: 'campaign-1',
                    contactId: 'contact-1',
                  }),
                }],
              }),
            }),
          }),
        }
      }
      return { doc: () => ({ update: campaignUpdate }) }
    }),
  },
}))
jest.mock('@/lib/email-events/store', () => ({ appendEmailEvent: (...args: unknown[]) => appendEmailEvent(...args), claimEmailEventProjection: (...args: unknown[]) => claimEmailEventProjection(...args) }))
jest.mock('@/lib/consent-ledger/store', () => ({ appendConsentEvent: (...args: unknown[]) => appendConsentEvent(...args) }))
jest.mock('@/lib/email/suppressions', () => ({
  addSuppression: jest.fn(),
  temporaryExpiryFromNow: jest.fn(),
}))
jest.mock('@/lib/email/bounceTracking', () => ({
  recordSoftBounce: jest.fn(),
  SOFT_BOUNCE_ESCALATION_THRESHOLD: 3,
}))
jest.mock('@/lib/ab-testing/cronHelpers', () => ({ incrementVariantStat: jest.fn() }))

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/v1/email/webhook/route'

describe('Resend email event ledger integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.RESEND_WEBHOOK_SECRET
    delete process.env.RESEND_WEBHOOK_REQUIRE_SIGNATURE
    delete process.env.VERCEL_ENV
    claimEmailEventProjection.mockResolvedValue(true)
  })

  it('returns replay success without mutating projections for a duplicate provider event', async () => {
    appendEmailEvent.mockResolvedValue({
      id: 'evt-existing',
      deduplicationKey: 'org-a:resend:event:svix-1',
      uniqueEventKey: 'org-a:email-doc-1:delivered:*',
      created: false,
    })
    claimEmailEventProjection.mockResolvedValue(false)

    const req = new NextRequest('http://localhost/api/v1/email/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'svix-id': 'svix-1' },
      body: JSON.stringify({ type: 'email.delivered', data: { email_id: 'provider-1' } }),
    })
    const response = await POST(req)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, replayed: true, eventId: 'evt-existing' })
    expect(appendEmailEvent).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-a',
      messageId: 'email-doc-1',
      providerEventId: 'svix-1',
      event: 'delivered',
    }))
    expect(update).not.toHaveBeenCalled()
    expect(campaignUpdate).not.toHaveBeenCalled()
  })

  it('repairs projections on replay when append succeeded but projection never claimed', async () => {
    appendEmailEvent.mockResolvedValue({ id: 'evt-repair', created: false })
    claimEmailEventProjection.mockResolvedValue(true)
    const response = await POST(new NextRequest('http://localhost/api/v1/email/webhook', {
      method: 'POST', headers: { 'content-type': 'application/json', 'svix-id': 'svix-repair' },
      body: JSON.stringify({ type: 'email.opened', data: { email_id: 'provider-1' } }),
    }))
    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'opened' }))
  })

  it('records complaint consent proof before applying complaint projections', async () => {
    appendEmailEvent.mockResolvedValue({ id: 'evt-new', created: true })
    appendConsentEvent.mockResolvedValue({ id: 'consent-new', created: true })

    const req = new NextRequest('http://localhost/api/v1/email/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'svix-id': 'svix-complaint' },
      body: JSON.stringify({
        type: 'email.complained',
        data: { email_id: 'provider-1', created_at: '2026-07-12T12:00:00.000Z' },
      }),
    })
    const response = await POST(req)

    expect(response.status).toBe(200)
    expect(appendConsentEvent).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-a',
      contactId: 'contact-1',
      state: 'revoked',
      topicId: '*',
      sourceEventId: 'evt-new',
    }))
  })
})
