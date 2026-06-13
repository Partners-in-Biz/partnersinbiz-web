import { NextRequest } from 'next/server'

const mockGetProjectForUser = jest.fn()
const mockConvertApprovedBusinessInsightReviewTask = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: Function) => (req: NextRequest, ctx?: unknown) =>
    handler(req, { uid: 'admin-1', role: 'admin', authKind: 'session' }, ctx),
}))

jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: (...args: unknown[]) => mockGetProjectForUser(...args),
}))

jest.mock('@/lib/loop-engine/business-insight-conversion', () => ({
  convertApprovedBusinessInsightReviewTask: (...args: unknown[]) => mockConvertApprovedBusinessInsightReviewTask(...args),
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: { id: 'growth-project', data: () => ({ orgId: 'pib-platform-owner' }) },
    projectAccess: { role: 'owner', source: 'owner_org', canViewInternal: true },
  })
  mockConvertApprovedBusinessInsightReviewTask.mockResolvedValue({
    ok: true,
    created: true,
    projectId: 'growth-project',
    reviewTaskId: 'review-task-1',
    actionTaskId: 'business-insight-action-abc123',
  })
})

describe('POST /api/v1/projects/[projectId]/tasks/[taskId]/business-insight-action', () => {
  it('checks project access and converts an approved insight review task', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/business-insight-action/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/projects/growth-project/tasks/review-task-1/business-insight-action', {
      method: 'POST',
    }), {
      params: Promise.resolve({ projectId: 'growth-project', taskId: 'review-task-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(mockGetProjectForUser).toHaveBeenCalledWith('growth-project', expect.objectContaining({ uid: 'admin-1' }))
    expect(mockConvertApprovedBusinessInsightReviewTask).toHaveBeenCalledWith({
      projectId: 'growth-project',
      reviewTaskId: 'review-task-1',
      actorId: 'admin-1',
      actorType: 'user',
    })
    expect(body.data).toMatchObject({
      actionTaskId: 'business-insight-action-abc123',
      created: true,
    })
  })

  it('returns conversion errors without creating a follow-up task', async () => {
    mockConvertApprovedBusinessInsightReviewTask.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'Business insight review must be approved before conversion',
    })

    const { POST } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/business-insight-action/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/projects/growth-project/tasks/review-task-1/business-insight-action', {
      method: 'POST',
    }), {
      params: Promise.resolve({ projectId: 'growth-project', taskId: 'review-task-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toContain('must be approved')
  })
})
