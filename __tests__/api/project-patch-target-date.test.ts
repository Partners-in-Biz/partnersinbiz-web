import { NextRequest } from 'next/server'

const mockGetProjectForUser = jest.fn()
const mockCollection = jest.fn()
const mockProjectDoc = jest.fn()
const mockProjectUpdate = jest.fn()

let mockUser = { uid: 'owner-1', role: 'admin' as const, orgId: 'pib-platform-owner' }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: typeof mockUser, ctx?: unknown) => unknown) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: (...args: unknown[]) => mockGetProjectForUser(...args),
}))

jest.mock('@/lib/activity/log', () => ({
  logActivity: jest.fn(() => Promise.resolve()),
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: jest.fn(() => true),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockUser = { uid: 'owner-1', role: 'admin', orgId: 'pib-platform-owner' }
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: {
      id: 'project-1',
      data: () => ({
        id: 'project-1',
        name: 'PIB - Website',
        orgId: 'pib-platform-owner',
        sourceOrgId: 'pib-platform-owner',
      }),
    },
  })
  mockProjectUpdate.mockResolvedValue(undefined)
  mockProjectDoc.mockReturnValue({ update: mockProjectUpdate })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'projects') return { doc: mockProjectDoc }
    throw new Error(`Unexpected collection ${name}`)
  })
})

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/v1/projects/project-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/v1/projects/[projectId] targetDate', () => {
  it('updates project targetDate through the patch API', async () => {
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/route')
    const res = await PATCH(patchRequest({ targetDate: '2026-06-18' }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockProjectUpdate).toHaveBeenCalledWith(expect.objectContaining({
      targetDate: '2026-06-18',
      updatedAt: 'SERVER_TIMESTAMP',
    }))
    expect(body.data).toEqual(expect.objectContaining({
      id: 'project-1',
      targetDate: '2026-06-18',
    }))
  })

  it('accepts dueDate as a user-facing alias for targetDate', async () => {
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/route')
    const res = await PATCH(patchRequest({ dueDate: '2026-06-18' }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(200)
    expect(mockProjectUpdate).toHaveBeenCalledWith(expect.objectContaining({
      targetDate: '2026-06-18',
    }))
  })

  it('rejects invalid targetDate values instead of persisting them', async () => {
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/route')
    const res = await PATCH(patchRequest({ targetDate: 'not-a-date' }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(400)
    expect(mockProjectUpdate).not.toHaveBeenCalled()
  })
})
