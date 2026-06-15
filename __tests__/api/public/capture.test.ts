// __tests__/api/public/capture.test.ts
import { NextRequest } from 'next/server'

const mockGet = jest.fn()
const mockAdd = jest.fn()
const mockUpdate = jest.fn()
const mockDoc = jest.fn()
const mockWhere = jest.fn()
const mockLimit = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection, runTransaction: jest.fn() },
}))

jest.mock('@/lib/forms/ratelimit', () => ({
  checkFormRateLimit: jest.fn().mockResolvedValue(true),
}))

import { POST } from '@/app/api/public/capture/[publicKey]/route'
import { checkFormRateLimit } from '@/lib/forms/ratelimit'

const docRef = { update: mockUpdate, get: mockGet, ref: { update: mockUpdate } }

beforeEach(() => {
  jest.clearAllMocks()

  const query = { where: mockWhere, get: mockGet, limit: mockLimit, add: mockAdd, doc: mockDoc }
  mockWhere.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
  mockDoc.mockReturnValue(docRef)
  mockCollection.mockImplementation(() => ({
    where: mockWhere,
    limit: mockLimit,
    get: mockGet,
    add: mockAdd,
    doc: mockDoc,
  }))
  ;(checkFormRateLimit as jest.Mock).mockResolvedValue(true)
})

function makeReq(body: unknown, ip = '1.2.3.4') {
  return new NextRequest('http://localhost/api/public/capture/key123', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ publicKey: 'key123' }) }

const enabledSource = {
  id: 'src-1',
  publicKey: 'key123',
  orgId: 'org-1',
  name: 'Website signup',
  type: 'form',
  enabled: true,
  deleted: false,
  autoTags: ['leads'],
  autoCampaignIds: [],
  autoSequenceIds: [],
  consentRequired: false,
  redirectUrl: '',
}

function mockSourceLookup(source: typeof enabledSource | null) {
  if (!source) {
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] })
  } else {
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: source.id, data: () => source, ref: { update: mockUpdate } }],
    })
  }
}

function mockExistingContactLookup(existing: { id: string; tags?: string[] } | null) {
  if (!existing) {
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] })
  } else {
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: existing.id, data: () => existing, ref: { update: mockUpdate } }],
    })
  }
}

