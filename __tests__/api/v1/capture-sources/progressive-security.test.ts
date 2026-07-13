import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockContactAdd = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection, runTransaction: jest.fn() },
}))
jest.mock('@/lib/email/resend', () => ({ sendCampaignEmail: jest.fn(), htmlToPlainText: jest.fn() }))
jest.mock('@/lib/email/resolveFrom', () => ({ resolveFrom: jest.fn() }))
jest.mock('@/lib/lead-capture/token', () => ({ signConfirmToken: jest.fn(() => 'token') }))
jest.mock('@/lib/lead-capture/autoEnroll', () => ({ performAutoEnroll: jest.fn() }))
jest.mock('@/lib/lead-capture/disposable-domains', () => ({ isDisposableEmail: jest.fn(() => false) }))
jest.mock('@/lib/forms/turnstile', () => ({ verifyTurnstileToken: jest.fn() }))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'server-time'), increment: jest.fn((n) => n) },
  Timestamp: { fromMillis: jest.fn(), now: jest.fn() },
}))

describe('progressive capture schema enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const source = {
      id: 'source-1', orgId: 'org-1', name: 'Signup', type: 'form', active: true, deleted: false,
      fields: [
        { key: 'firstName', label: 'First name', type: 'text', required: false, progressiveStep: 1 },
        { key: 'company', label: 'Company', type: 'text', required: false, progressiveStep: 2 },
        { key: 'campaign', label: 'Campaign', type: 'hidden', required: false, attributionKey: 'campaignId' },
      ],
      display: {
        mode: 'multi-step',
        steps: [
          { headingText: '', subheadingText: '', buttonText: 'Next', fields: ['firstName'] },
          { headingText: '', subheadingText: '', buttonText: 'Done', fields: ['company'] },
        ],
      },
      rateLimit: { enabled: false }, blockDisposableEmails: false, honeypotEnabled: false,
    }
    mockCollection.mockImplementation((name: string) => {
      if (name === 'lead_capture_sources') return {
        doc: () => ({ get: jest.fn().mockResolvedValue({ exists: true, id: 'source-1', data: () => source }) }),
      }
      if (name === 'contacts') return { add: mockContactAdd }
      return { doc: jest.fn() }
    })
  })

  it('rejects future-step, hidden and unknown fields before creating a contact', async () => {
    const { POST } = await import('@/app/api/v1/capture-sources/[id]/progressive/route')
    const req = new NextRequest('http://localhost/api/v1/capture-sources/source-1/progressive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'person@example.com', step: 0,
        data: { company: 'Bypass', campaign: 'spoof', isAdmin: 'true' },
      }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'source-1' }) })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('not accepted on this step') })
    expect(mockContactAdd).not.toHaveBeenCalled()
  })
})
