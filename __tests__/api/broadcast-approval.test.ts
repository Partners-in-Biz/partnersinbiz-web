import { NextRequest } from 'next/server'

const update = jest.fn()
const get = jest.fn()
const add = jest.fn()
const doc = jest.fn(() => ({ get, update }))
const collection = jest.fn(() => ({ doc, add }))

jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection } }))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (...args: unknown[]) => unknown) => handler,
}))

const human = { uid: 'human-1', role: 'admin' as const, authKind: 'session' as const }
const ctx = { params: Promise.resolve({ id: 'broadcast-1' }) }

beforeEach(() => jest.clearAllMocks())

it('invalidates prior approval when content changes materially', async () => {
  get.mockResolvedValue({
    exists: true, id: 'broadcast-1', ref: { update },
    data: () => ({ orgId: 'org-1', status: 'draft', deleted: false, content: {}, audience: {}, approvalState: { status: 'approved', approvalTaskId: 'task-1' } }),
  })
  const { PUT } = await import('@/app/api/v1/broadcasts/[id]/route')
  const response = await PUT(new NextRequest('http://localhost/api/v1/broadcasts/broadcast-1', {
    method: 'PUT', body: JSON.stringify({ content: { subject: 'Changed' } }), headers: { 'content-type': 'application/json' },
  }), human, ctx)

  expect(response.status).toBe(200)
  expect(update).toHaveBeenCalledWith(expect.objectContaining({
    approvalState: expect.objectContaining({ status: 'revoked', approvalTaskId: null }),
  }))
})