describe('POST /api/public/capture/[publicKey]', () => {
  it('returns 401 when publicKey is unknown', async () => {
    mockSourceLookup(null)
    const res = await POST(makeReq({ email: 'x@y.com' }), params)
    expect(res.status).toBe(401)
  })

  it('returns 403 when source is disabled', async () => {
    mockSourceLookup({ ...enabledSource, enabled: false })
    const res = await POST(makeReq({ email: 'x@y.com' }), params)
    expect(res.status).toBe(403)
  })

  it('returns 403 when source is soft-deleted', async () => {
    mockSourceLookup({ ...enabledSource, deleted: true })
    const res = await POST(makeReq({ email: 'x@y.com' }), params)
    expect(res.status).toBe(403)
  })

  it('returns 429 when rate limit exceeded', async () => {
    mockSourceLookup(enabledSource)
    ;(checkFormRateLimit as jest.Mock).mockResolvedValueOnce(false)
    const res = await POST(makeReq({ email: 'x@y.com' }), params)
    expect(res.status).toBe(429)
  })

  it('returns 400 when email is missing', async () => {
    mockSourceLookup(enabledSource)
    const res = await POST(makeReq({}), params)
    expect(res.status).toBe(400)
  })

  it('returns 400 when email is malformed', async () => {
    mockSourceLookup(enabledSource)
    const res = await POST(makeReq({ email: 'not-an-email' }), params)
    expect(res.status).toBe(400)
  })

  it('returns 422 when consent required and not given', async () => {
    mockSourceLookup({ ...enabledSource, consentRequired: true })
    const res = await POST(makeReq({ email: 'x@y.com', consent: false }), params)
    expect(res.status).toBe(422)
  })

  it('silently 200s when honeypot is filled', async () => {
    mockSourceLookup(enabledSource)
    const res = await POST(makeReq({ email: 'bot@x.com', _hp: 'spam' }), params)
    expect(res.status).toBe(200)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('creates a new contact with merged autoTags + body tags', async () => {
    mockSourceLookup(enabledSource)
    mockExistingContactLookup(null)
    mockAdd.mockResolvedValueOnce({ id: 'contact-new' })

    const res = await POST(makeReq({ email: 'jane@x.com', name: 'Jane Doe', tags: ['promo'], consent: true }), params)
    expect(res.status).toBe(201)

    // Tags should merge (de-duped)
    const addCall = mockAdd.mock.calls.find((c) => c[0]?.email === 'jane@x.com')
    expect(addCall).toBeDefined()
    expect(addCall![0]).toEqual(
      expect.objectContaining({
        orgId: 'org-1',
        capturedFromId: 'src-1',
        email: 'jane@x.com',
        name: 'Jane Doe',
        source: 'form',
        type: 'lead',
        stage: 'new',
        tags: expect.arrayContaining(['leads', 'promo']),
        marketingConsent: true,
        consentAt: expect.anything(),
        consentMetadata: expect.objectContaining({
          consentGiven: true,
          consentSourceId: 'src-1',
          consentCapturedVia: 'public-capture-form',
          consentIp: '1.2.3.4',
        }),
      })
    )
  })

  it('reuses an existing contact and merges tags', async () => {
    mockSourceLookup(enabledSource)
    mockExistingContactLookup({ id: 'contact-existing', tags: ['existing'] })

    const res = await POST(makeReq({ email: 'jane@x.com', tags: ['new-tag'], consent: true }), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.deduped).toBe(true)
    expect(body.data.contactId).toBe('contact-existing')

    // Existing contact's tags merged with new
    const updateCall = mockUpdate.mock.calls.find((c) => c[0]?.tags)
    expect(updateCall).toBeDefined()
    expect(updateCall![0].tags).toEqual(expect.arrayContaining(['existing', 'leads', 'new-tag']))
    expect(updateCall![0]).toEqual(expect.objectContaining({
      marketingConsent: true,
      consentAt: expect.anything(),
      consentMetadata: expect.objectContaining({ consentGiven: true, consentSourceId: 'src-1' }),
    }))
  })

  it('does not log an activity for deduped existing contacts', async () => {
    mockSourceLookup(enabledSource)
    mockExistingContactLookup({ id: 'contact-existing' })

    await POST(makeReq({ email: 'jane@x.com' }), params)

    // The first add() above is the contact creation (which we didn't do because dedupe).
    // No activity should be added either — only the source counter bump update.
    const activityAdd = mockAdd.mock.calls.find(
      (c) => c[0]?.type === 'note' && c[0]?.summary?.includes('Captured via')
    )
    expect(activityAdd).toBeUndefined()
  })

  it('logs a contact_captured activity for new contacts', async () => {
    mockSourceLookup(enabledSource)
    mockExistingContactLookup(null)
    mockAdd.mockResolvedValueOnce({ id: 'contact-new' })

    await POST(makeReq({ email: 'jane@x.com' }), params)

    const activityAdd = mockAdd.mock.calls.find(
      (c) => c[0]?.type === 'note' && c[0]?.summary?.includes('Captured via')
    )
    expect(activityAdd).toBeDefined()
    expect(activityAdd![0]).toEqual(
      expect.objectContaining({
        orgId: 'org-1',
        contactId: 'contact-new',
        metadata: expect.objectContaining({ sourceId: 'src-1', sourceType: 'form' }),
      })
    )
  })

  it('auto-enrolls captured contacts into active direct sequences', async () => {
    mockSourceLookup({ ...enabledSource, autoSequenceIds: ['seq-1'] })
    mockExistingContactLookup(null)
    mockAdd.mockResolvedValueOnce({ id: 'contact-new' })
    mockGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          orgId: 'org-1',
          status: 'active',
          name: 'Lead nurture',
          steps: [{ delayDays: 0, subject: 'Welcome', bodyText: 'Hi' }],
          deleted: false,
        }),
      })
      .mockResolvedValueOnce({ empty: true, docs: [] })

    const res = await POST(makeReq({ email: 'jane@x.com' }), params)

    expect(res.status).toBe(201)
    const enrollmentAdd = mockAdd.mock.calls.find((c) => c[0]?.sequenceId === 'seq-1')
    expect(enrollmentAdd).toBeDefined()
    expect(enrollmentAdd![0]).toEqual(expect.objectContaining({
      orgId: 'org-1',
      campaignId: '',
      sequenceId: 'seq-1',
      contactId: 'contact-new',
      status: 'active',
      currentStep: 0,
      deleted: false,
    }))
  })
})
