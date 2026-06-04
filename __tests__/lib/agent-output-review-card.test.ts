import { buildAgentOutputReviewCard } from '@/lib/agent-output-review-card'

describe('agent output review cards', () => {
  it('structures completed agent work into reviewer-facing sections and Peet next action', () => {
    const card = buildAgentOutputReviewCard({
      title: 'Theo: build structured review cards',
      assigneeAgentId: 'theo',
      reviewStatus: 'pending',
      columnId: 'review',
      agentInput: {
        context: {
          approvalGateTaskId: 'gate-1',
          sourceDocumentId: 'doc-123',
          sourceSpecVersion: 'approved-v1',
        },
      },
      agentOutput: {
        summary: 'Implemented the internal review card surface. Verification passed: npm run lint -- --file components/briefing/BriefingControlDesk.tsx\nBlocker: Production deploy remains separately gated.',
        artifacts: [
          { type: 'commit', ref: 'abc1234', label: 'Development commit' },
          { type: 'doc', ref: 'doc-123', label: 'Spec doc' },
        ],
      },
    })

    expect(card.summary).toContain('Implemented the internal review card surface')
    expect(card.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'commit', value: 'abc1234' }),
      expect.objectContaining({ kind: 'verification', value: 'npm run lint -- --file components/briefing/BriefingControlDesk.tsx' }),
    ]))
    expect(card.artifacts).toEqual([
      expect.objectContaining({ type: 'commit', label: 'Development commit', ref: 'abc1234' }),
      expect.objectContaining({ type: 'doc', label: 'Spec doc', ref: 'doc-123' }),
    ])
    expect(card.qualityChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Summary', status: 'pass' }),
      expect.objectContaining({ label: 'Evidence', status: 'pass' }),
      expect.objectContaining({ label: 'Approval gates', status: 'blocked' }),
    ]))
    expect(card.approvalGates).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Approval gate', value: 'gate-1' }),
      expect.objectContaining({ label: 'Production/external actions', status: 'blocked' }),
    ]))
    expect(card.nextAction).toBe('Peet should review the evidence, approve if it is correct, or send it back to the assigned agent with a change note.')
  })
})
