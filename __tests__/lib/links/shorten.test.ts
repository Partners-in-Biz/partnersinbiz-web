const mockAdd = jest.fn()
const mockUpdate = jest.fn()
const mockDoc = jest.fn()
const mockCollection = jest.fn()
const serverTimestamp = { __serverTimestamp: true }
const increment = jest.fn((value: number) => ({ __increment: value }))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => serverTimestamp,
    increment,
  },
  Timestamp: {
    now: () => ({ __now: true }),
  },
}))

import { trackClick } from '@/lib/links/shorten'

beforeEach(() => {
  jest.clearAllMocks()
  const clicksCollection = { add: mockAdd }
  const linkDoc = {
    collection: jest.fn(() => clicksCollection),
    update: mockUpdate,
  }
  mockDoc.mockReturnValue(linkDoc)
  mockCollection.mockImplementation((name: string) => {
    if (name === 'shortened_links') return { doc: mockDoc }
    if (name === 'activities') return { add: mockAdd }
    if (name === 'link_clicks') return { add: mockAdd }
    return { add: mockAdd, doc: mockDoc }
  })
})

function requestWithTrackingHeaders() {
  return new Request('https://partnersinbiz.online/l/abc1234', {
    headers: {
      referer: 'https://example.com/source',
      'user-agent': 'Jest Browser',
      'x-forwarded-for': '203.0.113.10',
    },
  })
}

describe('trackClick', () => {
  it('writes a top-level link_clicks row for every tracked click', async () => {
    await trackClick('link-1', 'org-1', requestWithTrackingHeaders(), {
      contactId: 'contact-1',
      destinationUrl: 'https://example.com/pricing?utm_source=email',
    })

    expect(mockCollection).toHaveBeenCalledWith('link_clicks')
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      contactId: 'contact-1',
      shortenedLinkId: 'link-1',
      linkId: 'link-1',
      targetUrl: 'https://example.com/pricing?utm_source=email',
      clickedAt: serverTimestamp,
      createdAt: serverTimestamp,
      referrer: 'https://example.com/source',
      userAgent: 'Jest Browser',
      ip: '203.0.113.10',
    }))
  })
})
