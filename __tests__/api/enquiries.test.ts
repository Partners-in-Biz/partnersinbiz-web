import { NextRequest } from 'next/server'

const mockEnquiriesAdd = jest.fn()
const mockContactsAdd = jest.fn()
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
    mockEmailSend.mockResolvedValue({ id: 'email-id' })
    mockFireTrigger.mockResolvedValue(undefined)
    mockCollection.mockImplementation((name: string) => {
      if (name === 'enquiries') return { add: mockEnquiriesAdd }
      if (name === 'contacts') return { add: mockContactsAdd }
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
