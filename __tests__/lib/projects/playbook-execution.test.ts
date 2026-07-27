const mockCollection = jest.fn()
const mockRunTransaction = jest.fn()
const mockTransactionGet = jest.fn()
const mockTransactionSet = jest.fn()
const mockTransactionUpdate = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (...args: unknown[]) => mockCollection(...args),
    runTransaction: (...args: unknown[]) => mockRunTransaction(...args),
  },
}))

jest.mock('@/lib/projects/planningDiscovery', () => ({
  planningMutationBlocker: jest.fn(() => null),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    increment: jest.fn((value: number) => ({ increment: value })),
  },
}))

function ref(path: string) {
  return { path, id: path.split('/').pop() }
}

function agentStep(overrides: Record<string, unknown> = {}) {
  return {
    stepId: 'build', title: 'Build', assigneeAgentId: 'theo', agentInput: { spec: 'Build it' },
    reviewerAgentId: 'qa-release', requiredCapability: 'engineering', riskLevel: 'high',
    expectedArtifacts: ['tested change'], verifierChecklist: ['Tests pass'], ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  let taskSequence = 0
  const projectRef = {
    path: 'projects/project-1',
    collection: jest.fn((name: string) => ({
      doc: jest.fn((id?: string) => ref(`projects/project-1/${name}/${id ?? `task-${++taskSequence}`}`)),
    })),
  }
  mockCollection.mockImplementation((name: string) => ({
    doc: jest.fn((id: string) => name === 'projects' && id === 'project-1' ? projectRef : ref(`${name}/${id}`)),
  }))
  mockTransactionGet.mockResolvedValue({ exists: false, data: () => undefined })
  mockRunTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    get: mockTransactionGet,
    set: mockTransactionSet,
    update: mockTransactionUpdate,
  }))
})

describe('runProjectPlaybookTemplate', () => {
  it('preallocates forward dependency ids and atomically writes an execution-ready gated run', async () => {
    const { runProjectPlaybookTemplate } = await import('@/lib/projects/playbooks')
    const result = await runProjectPlaybookTemplate({
      projectId: 'project-1', playbookId: 'release', actorUid: 'agent:pip', runKey: 'request-123',
      project: { orgId: 'authoritative-org' },
      playbook: {
        title: 'Release',
        template: { steps: [
          agentStep({ stepId: 'verify', title: 'Verify', dependsOnStepIds: ['build'] }),
          agentStep(),
          {
            stepId: 'approve', taskKind: 'approval-gate', title: 'Approve release',
            approvalGate: 'production-deploy', riskLevel: 'critical', expectedArtifacts: ['approval evidence'],
            verifierChecklist: ['Confirm release scope'],
          },
          agentStep({
            stepId: 'deploy', title: 'Deploy', requiredCapability: 'deploy', riskLevel: 'critical',
            approvalGateStepId: 'approve', expectedArtifacts: ['deployment evidence'],
          }),
        ] },
      },
    })

    expect(result).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ deduplicated: false, taskCount: 4 }) }))
    expect(mockRunTransaction).toHaveBeenCalledTimes(1)
    const taskWrites = mockTransactionSet.mock.calls.filter(([writtenRef]) => String(writtenRef.path).includes('/tasks/'))
    expect(taskWrites).toHaveLength(4)
    const byStep = new Map(taskWrites.map(([writtenRef, value]) => [value.sourcePlaybookStepId, { id: String(writtenRef.path).split('/').pop(), value }]))
    expect(byStep.get('verify')?.value).toEqual(expect.objectContaining({
      orgId: 'authoritative-org', dependsOn: [byStep.get('build')?.id], assigneeAgentId: 'theo',
      agentInput: expect.objectContaining({ spec: 'Build it' }), requiredCapability: 'engineering',
      reviewerAgentId: 'qa-release', riskLevel: 'high', expectedArtifacts: ['tested change'], verifierChecklist: ['Tests pass'],
    }))
    expect(byStep.get('approve')?.value).toEqual(expect.objectContaining({
      columnId: 'todo', approvalGate: 'production-deploy', approvalStatus: 'pending', labels: expect.arrayContaining(['approval-gate']),
    }))
    expect(byStep.get('deploy')?.value).toEqual(expect.objectContaining({
      columnId: 'blocked', agentStatus: 'awaiting-input', approvalGateTaskId: byStep.get('approve')?.id,
      dependsOn: [byStep.get('approve')?.id],
    }))
    expect(mockTransactionSet.mock.calls.some(([writtenRef]) => String(writtenRef.path).includes('/playbookRuns/'))).toBe(true)
    expect(mockTransactionSet.mock.calls.some(([writtenRef]) => String(writtenRef.path).includes('/audit/'))).toBe(true)
    expect(mockTransactionUpdate).toHaveBeenCalledTimes(1)
  })

  it('returns a supplied run key idempotently without writing duplicate tasks', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ playbookId: 'release', createdTaskIds: ['task-existing'], taskCount: 1 }),
    })
    const { runProjectPlaybookTemplate } = await import('@/lib/projects/playbooks')
    const result = await runProjectPlaybookTemplate({
      projectId: 'project-1', playbookId: 'release', actorUid: 'agent:pip', runKey: 'request-123',
      project: { orgId: 'authoritative-org' }, playbook: { template: { steps: [agentStep()] } },
    })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      data: expect.objectContaining({ createdTaskIds: ['task-existing'], taskCount: 1, deduplicated: true }),
    }))
    expect(mockTransactionSet).not.toHaveBeenCalled()
    expect(mockTransactionUpdate).not.toHaveBeenCalled()
  })

  it('rejects invalid gate references before starting a transaction', async () => {
    const { runProjectPlaybookTemplate } = await import('@/lib/projects/playbooks')
    const result = await runProjectPlaybookTemplate({
      projectId: 'project-1', playbookId: 'release', actorUid: 'agent:pip', project: { orgId: 'authoritative-org' },
      playbook: { template: { steps: [agentStep({ approvalGateStepId: 'missing' })] } },
    })
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 400 }))
    expect(mockRunTransaction).not.toHaveBeenCalled()
    expect(mockTransactionSet).not.toHaveBeenCalled()
  })
})