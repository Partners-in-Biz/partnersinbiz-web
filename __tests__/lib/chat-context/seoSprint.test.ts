const mockSprintGet = jest.fn()
const mockTaskGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => name === 'seo_sprints'
      ? { doc: () => ({ get: mockSprintGet }) }
      : {
          where: () => ({
            where: () => ({ get: mockTaskGet }),
          }),
        },
  },
}))

function sprint(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    id: 'sprint-1',
    data: () => ({
      orgId: 'org-1',
      siteName: 'Growth Site',
      siteUrl: 'https://example.com',
      status: 'active',
      currentWeek: 3,
      autopilotMode: 'safe',
      todayPlan: { due: ['task-1'], inProgress: [] },
      deleted: false,
      ...overrides,
    }),
  }
}

function task(id: string, value: Record<string, unknown>) {
  return { id, data: () => value }
}

describe('SEO sprint chat context adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSprintGet.mockResolvedValue(sprint())
    mockTaskGet.mockResolvedValue({
      docs: [
        task('task-1', { title: 'Audit metadata', status: 'not_started', week: 3, focus: 'Technical' }),
        task('task-2', { title: 'Fix blocker', status: 'blocked', blockerReason: 'GSC disconnected', week: 3 }),
        task('task-3', { title: 'Ship schema', status: 'done', week: 2 }),
      ],
    })
  })

  it('projects live sprint/task state and the confirmed canonical run command for admins', async () => {
    const { seoSprintChatContextAdapter } = await import('@/lib/chat-context/adapters/seoSprint')
    const result = await seoSprintChatContextAdapter.resolve({
      kind: 'seo_sprint',
      id: 'sprint-1',
      user: { uid: 'admin-1', role: 'admin', activeOrgId: 'org-1', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.pulse.progress).toEqual({ complete: 1, total: 3 })
    expect(result.model.groups.find((group) => group.id === 'tasks')?.items).toHaveLength(3)
    expect(result.model.groups[0].items[0].actions?.[0]).toEqual({
      id: 'run-seo-plan:sprint-1',
      label: `Run today's SEO plan`,
      href: '/api/v1/seo/sprints/sprint-1/run',
      method: 'POST',
      requiresApproval: true,
    })
    expect(result.model.capabilities).toContain('inline-actions')
  })

  it('does not expose execution to members, paused sprints, autopilot-off sprints, or empty plans', async () => {
    const { seoSprintChatContextAdapter } = await import('@/lib/chat-context/adapters/seoSprint')
    for (const [role, overrides] of [
      ['client', {}],
      ['admin', { status: 'paused' }],
      ['admin', { autopilotMode: 'off' }],
      ['admin', { todayPlan: { due: [], inProgress: [] } }],
    ] as const) {
      mockSprintGet.mockResolvedValueOnce(sprint(overrides))
      const result = await seoSprintChatContextAdapter.resolve({
        kind: 'seo_sprint',
        id: 'sprint-1',
        user: { uid: 'u1', role, activeOrgId: 'org-1', orgId: 'org-1' },
      })
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(result.model.groups[0].items[0].actions).toBeUndefined()
      expect(result.model.capabilities).not.toContain('inline-actions')
    }
  })

  it('fails closed outside the caller organisation', async () => {
    const { seoSprintChatContextAdapter } = await import('@/lib/chat-context/adapters/seoSprint')
    const result = await seoSprintChatContextAdapter.resolve({
      kind: 'seo_sprint',
      id: 'sprint-1',
      user: { uid: 'admin-1', role: 'admin', activeOrgId: 'other-org', orgId: 'other-org' },
    })
    expect(result).toMatchObject({ ok: false, reason: 'not_found', status: 404 })
    expect(mockTaskGet).not.toHaveBeenCalled()
  })
})
