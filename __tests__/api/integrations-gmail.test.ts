// __tests__/api/integrations-gmail.test.ts

const mockGet = jest.fn()
const mockAdd = jest.fn()
const mockUpdate = jest.fn()
const mockDoc = jest.fn()
const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockLimit = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    increment: (n: number) => ({ increment: n }),
  },
  Timestamp: {
    fromDate: (d: Date) => ({ seconds: Math.floor(d.getTime() / 1000) }),
  },
}))

import type { CrmIntegration } from '@/lib/crm/integrations/types'

const BASE_INTEGRATION: CrmIntegration = {
  id: 'int-1',
  orgId: 'org-1',
  provider: 'gmail',
  name: 'My Google Contacts',
  status: 'active',
  config: {
    refreshToken: 'valid-refresh-token',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  },
  autoTags: ['google'],
  autoCampaignIds: [],
  cadenceMinutes: 60,
  lastSyncedAt: null,
  lastSyncStats: { imported: 0, created: 0, updated: 0, skipped: 0, errored: 0 },
  lastError: '',
  createdAt: null,
  updatedAt: null,
}

const PERSON = {
  resourceName: 'people/c1234',
  names: [{ displayName: 'Jane Doe', givenName: 'Jane', familyName: 'Doe' }],
  emailAddresses: [{ value: 'jane@example.com' }],
  phoneNumbers: [{ value: '+27821234567' }],
  organizations: [{ name: 'Acme Corp' }],
}

function mockFetch(tokenOk: boolean, responses: unknown[]) {
  let callIndex = 0
  global.fetch = jest.fn().mockImplementation(() => {
    if (callIndex === 0) {
      callIndex++
      if (!tokenOk) {
        return Promise.resolve({ ok: false, json: async () => ({}) })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ access_token: 'access-token-abc' }),
      })
    }
    const resp = responses[callIndex - 1] ?? { connections: [], nextPageToken: undefined }
    callIndex++
    return Promise.resolve({
      ok: true,
      json: async () => resp,
    })
  })
}

function mockGmailFetch(messages: unknown[], messageDetails: Record<string, unknown>) {
  let callIndex = 0
  global.fetch = jest.fn().mockImplementation((url: string) => {
    callIndex++
    if (callIndex === 1) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ access_token: 'access-token-abc' }),
      })
    }
    if (url.startsWith('https://people.googleapis.com/')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ connections: [] }),
      })
    }
    if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages/')) {
      const messageId = decodeURIComponent(url.split('/messages/')[1].split('?')[0])
      return Promise.resolve({
        ok: true,
        json: async () => messageDetails[messageId],
      })
    }
    if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ messages }),
      })
    }
    throw new Error(`Unexpected fetch URL: ${url}`)
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  const chainable = {
    where: mockWhere,
    limit: mockLimit,
    get: mockGet,
    add: mockAdd,
    update: mockUpdate,
    doc: mockDoc,
  }
  mockWhere.mockReturnValue(chainable)
  mockLimit.mockReturnValue(chainable)
  mockDoc.mockReturnValue(chainable)
  mockCollection.mockReturnValue(chainable)
})

