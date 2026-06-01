// __tests__/api/v1/email/list.test.ts
import { GET } from '@/app/api/v1/email/route'
import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifyIdToken: jest.fn(), verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

import { adminDb } from '@/lib/firebase/admin'
process.env.AI_API_KEY = 'test-key'

function makeReq(search = '') {
  return new NextRequest(`http://localhost/api/v1/email${search}`, {
    method: 'GET',
    headers: { authorization: 'Bearer test-key' },
  })
}

function mockCollection(docs: Array<Record<string, unknown>>) {
  const mockDocs = docs.map((d) => ({ id: typeof d.id === 'string' ? d.id : 'e1', data: () => d }))
  const query = {
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs: mockDocs }),
  }
  ;(adminDb.collection as jest.Mock).mockReturnValue(query)
  return query
}

function mockEmailAndContactCollections(
  emails: Array<Record<string, unknown>>,
  contact: Record<string, unknown> | null,
) {
  const emailDocs = emails.map((d) => ({ id: typeof d.id === 'string' ? d.id : 'e1', data: () => d }))
  const emailQuery = {
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs: emailDocs }),
  }
  const contactGet = jest.fn().mockResolvedValue({
    exists: Boolean(contact),
    data: () => contact ?? {},
  })
  ;(adminDb.collection as jest.Mock).mockImplementation((collectionName: string) => {
    if (collectionName === 'contacts') {
      return { doc: jest.fn(() => ({ get: contactGet })) }
    }
    return emailQuery
  })
  return { emailQuery, contactGet }
}

describe('GET /api/v1/email', () => {
  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost/api/v1/email')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns list of emails', async () => {
    mockCollection([{ id: 'e1', subject: 'Hello', status: 'sent', direction: 'outbound' }])
    const res = await GET(makeReq('?orgId=org-test'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.meta).toMatchObject({ page: 1 })
  })

  it('filters by status query param', async () => {
    mockCollection([])
    const res = await GET(makeReq('?orgId=org-test&status=sent'))
    expect(res.status).toBe(200)
    expect(adminDb.collection).toHaveBeenCalledWith('emails')
  })

  it('filters by direction query param', async () => {
    mockCollection([])
    const res = await GET(makeReq('?orgId=org-test&direction=outbound'))
    expect(res.status).toBe(200)
  })

  it('filters by contactId query param', async () => {
    mockCollection([])
    const res = await GET(makeReq('?orgId=org-test&contactId=c1'))
    expect(res.status).toBe(200)
  })

  it('keeps contact email history index-safe by filtering contactId in memory', async () => {
    const query = mockCollection([
      {
        id: 'other',
        orgId: 'org-test',
        contactId: 'other-contact',
        subject: 'Other contact',
        createdAt: '2026-05-28T09:00:00.000Z',
      },
      {
        id: 'newer',
        orgId: 'org-test',
        contactId: 'c1',
        subject: 'Newest matching email',
        createdAt: '2026-05-30T09:00:00.000Z',
      },
      {
        id: 'older',
        orgId: 'org-test',
        contactId: 'c1',
        subject: 'Older matching email',
        createdAt: '2026-05-29T09:00:00.000Z',
      },
    ])

    const res = await GET(makeReq('?orgId=org-test&contactId=c1&limit=20'))

    expect(res.status).toBe(200)
    expect(query.where).toHaveBeenCalledTimes(1)
    expect(query.where).toHaveBeenCalledWith('orgId', '==', 'org-test')
    expect(query.where).not.toHaveBeenCalledWith('contactId', '==', 'c1')
    expect(query.orderBy).not.toHaveBeenCalled()

    const body = await res.json()
    expect(body.data.map((email: { id: string }) => email.id)).toEqual(['newer', 'older'])
    expect(body.meta).toMatchObject({ total: 2, page: 1, limit: 20 })
  })

  it('derives org scope from contactId when no orgId is supplied', async () => {
    const { emailQuery, contactGet } = mockEmailAndContactCollections(
      [
        {
          id: 'matching',
          orgId: 'org-from-contact',
          contactId: 'c1',
          subject: 'Contact history',
          createdAt: '2026-05-30T09:00:00.000Z',
        },
      ],
      { orgId: 'org-from-contact' },
    )

    const res = await GET(makeReq('?contactId=c1&limit=8'))

    expect(res.status).toBe(200)
    expect(contactGet).toHaveBeenCalledTimes(1)
    expect(emailQuery.where).toHaveBeenCalledWith('orgId', '==', 'org-from-contact')
    const body = await res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe('matching')
  })

  it('returns empty array when no emails exist', async () => {
    mockCollection([])
    const res = await GET(makeReq('?orgId=org-test'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual([])
  })
})
