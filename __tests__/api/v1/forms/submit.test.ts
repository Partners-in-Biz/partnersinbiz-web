/**
 * Tests for POST /api/v1/forms/[id]/submit — PUBLIC route, no auth.
 *
 * Verifies:
 *  - formSubmissionRef attribution on FormSubmission write
 *  - formSubmissionRef attribution on new Contact insert
 *  - Existing contact createdByRef is NOT overwritten
 *  - Activity written for the contact (new behaviour)
 *  - Honeypot short-circuits without writes
 *  - Form not found / deleted / inactive → 404
 *  - Turnstile required but token missing → 400
 *  - Webhook dispatched on valid submission
 */
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mock infrastructure — set up BEFORE importing the route
// ---------------------------------------------------------------------------

const mockFormSubmissionsAdd = jest.fn()
const mockFormSubmissionsUpdate = jest.fn()
const mockContactsAdd = jest.fn()
const mockContactsGet = jest.fn()
const mockActivitiesAdd = jest.fn()
const mockFormsGet = jest.fn()
const mockCollection = jest.fn()
const mockRunTransaction = jest.fn()
const mockWhere = jest.fn()
const mockLimit = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection, runTransaction: mockRunTransaction },
}))

jest.mock('@/lib/forms/ratelimit', () => ({
  checkFormRateLimit: jest.fn().mockResolvedValue(true),
}))

jest.mock('@/lib/forms/turnstile', () => ({
  verifyTurnstileToken: jest.fn().mockResolvedValue({ success: true }),
}))

jest.mock('@/lib/email/resend', () => ({
  getResendClient: jest.fn().mockReturnValue({
    emails: { send: jest.fn().mockResolvedValue({}) },
  }),
  FROM_ADDRESS: 'noreply@partnersinbiz.online',
}))

const mockDispatchWebhook = jest.fn().mockResolvedValue(undefined)
jest.mock('@/lib/webhooks/dispatch', () => ({
  dispatchWebhook: (...args: unknown[]) => mockDispatchWebhook(...args),
}))

// firebase-admin/firestore FieldValue shim
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => '__serverTimestamp__',
  },
}))

import { checkFormRateLimit } from '@/lib/forms/ratelimit'
import { verifyTurnstileToken } from '@/lib/forms/turnstile'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Form snapshot */
function makeForm(overrides: Record<string, unknown> = {}) {
  return {
    id: 'form-abc',
    orgId: 'org-1',
    name: 'Contact Us',
    slug: 'contact-us',
    active: true,
    deleted: false,
    createContact: true,
    turnstileEnabled: false,
    rateLimitPerMinute: 10,
    notifyEmails: [],
    thankYouMessage: 'Thanks!',
    redirectUrl: '',
    fields: [
      { id: 'email', label: 'Email', type: 'email', required: true },
      { id: 'name', label: 'Name', type: 'text', required: false },
    ],
    ...overrides,
  }
}

/** Public submit request — no auth headers */
function submitReq(slug: string, orgId: string, body: Record<string, unknown>) {
  return new NextRequest(
    `http://localhost/api/v1/forms/${slug}/submit?orgId=${orgId}`,
    {
      method: 'POST',
      headers: new Headers({
        'content-type': 'application/json',
        'x-forwarded-for': '127.0.0.1',
      }),
      body: JSON.stringify(body),
    },
  )
}

type FormShape = ReturnType<typeof makeForm>

