import { NextRequest } from 'next/server'
import { buildCaptureSchemaVersion } from '@/lib/lead-capture/schema'

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

  it('continues from the exact pinned fields and step layout after the source is edited', async () => {
    const pinnedFields = [
      { key: 'firstName', label: 'First name', type: 'text' as const, required: false, progressiveStep: 1 },
      { key: 'company', label: 'Company', type: 'text' as const, required: true, progressiveStep: 2 },
      { key: 'phone', label: 'Phone', type: 'tel' as const, required: false, progressiveStep: 3 },
    ]
    const pinnedDisplay = {
      mode: 'multi-step' as const,
      steps: [
        { headingText: '', subheadingText: '', buttonText: 'Next', fields: ['firstName'] },
        { headingText: '', subheadingText: '', buttonText: 'Next', fields: ['company'] },
        { headingText: '', subheadingText: '', buttonText: 'Done', fields: ['phone'] },
      ],
    }
    const version = buildCaptureSchemaVersion({ orgId: 'org-1', sourceId: 'source-1', fields: pinnedFields, display: pinnedDisplay })
    const currentSource = {
      id: 'source-1', orgId: 'org-1', name: 'Edited signup', type: 'form', active: true, deleted: false,
      fields: [
        { key: 'firstName', label: 'First name', type: 'text', required: false },
        { key: 'jobTitle', label: 'Job title', type: 'text', required: true },
      ],
      display: { ...pinnedDisplay, steps: [pinnedDisplay.steps[0], { ...pinnedDisplay.steps[1], fields: ['jobTitle'] }, pinnedDisplay.steps[2]] },
      rateLimit: { enabled: false }, blockDisposableEmails: false, honeypotEnabled: false,
    }
    const subUpdate = jest.fn().mockResolvedValue(undefined)
    const existing = {
      orgId: 'org-1', captureSourceId: 'source-1', email: 'person@example.com',
      contactId: 'contact-1', data: { firstName: 'Ari' }, completedSteps: false,
      schemaVersionId: version.id, attribution: {},
    }
    mockCollection.mockImplementation((name: string) => {
      if (name === 'lead_capture_sources') return { doc: () => ({ get: jest.fn().mockResolvedValue({ exists: true, id: 'source-1', data: () => currentSource }) }) }
      if (name === 'lead_capture_submissions') return { doc: () => ({ get: jest.fn().mockResolvedValue({ exists: true, data: () => existing }), update: subUpdate }) }
      if (name === 'lead_capture_schema_versions') return { doc: () => ({ get: jest.fn().mockResolvedValue({ exists: true, data: () => version }) }) }
      if (name === 'contacts') return { doc: () => ({ get: jest.fn().mockResolvedValue({ exists: false }) }) }
      return { doc: jest.fn() }
    })

    const { POST } = await import('@/app/api/v1/capture-sources/[id]/progressive/route')
    const req = new NextRequest('http://localhost/api/v1/capture-sources/source-1/progressive', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'person@example.com', submissionId: 'sub-1', step: 1, data: { company: 'Pinned Co' } }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'source-1' }) })
    expect(res.status).toBe(200)
    expect(subUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { firstName: 'Ari', company: 'Pinned Co' }, currentStep: 1,
    }))
  })
})
