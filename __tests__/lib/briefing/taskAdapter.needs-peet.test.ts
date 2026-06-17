jest.mock('firebase-admin/firestore', () => ({
  Timestamp: class MockTimestamp {},
}))

jest.mock('@/lib/software-build-evidence', () => ({
  getSoftwareBuildEvidenceRows: jest.fn(() => []),
}))

import { taskAdapter } from '@/lib/briefing/adapters/taskAdapter'

describe('taskAdapter Needs Peet stalled task cards', () => {
  it('puts awaiting-input agent tasks into Needs Peet with exact blocker metadata and safe continue copy', () => {
    const item = taskAdapter.toItem({
      id: 'task-1',
      orgId: 'pib-platform-owner',
      projectId: 'project-1',
      columnId: 'blocked',
      title: 'Deploy approval gate',
      assigneeAgentId: 'theo',
      agentStatus: 'awaiting-input',
      blockedReason: 'release approval is missing',
      agentOutput: { summary: 'Blocked: Exact blocker: release approval is missing. Proof needed: task approval comment. Message for agent: continue after approval.' },
      updatedAt: '2026-06-16T10:00:00.000Z',
    }, 'task-1')

    expect(item).toMatchObject({
      priority: 'needs-peet',
      title: 'Needs Peet: Deploy approval gate',
      summary: expect.stringContaining('release approval is missing'),
      metadata: expect.objectContaining({
        blockingReason: 'release approval is missing',
        safeContinuePath: expect.stringContaining('Approval'),
      }),
    })
  })
})