/** Wire up mockCollection for the full happy-path scenario */
function stageDb(
  form: FormShape,
  opts: {
    existingContact?: { id: string; data: Record<string, unknown> } | null
  } = {},
) {
  const formDoc = {
    id: form.id,
    ref: { update: jest.fn() },
    data: () => {
      const { id: _id, ...rest } = form
      return rest
    },
  }

  const submissionDocRef = {
    id: 'sub-1',
    update: mockFormSubmissionsUpdate.mockResolvedValue(undefined),
  }
  mockFormSubmissionsAdd.mockResolvedValue(submissionDocRef)
  mockContactsAdd.mockResolvedValue({ id: 'contact-new' })
  mockActivitiesAdd.mockResolvedValue({ id: 'act-1' })

  const existingContactDocs =
    opts.existingContact === null || opts.existingContact === undefined
      ? []
      : [
          {
            id: opts.existingContact.id,
            data: () => opts.existingContact!.data,
            ref: { update: jest.fn().mockResolvedValue(undefined) },
          },
        ]

  // `contacts` where query
  const contactsQuery = {
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: mockContactsGet.mockResolvedValue({
      empty: existingContactDocs.length === 0,
      docs: existingContactDocs,
    }),
  }
  contactsQuery.where.mockReturnValue(contactsQuery)
  contactsQuery.limit.mockReturnValue(contactsQuery)

  // `forms` where query
  const formsQuery = {
    where: mockWhere,
    limit: mockLimit,
    get: mockFormsGet,
  }
  mockWhere.mockReturnValue(formsQuery)
  mockLimit.mockReturnValue(formsQuery)
  mockFormsGet.mockResolvedValue({
    empty: false,
    docs: [formDoc],
  })

  mockCollection.mockImplementation((name: string) => {
    if (name === 'forms') return { where: mockWhere }
    if (name === 'form_submissions') return { add: mockFormSubmissionsAdd }
    if (name === 'contacts')
      return {
        where: contactsQuery.where.bind(contactsQuery),
        add: mockContactsAdd,
      }
    if (name === 'activities') return { add: mockActivitiesAdd }
    if (name === 'lead_capture_schema_versions') return { doc: jest.fn(() => ({ id: 'schema-doc' })) }
    return {}
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks()
  jest.resetModules()
  ;(checkFormRateLimit as jest.Mock).mockResolvedValue(true)
  ;(verifyTurnstileToken as jest.Mock).mockResolvedValue({ success: true })
  mockDispatchWebhook.mockResolvedValue(undefined)
  mockRunTransaction.mockImplementation(async (callback) => callback({
    get: jest.fn().mockResolvedValue({ exists: false, data: () => undefined }),
    create: jest.fn(),
    update: jest.fn(),
  }))
})

describe('POST /api/v1/forms/[id]/submit — attribution', () => {
  it('persists referrer, campaign and UTM attribution on the submission', async () => {
    const form = makeForm()
    stageDb(form, { existingContact: null })

    const { POST } = await import('@/app/api/v1/forms/[id]/submit/route')
    const req = new NextRequest(
      'http://localhost/api/v1/forms/contact-us/submit?orgId=org-1&utm_source=linkedin',
      {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-forwarded-for': '127.0.0.1',
          referer: 'https://example.com/form?utm_campaign=growth',
        }),
        body: JSON.stringify({ email: 'bob@example.com' }),
      },
    )
    await POST(req, { params: Promise.resolve({ id: 'contact-us' }) })

    expect(mockFormSubmissionsAdd).toHaveBeenCalledWith(expect.objectContaining({
      attribution: expect.objectContaining({
        sourceId: 'form-abc',
        campaignId: '',
        referrer: expect.stringContaining('example.com/form'),
        utm: expect.objectContaining({ source: 'linkedin' }),
      }),
    }))
  })

  it('rejects body-supplied campaign and click lineage', async () => {
    const form = makeForm()
    stageDb(form, { existingContact: null })
    const { POST } = await import('@/app/api/v1/forms/[id]/submit/route')
    const res = await POST(submitReq('contact-us', 'org-1', {
      email: 'bob@example.com', campaignId: 'spoofed', gclid: 'spoofed-click',
    }), { params: Promise.resolve({ id: 'contact-us' }) })
    expect(res.status).toBe(400)
    expect(mockFormSubmissionsAdd).not.toHaveBeenCalled()
  })

  it('writes formSubmissionRef on FormSubmission record', async () => {
    const form = makeForm()
    stageDb(form, { existingContact: null })

    const { POST } = await import('@/app/api/v1/forms/[id]/submit/route')
    const req = submitReq('contact-us', 'org-1', { email: 'bob@example.com', name: 'Bob' })
    const res = await POST(req, { params: Promise.resolve({ id: 'contact-us' }) })

    expect(res.status).toBe(200)
    const [submissionPayload] = mockFormSubmissionsAdd.mock.calls[0]
    expect(submissionPayload.createdBy).toBe('system:form-submission:form-abc')
    expect(submissionPayload.createdByRef).toMatchObject({
      uid: 'system:form-submission:form-abc',
      displayName: 'Contact Us',
      kind: 'system',
    })
  })

  it('writes formSubmissionRef on new contact insert', async () => {
    const form = makeForm()
    stageDb(form, { existingContact: null })

    const { POST } = await import('@/app/api/v1/forms/[id]/submit/route')
    const req = submitReq('contact-us', 'org-1', { email: 'alice@example.com', name: 'Alice' })
    await POST(req, { params: Promise.resolve({ id: 'contact-us' }) })

    expect(mockContactsAdd).toHaveBeenCalledTimes(1)
    const [contactPayload] = mockContactsAdd.mock.calls[0]
    expect(contactPayload.createdBy).toBe('system:form-submission:form-abc')
    expect(contactPayload.createdByRef).toMatchObject({
      uid: 'system:form-submission:form-abc',
      displayName: 'Contact Us',
      kind: 'system',
    })
    expect(contactPayload.updatedBy).toBe('system:form-submission:form-abc')
    expect(contactPayload.updatedByRef).toMatchObject({ kind: 'system' })
  })

  it('does NOT overwrite createdByRef on existing contact', async () => {
    const form = makeForm()
    stageDb(form, {
      existingContact: {
        id: 'contact-existing',
        data: {
          email: 'bob@example.com',
          createdBy: 'human:original-user',
          createdByRef: { uid: 'human:original-user', displayName: 'Original', kind: 'human' },
          phone: '',
          company: '',
        },
      },
    })

    const { POST } = await import('@/app/api/v1/forms/[id]/submit/route')
    const req = submitReq('contact-us', 'org-1', { email: 'bob@example.com', name: 'Bob' })
    await POST(req, { params: Promise.resolve({ id: 'contact-us' }) })

    // contacts.add should NOT have been called (existing contact found)
    expect(mockContactsAdd).not.toHaveBeenCalled()
  })

  it('writes an Activity record linked to the contact', async () => {
    const form = makeForm()
    stageDb(form, { existingContact: null })

    const { POST } = await import('@/app/api/v1/forms/[id]/submit/route')
    const req = submitReq('contact-us', 'org-1', { email: 'carol@example.com', name: 'Carol' })
    await POST(req, { params: Promise.resolve({ id: 'contact-us' }) })

    expect(mockActivitiesAdd).toHaveBeenCalledTimes(1)
    const [activityPayload] = mockActivitiesAdd.mock.calls[0]
    expect(activityPayload.orgId).toBe('org-1')
    expect(activityPayload.type).toBe('note')
    expect(activityPayload.summary).toBe('Submitted form: Contact Us')
    expect(activityPayload.createdByRef).toMatchObject({
      uid: 'system:form-submission:form-abc',
      kind: 'system',
    })
    expect(activityPayload.metadata).toMatchObject({
      formId: 'form-abc',
      formName: 'Contact Us',
    })
  })
})

