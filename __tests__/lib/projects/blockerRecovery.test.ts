import {
  buildBlockedTaskRecovery,
  evaluateUnblockReadiness,
  type BlockerComment,
  type BlockerTaskLike,
} from '@/lib/projects/blockerRecovery'

const baseTask: BlockerTaskLike = {
  id: 'task-1',
  title: 'Blocked implementation',
  columnId: 'blocked',
  agentStatus: 'blocked',
  assigneeAgentId: 'theo',
  agentInput: { spec: 'Ship the card recovery UX' },
}

const comment = (text: string, seconds: number): BlockerComment => ({
  text,
  userName: 'Theo',
  userRole: 'ai',
  createdAt: { _seconds: seconds, _nanoseconds: 0 },
})

describe('blocked task recovery helpers', () => {
  it('explains what is wrong, who can unblock, proof needed, and agent message from the latest blocker comment', () => {
    const recovery = buildBlockedTaskRecovery(baseTask, [
      comment('Older blocker: ignore this', 10),
      comment('Blocked: Waiting on Peet approval. Proof needed: screenshot of the approved layout. When resolved tell Theo: approval granted and screenshot attached.', 20),
    ])

    expect(recovery.isBlocked).toBe(true)
    expect(recovery.whatIsWrong).toContain('Waiting on Peet approval')
    expect(recovery.whoCanUnblock).toContain('Peet approval')
    expect(recovery.requiredEvidence).toContain('screenshot of the approved layout')
    expect(recovery.messageForAgent).toContain('approval granted and screenshot attached')
    expect(recovery.canShowUnblockAction).toBe(true)
  })

  it('uses agent output as unblock guidance when no blocker comment exists', () => {
    const recovery = buildBlockedTaskRecovery({
      ...baseTask,
      agentOutput: {
        summary: 'Cannot continue until API credentials are available. Evidence required: AI_API_KEY confirmed in Vercel. Message for agent: retry deployment verification.',
      },
    }, [])

    expect(recovery.whatIsWrong).toContain('Cannot continue until API credentials')
    expect(recovery.requiredEvidence).toContain('AI_API_KEY confirmed in Vercel')
    expect(recovery.messageForAgent).toContain('retry deployment verification')
  })

  it('marks human approval/input stalls as Needs Peet with the exact blocking reason and safe continue copy', () => {
    const recovery = buildBlockedTaskRecovery({
      ...baseTask,
      agentStatus: 'awaiting-input',
      columnId: 'blocked',
      agentOutput: {
        summary: 'Blocked: Needs Peet approval before production deploy. Exact blocker: release approval is missing. Proof needed: approval comment on the task. Message for agent: continue only after approved.',
      },
    }, [])

    expect(recovery.needsPeet).toBe(true)
    expect(recovery.blockingReason).toBe('release approval is missing')
    expect(recovery.continueActionLabel).toBe('Approve / continue safely')
    expect(recovery.messageForAgent).toContain('continue only after approved')
  })

  it('allows confirmation unblock only after dependencies and approval gates are satisfied', () => {
    const task = { ...baseTask, dependsOn: ['dep-1'], approvalGateTaskId: 'gate-1' }

    expect(evaluateUnblockReadiness(task, [
      { id: 'dep-1', title: 'Dependency', columnId: 'blocked', agentStatus: 'blocked' },
      { id: 'gate-1', title: 'Approval', columnId: 'review', approvalStatus: 'pending' },
    ])).toEqual({
      ready: false,
      reasons: [
        'Dependency “Dependency” is still blocked.',
        'Approval gate “Approval” is not approved yet.',
      ],
    })

    expect(evaluateUnblockReadiness(task, [
      { id: 'dep-1', title: 'Dependency', columnId: 'done', agentStatus: 'done' },
      { id: 'gate-1', title: 'Approval', columnId: 'done', approvalStatus: 'approved' },
    ])).toEqual({ ready: true, reasons: [] })
  })
})