describe('syncGmail', () => {
  it('returns error when refreshToken is missing', async () => {
    const { syncGmail } = await import('@/lib/crm/integrations/handlers/gmail')
    const integration = { ...BASE_INTEGRATION, config: {} }
    const result = await syncGmail(integration)
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/refreshToken/)
  })

  it('returns error when token refresh fails', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    const { syncGmail } = await import('@/lib/crm/integrations/handlers/gmail')
    const result = await syncGmail(BASE_INTEGRATION)
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/access token/)
  })

  it('returns error when People API returns non-ok status', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) })
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'Forbidden' })
    const { syncGmail } = await import('@/lib/crm/integrations/handlers/gmail')
    const result = await syncGmail(BASE_INTEGRATION)
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/403/)
  })

  it('fetches multiple pages until nextPageToken is absent', async () => {
    const page1 = {
      connections: [PERSON],
      nextPageToken: 'token-page-2',
    }
    const page2 = {
      connections: [{ ...PERSON, resourceName: 'people/c9999', emailAddresses: [{ value: 'bob@example.com' }] }],
    }

    let call = 0
    global.fetch = jest.fn().mockImplementation(() => {
      call++
      if (call === 1) return Promise.resolve({ ok: true, json: async () => ({ access_token: 'tok' }) })
      if (call === 2) return Promise.resolve({ ok: true, json: async () => page1 })
      return Promise.resolve({ ok: true, json: async () => page2 })
    })

    mockGet.mockResolvedValue({ empty: true, docs: [] })
    mockAdd.mockResolvedValue({ id: 'new-contact' })

    const { syncGmail } = await import('@/lib/crm/integrations/handlers/gmail')
    const result = await syncGmail(BASE_INTEGRATION)
    expect(result.ok).toBe(true)
    expect(result.stats.imported).toBe(2)
    expect(result.stats.created).toBe(2)
    expect(call).toBe(4)
  })

  it('creates new contact with correct orgId, tags, and name', async () => {
    mockFetch(true, [{ connections: [PERSON] }])
    mockGet.mockResolvedValue({ empty: true, docs: [] })
    mockAdd.mockResolvedValue({ id: 'new-id' })

    const { syncGmail } = await import('@/lib/crm/integrations/handlers/gmail')
    const result = await syncGmail(BASE_INTEGRATION)

    expect(result.ok).toBe(true)
    expect(result.stats.created).toBe(1)

    // Verify add was called on contacts collection
    expect(mockAdd).toHaveBeenCalled()
    const addCall = mockAdd.mock.calls[0][0]
    expect(addCall.orgId).toBe('org-1')
    expect(addCall.email).toBe('jane@example.com')
    expect(addCall.name).toBe('Jane Doe')
    expect(addCall.tags).toContain('google')
  })

  it('skips contacts with no email address', async () => {
    const noEmail = { ...PERSON, emailAddresses: [] }
    mockFetch(true, [{ connections: [noEmail] }])

    const { syncGmail } = await import('@/lib/crm/integrations/handlers/gmail')
    const result = await syncGmail(BASE_INTEGRATION)

    expect(result.ok).toBe(true)
    expect(result.stats.imported).toBe(0)
    expect(result.stats.skipped).toBe(1)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('merges tags for an existing contact that is not bounced/unsubscribed', async () => {
    mockFetch(true, [{ connections: [PERSON] }])
    mockGet.mockResolvedValue({
      empty: false,
      docs: [{
        data: () => ({ tags: ['existing-tag'], bouncedAt: null, unsubscribedAt: null }),
        ref: { update: mockUpdate },
      }],
    })

    const { syncGmail } = await import('@/lib/crm/integrations/handlers/gmail')
    const result = await syncGmail(BASE_INTEGRATION)

    expect(result.ok).toBe(true)
    expect(result.stats.updated).toBe(1)
    expect(mockUpdate).toHaveBeenCalled()
    const updatePayload = mockUpdate.mock.calls[0][0]
    expect(updatePayload.tags).toContain('existing-tag')
    expect(updatePayload.tags).toContain('google')
  })

  it('skips existing contact that has bouncedAt set', async () => {
    mockFetch(true, [{ connections: [PERSON] }])
    mockGet.mockResolvedValue({
      empty: false,
      docs: [{
        data: () => ({ tags: ['old'], bouncedAt: 'SERVER_TIMESTAMP', unsubscribedAt: null }),
        ref: { update: mockUpdate },
      }],
    })

    const { syncGmail } = await import('@/lib/crm/integrations/handlers/gmail')
    const result = await syncGmail(BASE_INTEGRATION)

    expect(result.ok).toBe(true)
    expect(result.stats.skipped).toBe(1)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('skips existing contact that has unsubscribedAt set', async () => {
    mockFetch(true, [{ connections: [PERSON] }])
    mockGet.mockResolvedValue({
      empty: false,
      docs: [{
        data: () => ({ tags: ['old'], bouncedAt: null, unsubscribedAt: 'SERVER_TIMESTAMP' }),
        ref: { update: mockUpdate },
      }],
    })

    const { syncGmail } = await import('@/lib/crm/integrations/handlers/gmail')
    const result = await syncGmail(BASE_INTEGRATION)

    expect(result.ok).toBe(true)
    expect(result.stats.skipped).toBe(1)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('creates an email_received activity for a matched inbound Gmail message', async () => {
    mockGmailFetch(
      [{ id: 'gmail-msg-1', threadId: 'thread-1' }],
      {
        'gmail-msg-1': {
          id: 'gmail-msg-1',
          threadId: 'thread-1',
          internalDate: '1747303200000',
          snippet: 'Can we talk about the proposal?',
          payload: {
            headers: [
              { name: 'From', value: 'Jane Doe <jane@example.com>' },
              { name: 'Subject', value: 'Proposal question' },
              { name: 'Date', value: 'Thu, 15 May 2025 10:00:00 +0000' },
              { name: 'Message-ID', value: '<abc123@mail.example.com>' },
            ],
          },
        },
      },
    )
    mockGet
      .mockResolvedValueOnce({
        empty: false,
        docs: [{ id: 'contact-1', data: () => ({ orgId: 'org-1', email: 'jane@example.com', deleted: false }) }],
      })
      .mockResolvedValueOnce({ empty: true, docs: [] })
    mockAdd.mockResolvedValue({ id: 'activity-1' })

    const { syncGmail } = await import('@/lib/crm/integrations/handlers/gmail')
    const result = await syncGmail(BASE_INTEGRATION)

    expect(result.ok).toBe(true)
    expect(mockCollection).toHaveBeenCalledWith('activities')
    expect(mockAdd).toHaveBeenCalledTimes(1)
    expect(mockAdd.mock.calls[0][0]).toMatchObject({
      orgId: 'org-1',
      contactId: 'contact-1',
      dealId: '',
      type: 'email_received',
      summary: 'Email received: Proposal question',
      createdBy: 'integration-sync',
      deleted: false,
      metadata: {
        integrationId: 'int-1',
        provider: 'gmail',
        gmailMessageId: 'gmail-msg-1',
        gmailThreadId: 'thread-1',
        fromEmail: 'jane@example.com',
        subject: 'Proposal question',
      },
    })
  })

  it('skips an inbound Gmail message when the sender is unknown', async () => {
    mockGmailFetch(
      [{ id: 'gmail-msg-unknown', threadId: 'thread-unknown' }],
      {
        'gmail-msg-unknown': {
          id: 'gmail-msg-unknown',
          threadId: 'thread-unknown',
          payload: {
            headers: [
              { name: 'From', value: 'Unknown <unknown@example.com>' },
              { name: 'Subject', value: 'Hello' },
            ],
          },
        },
      },
    )
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] })

    const { syncGmail } = await import('@/lib/crm/integrations/handlers/gmail')
    const result = await syncGmail(BASE_INTEGRATION)

    expect(result.ok).toBe(true)
    expect(result.stats.skipped).toBe(1)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('does not duplicate a Gmail message when an activity marker already exists', async () => {
    mockGmailFetch(
      [{ id: 'gmail-msg-1', threadId: 'thread-1' }],
      {
        'gmail-msg-1': {
          id: 'gmail-msg-1',
          threadId: 'thread-1',
          payload: {
            headers: [
              { name: 'From', value: 'Jane Doe <jane@example.com>' },
              { name: 'Subject', value: 'Already logged' },
            ],
          },
        },
      },
    )
    mockGet
      .mockResolvedValueOnce({
        empty: false,
        docs: [{ id: 'contact-1', data: () => ({ orgId: 'org-1', email: 'jane@example.com', deleted: false }) }],
      })
      .mockResolvedValueOnce({
        empty: false,
        docs: [{ id: 'activity-existing', data: () => ({ metadata: { gmailMessageId: 'gmail-msg-1' } }) }],
      })

    const { syncGmail } = await import('@/lib/crm/integrations/handlers/gmail')
    const result = await syncGmail(BASE_INTEGRATION)

    expect(result.ok).toBe(true)
    expect(result.stats.skipped).toBe(1)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('does not match Gmail senders across organizations', async () => {
    mockGmailFetch(
      [{ id: 'gmail-msg-cross-org', threadId: 'thread-cross-org' }],
      {
        'gmail-msg-cross-org': {
          id: 'gmail-msg-cross-org',
          threadId: 'thread-cross-org',
          payload: {
            headers: [
              { name: 'From', value: 'Jane Doe <jane@example.com>' },
              { name: 'Subject', value: 'Wrong tenant' },
            ],
          },
        },
      },
    )
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] })

    const { syncGmail } = await import('@/lib/crm/integrations/handlers/gmail')
    const result = await syncGmail(BASE_INTEGRATION)

    expect(result.ok).toBe(true)
    expect(result.stats.skipped).toBe(1)
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(mockWhere).toHaveBeenCalledWith('email', '==', 'jane@example.com')
    expect(mockAdd).not.toHaveBeenCalled()
  })
})
