// __tests__/lib/crm/segments.test.ts

const mockGet = jest.fn()
const mockWhere = jest.fn()
const mockLimit = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

import { resolveSegmentContacts } from '@/lib/crm/segments'

beforeEach(() => {
  jest.clearAllMocks()
  const query = { where: mockWhere, limit: mockLimit, get: mockGet }
  mockWhere.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
  mockCollection.mockReturnValue(query)
})

function makeDoc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data }
}

function ts(ms: number) {
  return { toMillis: () => ms }
}

function activeContact(id: string) {
  return makeDoc(id, { orgId: 'org-1', unsubscribedAt: null, bouncedAt: null, deleted: false })
}

describe('resolveSegmentContacts', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns [] without calling Firestore when orgId is missing', async () => {
    const out = await resolveSegmentContacts('', {})
    expect(out).toEqual([])
    expect(mockCollection).not.toHaveBeenCalled()
  })

  it('always passes orgId as the FIRST where clause', async () => {
    mockGet.mockResolvedValue({ docs: [] })
    await resolveSegmentContacts('org-1', { stage: 'new', type: 'lead' })
    expect(mockCollection).toHaveBeenCalledWith('contacts')
    expect(mockWhere.mock.calls[0]).toEqual(['orgId', '==', 'org-1'])
  })

  it('excludes unsubscribed, bounced, and deleted contacts in-memory', async () => {
    mockGet.mockResolvedValue({
      docs: [
        makeDoc('keep', {
          orgId: 'org-1',
          unsubscribedAt: null,
          bouncedAt: null,
          deleted: false,
        }),
        makeDoc('unsub', {
          orgId: 'org-1',
          unsubscribedAt: { _seconds: 1 },
          bouncedAt: null,
          deleted: false,
        }),
        makeDoc('bounced', {
          orgId: 'org-1',
          unsubscribedAt: null,
          bouncedAt: { _seconds: 1 },
          deleted: false,
        }),
        makeDoc('deleted', {
          orgId: 'org-1',
          unsubscribedAt: null,
          bouncedAt: null,
          deleted: true,
        }),
      ],
    })

    const out = await resolveSegmentContacts('org-1', {})
    expect(out.map((c) => c.id)).toEqual(['keep'])
  })

  it('with empty filters returns all org contacts (excluding the three states)', async () => {
    mockGet.mockResolvedValue({
      docs: [
        makeDoc('a', { orgId: 'org-1', unsubscribedAt: null, bouncedAt: null, deleted: false }),
        makeDoc('b', { orgId: 'org-1', unsubscribedAt: null, bouncedAt: null, deleted: false }),
      ],
    })

    const out = await resolveSegmentContacts('org-1', {})
    // Only the orgId where clause should fire — no other filters.
    expect(mockWhere).toHaveBeenCalledTimes(1)
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(out.map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('returns [] when tags exceed array-contains-any limit (10)', async () => {
    const tags = Array.from({ length: 11 }, (_, i) => `t${i}`)
    const out = await resolveSegmentContacts('org-1', { tags })
    expect(out).toEqual([])
    expect(mockCollection).not.toHaveBeenCalled()
  })

  it('applies stage/type/source/tags filters via where()', async () => {
    mockGet.mockResolvedValue({ docs: [] })
    await resolveSegmentContacts('org-1', {
      tags: ['vip', 'beta'],
      stage: 'new',
      type: 'lead',
      source: 'manual',
    })
    const calls = mockWhere.mock.calls
    expect(calls[0]).toEqual(['orgId', '==', 'org-1'])
    expect(calls).toContainEqual(['tags', 'array-contains-any', ['vip', 'beta']])
    expect(calls).toContainEqual(['stage', '==', 'new'])
    expect(calls).toContainEqual(['type', '==', 'lead'])
    expect(calls).toContainEqual(['source', '==', 'manual'])
  })

  it('filters contacts that opened any email', async () => {
    mockGet
      .mockResolvedValueOnce({ docs: [activeContact('opened'), activeContact('quiet')] })
      .mockResolvedValueOnce({ docs: [makeDoc('email-1', { contactId: 'opened', openedAt: ts(1_000) })] })

    const out = await resolveSegmentContacts('org-1', {
      behavioral: [{ op: 'has-opened', scope: 'any-email' }],
    })

    expect(out.map((c) => c.id)).toEqual(['opened'])
  })

  it('filters contacts that clicked any email', async () => {
    mockGet
      .mockResolvedValueOnce({ docs: [activeContact('clicked'), activeContact('quiet')] })
      .mockResolvedValueOnce({ docs: [makeDoc('email-1', { contactId: 'clicked', clickedAt: ts(1_000) })] })

    const out = await resolveSegmentContacts('org-1', {
      behavioral: [{ op: 'has-clicked', scope: 'any-email' }],
    })

    expect(out.map((c) => c.id)).toEqual(['clicked'])
  })

  it('filters contacts that replied', async () => {
    mockGet
      .mockResolvedValueOnce({ docs: [activeContact('replied'), activeContact('quiet')] })
      .mockResolvedValueOnce({ docs: [makeDoc('reply-1', { contactId: 'replied', intent: 'reply', receivedAt: ts(1_000) })] })

    const out = await resolveSegmentContacts('org-1', {
      behavioral: [{ op: 'has-replied', scope: 'any-email' }],
    })

    expect(out.map((c) => c.id)).toEqual(['replied'])
  })

  it('filters contacts by engagement score and last engagement window', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(10 * 24 * 60 * 60 * 1000)
    mockGet
      .mockResolvedValueOnce({ docs: [activeContact('engaged'), activeContact('quiet')] })
      .mockResolvedValueOnce({
        docs: [
          makeDoc('email-1', {
            contactId: 'engaged',
            sentAt: ts(9 * 24 * 60 * 60 * 1000),
            openedAt: ts(9 * 24 * 60 * 60 * 1000),
            clickedAt: ts(9 * 24 * 60 * 60 * 1000),
          }),
        ],
      })

    const out = await resolveSegmentContacts('org-1', {
      engagement: { min: 10, lastEngagedWithinDays: 7 },
    })

    expect(out.map((c) => c.id)).toEqual(['engaged'])
  })

  it('matches link-url clicked segments from link_clicks targetUrl rows without requiring a shortened_links join', async () => {
    mockGet
      .mockResolvedValueOnce({ docs: [activeContact('clicked-url'), activeContact('quiet')] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({
        docs: [
          makeDoc('click-1', {
            orgId: 'org-1',
            contactId: 'clicked-url',
            targetUrl: 'https://example.com/pricing?utm_source=email',
            clickedAt: ts(1_000),
          }),
        ],
      })

    const out = await resolveSegmentContacts('org-1', {
      behavioral: [{ op: 'has-clicked', scope: 'link-url', scopeId: '/pricing' }],
    })

    expect(out.map((c) => c.id)).toEqual(['clicked-url'])
  })
})
