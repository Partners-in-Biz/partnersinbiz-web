import { NextRequest } from 'next/server'

const mockUser = { uid: 'user-1', role: 'client', orgId: 'org-1' }
const listReplyQueue = jest.fn()
const correctReplyClassification = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: Function) => (req: NextRequest, context?: unknown) => handler(req, mockUser, context),
}))

jest.mock('@/lib/api/tenant', () => ({
  withTenant: (handler: Function) => (req: NextRequest, user: typeof mockUser, context?: unknown) => handler(req, user, 'org-1', context),
}))

jest.mock('@/lib/email-marketing/reply-queue', () => ({
  listReplyQueue: (...args: unknown[]) => listReplyQueue(...args),
  correctReplyClassification: (...args: unknown[]) => correctReplyClassification(...args),
}))

import * as repliesRoute from '@/app/api/v1/email-marketing/replies/route'
import * as correctionRoute from '@/app/api/v1/email-marketing/replies/[id]/classification/route'

function request(path: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => jest.clearAllMocks())

it('lists replies only through the authenticated organisation with safe filters', async () => {
  listReplyQueue.mockResolvedValue({ items: [], nextCursor: null })
  const response = await repliesRoute.GET(request('/api/v1/email-marketing/replies?orgId=org-other&classification=positive&sla=missed&ownerUserId=u-1&queueId=q-1&limit=999'))

  expect(response.status).toBe(200)
  expect(listReplyQueue).toHaveBeenCalledWith('org-1', {
    classification: 'positive', sla: 'missed', ownerUserId: 'u-1', queueId: 'q-1', cursor: null, limit: 100,
  })
})

it('rejects unsupported filters instead of broadening the query', async () => {
  const response = await repliesRoute.GET(request('/api/v1/email-marketing/replies?classification=urgent'))
  expect(response.status).toBe(400)
  expect(listReplyQueue).not.toHaveBeenCalled()
})

it('corrects classification in the authenticated tenant and records the actor', async () => {
  correctReplyClassification.mockResolvedValue({ id: 'reply-1', classification: 'negative', corrected: true })
  const response = await correctionRoute.PATCH(
    request('/api/v1/email-marketing/replies/reply-1/classification', 'PATCH', { classification: 'negative', reason: 'Contact declined' }),
    { params: Promise.resolve({ id: 'reply-1' }) },
  )

  expect(response.status).toBe(200)
  expect(correctReplyClassification).toHaveBeenCalledWith('org-1', 'reply-1', 'negative', 'user-1', 'Contact declined')
})

it('does not expose a reply from another tenant during correction', async () => {
  correctReplyClassification.mockResolvedValue(null)
  const response = await correctionRoute.PATCH(
    request('/api/v1/email-marketing/replies/reply-other/classification', 'PATCH', { classification: 'positive' }),
    { params: Promise.resolve({ id: 'reply-other' }) },
  )
  expect(response.status).toBe(404)
})

it('uses the empty reply id when dynamic route context is malformed', async () => {
  correctReplyClassification.mockResolvedValue(null)

  const response = await correctionRoute.PATCH(
    request('/api/v1/email-marketing/replies/classification', 'PATCH', { classification: 'neutral' }),
    { params: 'not-a-params-promise' },
  )

  expect(response.status).toBe(404)
  expect(correctReplyClassification).toHaveBeenCalledWith('org-1', '', 'neutral', 'user-1', '')
})
