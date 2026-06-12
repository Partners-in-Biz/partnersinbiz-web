import { NextRequest } from 'next/server'

const mockEnquiriesAdd = jest.fn()
const mockContactsAdd = jest.fn()
const mockContactsGet = jest.fn()
const mockCollection = jest.fn()
const mockEmailSend = jest.fn()
const mockFireTrigger = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
  },
}))

jest.mock('@/lib/email/resend', () => ({
  FROM_ADDRESS: 'Partners in Biz <hello@partnersinbiz.online>',
  getResendClient: jest.fn(() => ({
    emails: { send: mockEmailSend },
  })),
}))

jest.mock('@/lib/automations/trigger', () => ({
  fireTrigger: mockFireTrigger,
}))

import { POST } from '@/app/api/enquiries/route'

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/enquiries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = {
  name: 'Test User',
  email: 'test@example.com',
  company: 'Test Company',
  phone: '067 000 0000',
  website: 'https://example.com',
  projectType: 'web',
  details: 'Build me a site',
}

describe('POST /api/enquiries', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEnquiriesAdd.mockResolvedValue({ id: 'test-enquiry-id' })
    mockContactsAdd.mockResolvedValue({ id: 'test-contact-id' })
    mockContactsGet.mockResolvedValue({ empty: true, docs: [] })
    mockEmailSend.mockResolvedValue({ id: 'email-id' })
    mockFireTrigger.mockResolvedValue(undefined)
    mockCollection.mockImplementation((name: string) => {
      if (name === 'enquiries') return { add: mockEnquiriesAdd }
      if (name === 'contacts') {
        const query = { where: jest.fn(), limit: jest.fn(), get: mockContactsGet }
        query.where.mockReturnValue(query)
        query.limit.mockReturnValue(query)
        return { add: mockContactsAdd, where: query.where }
      }
      return { add: jest.fn() }
    })
  })

  it('returns 400 when name is missing', async () => {
    const req = makeRequest({ ...validBody, name: '' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/name/i)
  })

  it('returns 400 when email is missing', async () => {
    const req = makeRequest({ ...validBody, email: '' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/email/i)
  })

  it('returns 400 when email is invalid', async () => {
    const req = makeRequest({ ...validBody, email: 'not-an-email' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/email/i)
  })

  it('returns 400 when details is missing', async () => {
    const req = makeRequest({ ...validBody, details: '' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/details/i)
  })

  it('returns 400 when projectType is invalid', async () => {
    const req = makeRequest({ ...validBody, projectType: 'invalid-type' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/project type/i)
  })

  it('returns 201 on valid submission', async () => {
    const req = makeRequest(validBody)
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe('test-enquiry-id')
  })

  it('creates a PIB platform CRM lead and fires contact-created automations', async () => {
    const req = makeRequest(validBody)

    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(mockEnquiriesAdd).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Test User',
      email: 'test@example.com',
      company: 'Test Company',
      phone: '067 000 0000',
      website: 'https://example.com',
      projectType: 'web',
      interest: null,
      status: 'new',
    }))
    expect(mockContactsAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'pib-platform-owner',
      name: 'Test User',
      email: 'test@example.com',
      company: 'Test Company',
      phone: '067 000 0000',
      website: 'https://example.com',
      source: 'form',
      type: 'lead',
      stage: 'new',
      tags: ['enquiry'],
      notes: 'Enquiry ID: test-enquiry-id',
      deleted: false,
    }))
    expect(mockFireTrigger).toHaveBeenCalledWith('contact.created', {
      orgId: 'pib-platform-owner',
      contactId: 'test-contact-id',
      contactEmail: 'test@example.com',
    })
  })

  it('stores structured partner-opportunity interest data for follow-up', async () => {
    const req = makeRequest({
      ...validBody,
      projectType: 'partnership',
      details: 'Opportunity: Athleet club growth partner (athleet-club-growth)',
      interest: {
        type: 'partner-opportunity',
        opportunityId: 'athleet-club-growth',
        opportunityTitle: 'Athleet club growth partner',
        notes: 'I can introduce ten wrestling clubs.',
        consent: true,
        source: '/partner-with-us/athleet-club-growth',
        links: 'https://example.com/club-profile',
        accessHandoff: 'secure_handoff_needed',
      },
    })

    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(mockEnquiriesAdd).toHaveBeenCalledWith(expect.objectContaining({
      projectType: 'partnership',
      interest: expect.objectContaining({
        type: 'partner-opportunity',
        opportunityId: 'athleet-club-growth',
        opportunityTitle: 'Athleet — club growth partner',
        consent: true,
        source: '/partner-with-us/athleet-club-growth',
        accessHandoff: 'secure_handoff_needed',
      }),
    }))
    expect(mockContactsAdd).toHaveBeenCalledWith(expect.objectContaining({
      tags: ['enquiry', 'partner-opportunity', 'opportunity:athleet-club-growth'],
      notes: expect.stringContaining('Opportunity: Athleet — club growth partner (athleet-club-growth)'),
    }))
  })

  it('stores the requested area for area-claim opportunities and tags the contact with it', async () => {
    const req = makeRequest({
      ...validBody,
      projectType: 'partnership',
      details: 'Opportunity: Local coupon platform — own your area (local-area-coupon-partner)',
      interest: {
        type: 'partner-opportunity',
        opportunityId: 'local-area-coupon-partner',
        opportunityTitle: 'Local coupon platform — own your area',
        notes: 'I run the community Facebook group for the area.',
        consent: true,
        source: '/partner-with-us/local-area-coupon-partner',
        requestedArea: 'Hartbeespoort & Schoemansville',
      },
    })

    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(mockEnquiriesAdd).toHaveBeenCalledWith(expect.objectContaining({
      interest: expect.objectContaining({
        opportunityId: 'local-area-coupon-partner',
        requestedArea: 'Hartbeespoort & Schoemansville',
      }),
    }))
    expect(mockContactsAdd).toHaveBeenCalledWith(expect.objectContaining({
      tags: [
        'enquiry',
        'partner-opportunity',
        'opportunity:local-area-coupon-partner',
        'area:hartbeespoort-schoemansville',
      ],
      notes: expect.stringContaining('Requested area: Hartbeespoort & Schoemansville'),
    }))
  })

  it('rejects an area-claim opportunity submission without a requested area', async () => {
    const req = makeRequest({
      ...validBody,
      projectType: 'partnership',
      details: 'Opportunity: Local coupon platform — own your area (local-area-coupon-partner)',
      interest: {
        type: 'partner-opportunity',
        opportunityId: 'local-area-coupon-partner',
        opportunityTitle: 'Local coupon platform — own your area',
        notes: 'Interested.',
        consent: true,
        source: '/partner-with-us/local-area-coupon-partner',
      },
    })

    const res = await POST(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/area/i)
  })

  it('reuses an existing CRM contact instead of duplicating on repeat submission', async () => {
    const mockUpdate = jest.fn().mockResolvedValue(undefined)
    mockContactsGet.mockResolvedValue({
      empty: false,
      docs: [{
        id: 'existing-contact-id',
        data: () => ({
          tags: ['enquiry', 'newsletter'],
          notes: 'Original note',
          name: 'Existing Name',
          phone: '',
          company: '',
          website: '',
        }),
        ref: { update: mockUpdate },
      }],
    })

    const req = makeRequest({
      ...validBody,
      projectType: 'partnership',
      details: 'Opportunity: Athleet club growth partner (athleet-club-growth)',
      interest: {
        type: 'partner-opportunity',
        opportunityId: 'athleet-club-growth',
        opportunityTitle: 'Athleet club growth partner',
        notes: 'Second submission.',
        consent: true,
        source: '/partner-with-us/athleet-club-growth',
      },
    })

    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(mockContactsAdd).not.toHaveBeenCalled()
    expect(mockFireTrigger).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      tags: expect.arrayContaining(['enquiry', 'newsletter', 'partner-opportunity', 'opportunity:athleet-club-growth']),
      notes: expect.stringContaining('Original note'),
      name: 'Existing Name',
      phone: '067 000 0000',
    }))
    expect(mockUpdate.mock.calls[0][0].notes).toContain('Opportunity: Athleet — club growth partner (athleet-club-growth)')
  })

  it('rejects partner-opportunity interest without consent', async () => {
    const req = makeRequest({
      ...validBody,
      projectType: 'partnership',
      details: 'Opportunity: Athleet club growth partner (athleet-club-growth)',
      interest: {
        type: 'partner-opportunity',
        opportunityId: 'athleet-club-growth',
        opportunityTitle: 'Athleet club growth partner',
        consent: false,
        source: '/partner-with-us/athleet-club-growth',
      },
    })

    const res = await POST(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/consent/i)
  })

  it('sends both admin notification and submitter acknowledgement emails', async () => {
    const req = makeRequest(validBody)

    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(mockEmailSend).toHaveBeenCalledTimes(2)
    expect(mockEmailSend).toHaveBeenNthCalledWith(1, expect.objectContaining({
      to: 'peet.stander@partnersinbiz.online',
      subject: 'New Project Inquiry from Test User',
    }))
    expect(mockEmailSend).toHaveBeenNthCalledWith(2, expect.objectContaining({
      to: 'test@example.com',
      subject: 'We received your Partners in Biz request',
    }))
  })
})
