import { hasApprovalGateMarker, reconcileApprovalGateUpdate } from '@/lib/projects/approvalState'

describe('approval gate state reconciliation', () => {
  const gate = {
    labels: ['approval-gate'],
    approvalGate: 'production-deploy',
    approvalStatus: 'pending',
    columnId: 'todo',
    agentStatus: 'awaiting-input',
    reviewStatus: 'pending',
  }

  it('detects approval gate markers from labels, gate field, or status', () => {
    expect(hasApprovalGateMarker({ labels: ['approval-gate'] })).toBe(true)
    expect(hasApprovalGateMarker({ approvalGate: 'finance' })).toBe(true)
    expect(hasApprovalGateMarker({ approvalStatus: 'pending' })).toBe(true)
    expect(hasApprovalGateMarker({ title: 'Ordinary' })).toBe(false)
  })

  it('treats requiredCapability=approve as an approval gate marker', () => {
    expect(hasApprovalGateMarker({ requiredCapability: 'approve' })).toBe(true)
    expect(hasApprovalGateMarker({ requiredCapability: 'Approve' })).toBe(true)
    expect(hasApprovalGateMarker({ requiredCapability: 'engineering' })).toBe(false)
  })

  it('aligns Done/review/agent when approvalStatus becomes approved', () => {
    const result = reconcileApprovalGateUpdate(gate, { approvalStatus: 'approved' }, { approvalStatus: 'approved' }, true)
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        approvalStatus: 'approved',
        columnId: 'done',
        reviewStatus: 'approved',
        agentStatus: 'done',
      }),
    })
  })

  it('rejects Done without canonical approval', () => {
    const result = reconcileApprovalGateUpdate(gate, { columnId: 'done' }, { columnId: 'done' }, true)
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      status: 400,
      error: expect.stringMatching(/approvalStatus=approved/),
    }))
  })

  it('rejects agentStatus=done while approval is still pending', () => {
    const result = reconcileApprovalGateUpdate(
      gate,
      { agentStatus: 'done', columnId: 'review' },
      { agentStatus: 'done' },
      true,
    )
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 400 }))
  })

  it('aligns rejection away from Done', () => {
    const result = reconcileApprovalGateUpdate(
      { ...gate, columnId: 'done', approvalStatus: 'pending' },
      { approvalStatus: 'rejected' },
      { approvalStatus: 'rejected' },
      true,
    )
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        approvalStatus: 'rejected',
        columnId: 'todo',
        reviewStatus: 'changes-requested',
        agentStatus: 'pending',
      }),
    })
  })

  it('is a no-op pass-through for non-gate tasks', () => {
    const result = reconcileApprovalGateUpdate(
      { title: 'Ordinary' },
      { columnId: 'done', agentStatus: 'done' },
      { columnId: 'done' },
      false,
    )
    expect(result).toEqual({
      ok: true,
      value: { columnId: 'done', agentStatus: 'done' },
    })
  })
})