describe('POST /api/v1/forms/[id]/submit — honeypot', () => {
  it('returns 200 but makes no Firestore writes when honeypot is filled', async () => {
    const form = makeForm()
    stageDb(form, { existingContact: null })

    const { POST } = await import('@/app/api/v1/forms/[id]/submit/route')
    const req = submitReq('contact-us', 'org-1', {
      email: 'bot@example.com',
      _hp: 'I am a robot',
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'contact-us' }) })

    expect(res.status).toBe(200)
    expect(mockFormSubmissionsAdd).not.toHaveBeenCalled()
    expect(mockContactsAdd).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/forms/[id]/submit — form resolution', () => {
  it('returns 404 when form not found by org+slug', async () => {
    mockCollection.mockImplementation(() => ({ where: mockWhere }))
    mockWhere.mockReturnValue({ where: mockWhere, limit: mockLimit })
    mockLimit.mockReturnValue({ get: mockFormsGet })
    mockFormsGet.mockResolvedValue({ empty: true, docs: [] })

    const { POST } = await import('@/app/api/v1/forms/[id]/submit/route')
    const req = submitReq('missing-form', 'org-1', { email: 'x@x.com' })
    const res = await POST(req, { params: Promise.resolve({ id: 'missing-form' }) })
    expect(res.status).toBe(404)
  })

  it('returns 404 when form is soft-deleted', async () => {
    const form = makeForm({ deleted: true })
    stageDb(form)

    const { POST } = await import('@/app/api/v1/forms/[id]/submit/route')
    const req = submitReq('contact-us', 'org-1', { email: 'x@x.com' })
    const res = await POST(req, { params: Promise.resolve({ id: 'contact-us' }) })
    expect(res.status).toBe(404)
  })

  it('returns 404 when form is inactive (active=false)', async () => {
    // The query already filters active=true so an inactive form returns empty
    mockCollection.mockImplementation(() => ({ where: mockWhere }))
    mockWhere.mockReturnValue({ where: mockWhere, limit: mockLimit })
    mockLimit.mockReturnValue({ get: mockFormsGet })
    mockFormsGet.mockResolvedValue({ empty: true, docs: [] })

    const { POST } = await import('@/app/api/v1/forms/[id]/submit/route')
    const req = submitReq('contact-us', 'org-1', { email: 'x@x.com' })
    const res = await POST(req, { params: Promise.resolve({ id: 'contact-us' }) })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/v1/forms/[id]/submit — Turnstile', () => {
  it('returns 400 when Turnstile required but verification fails', async () => {
    const form = makeForm({ turnstileEnabled: true })
    stageDb(form, { existingContact: null })

    // The route is re-imported fresh each test (resetModules). We need to grab
    // the turnstile mock from the live module registry at call-time.
    const turnstileMod = await import('@/lib/forms/turnstile')
    ;(turnstileMod.verifyTurnstileToken as jest.Mock).mockResolvedValue({
      success: false,
      errorCodes: ['missing-input-response'],
    })

    const { POST } = await import('@/app/api/v1/forms/[id]/submit/route')
    const req = submitReq('contact-us', 'org-1', { email: 'x@example.com' })
    const res = await POST(req, { params: Promise.resolve({ id: 'contact-us' }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/CAPTCHA/)
  })
})

describe('POST /api/v1/forms/[id]/submit — webhook', () => {
  it('dispatches form.submitted webhook on valid submission', async () => {
    const form = makeForm({ createContact: false })
    stageDb(form)

    const { POST } = await import('@/app/api/v1/forms/[id]/submit/route')
    const req = submitReq('contact-us', 'org-1', { email: 'dave@example.com' })
    const res = await POST(req, { params: Promise.resolve({ id: 'contact-us' }) })

    expect(res.status).toBe(200)
    expect(mockDispatchWebhook).toHaveBeenCalledWith(
      'org-1',
      'form.submitted',
      expect.objectContaining({
        formId: 'form-abc',
        submissionId: 'sub-1',
      }),
    )
  })
})
