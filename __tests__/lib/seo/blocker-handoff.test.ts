const mockCollection = jest.fn()
const mockServerTimestamp = jest.fn(() => 'SERVER_TIME')

export {}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: mockServerTimestamp,
  },
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: jest.fn(() => true),
}))

function docSnap(id: string, data: Record<string, unknown> | null) {
  return {
    id,
    exists: data !== null,
    data: () => data,
  }
}

describe('ensureSeoQueuedAgentHandoff', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('creates a watcher-visible Pip orchestration task for queued SEO work', async () => {
    const projectTaskSet = jest.fn()
    const handoffSet = jest.fn()
    const taskSet = jest.fn()
    const projectRef = {
      id: 'project-1',
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          id: 'seo-run-sprint-1-2026-05-20',
          get: jest.fn().mockResolvedValue(docSnap('seo-run-sprint-1-2026-05-20', null)),
          set: projectTaskSet,
        })),
      })),
    }

    mockCollection.mockImplementation((name: string) => {
      if (name === 'seo_sprints') {
        return {
          doc: jest.fn(() => ({
            get: jest.fn().mockResolvedValue(docSnap('sprint-1', {
              orgId: 'org-1',
              siteName: 'Partners in Biz',
              siteUrl: 'https://partnersinbiz.online',
              timezone: 'Africa/Johannesburg',
            })),
          })),
        }
      }
      if (name === 'seo_tasks') {
        return {
          doc: jest.fn((id: string) => ({
            get: jest.fn().mockResolvedValue(docSnap(id, {
              sprintId: 'sprint-1',
              orgId: 'org-1',
              title: id === 'seo-task-1' ? 'Write homepage metadata' : 'Create internal links',
              taskType: id === 'seo-task-1' ? 'meta-generate' : 'internal-link-add',
            })),
            set: taskSet,
          })),
        }
      }
      if (name === 'projects') {
        return {
          where: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({
              docs: [
                {
                  data: () => ({ name: 'Partners in Biz - SEO 90-day Sprint' }),
                  ref: projectRef,
                },
              ],
            }),
          })),
          doc: jest.fn(() => projectRef),
        }
      }
      if (name === 'seo_agent_handoffs') {
        return {
          doc: jest.fn(() => ({
            set: handoffSet,
          })),
        }
      }
      throw new Error(`Unexpected collection ${name}`)
    })

    const { ensureSeoQueuedAgentHandoff } = await import('@/lib/seo/blocker-handoff')
    const result = await ensureSeoQueuedAgentHandoff({
      sprintId: 'sprint-1',
      taskIds: ['seo-task-1', 'seo-task-2'],
      actor: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })

    expect(result).toEqual({
      projectId: 'project-1',
      projectTaskId: 'seo-run-sprint-1-2026-05-20',
      taskIds: ['seo-task-1', 'seo-task-2'],
    })
    expect(projectTaskSet).toHaveBeenCalledWith(expect.objectContaining({
      assigneeAgentId: 'pip',
      agentStatus: 'pending',
      source: 'seo-run-orchestration',
      sourceSeoTaskIds: ['seo-task-1', 'seo-task-2'],
      agentInput: expect.objectContaining({
        context: expect.objectContaining({
          orchestrationMode: 'pip-orchestrator',
          queuedSeoTaskIds: ['seo-task-1', 'seo-task-2'],
          requestedAgentIds: ['theo', 'maya', 'sage', 'nora'],
        }),
      }),
    }), { merge: true })
    expect(handoffSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'queued',
      projectId: 'project-1',
      projectTaskId: 'seo-run-sprint-1-2026-05-20',
      seoTaskIds: ['seo-task-1', 'seo-task-2'],
    }), { merge: true })
    expect(taskSet).toHaveBeenCalledTimes(2)
  })
})
