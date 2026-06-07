import { LOOP_REGISTRY, getLoopById, loopsByStatus, loopsRequiringApprovalGate } from '@/lib/loop-engine/registry'
import { explainTaskLoopReadiness, evidenceRequirementsForRisk } from '@/lib/loop-engine/readiness'

describe('loop engine registry', () => {
  it('defines the first operating loops with owners, gates, and evidence requirements', () => {
    expect(LOOP_REGISTRY.map((loop) => loop.id)).toEqual(expect.arrayContaining([
      'agent-task-watcher',
      'dependency-release',
      'approval-gate',
      'seo-to-crm-acquisition',
      'lead-response',
    ]))

    const approvalLoop = getLoopById('approval-gate')
    expect(approvalLoop).toEqual(expect.objectContaining({
      ownerAgentId: 'pip',
      reviewerAgentId: 'nora',
      riskLevel: 'critical',
    }))
    expect(approvalLoop?.approvalGates).toEqual(expect.arrayContaining(['client-visible', 'production-deploy', 'destructive-data']))
    expect(approvalLoop?.evidenceRequirements.join(' ')).toMatch(/approval/i)

    expect(loopsByStatus('active').length).toBeGreaterThanOrEqual(2)
    expect(loopsRequiringApprovalGate('client-visible').map((loop) => loop.id)).toEqual(expect.arrayContaining([
      'approval-gate',
      'seo-to-crm-acquisition',
      'lead-response',
    ]))
  })
})

describe('loop task readiness', () => {
  it('explains why an agent task is not ready to run', () => {
    const result = explainTaskLoopReadiness({
      id: 'task-1',
      title: 'Send client-facing draft',
      columnId: 'blocked',
      status: 'todo',
      assigneeAgentId: 'maya',
      agentStatus: 'awaiting-input',
      agentInput: { spec: '' },
      dependsOn: ['gate-1'],
      resolvedDependencyIds: [],
      riskLevel: 'critical',
      requiredCapability: 'message_client',
      approvalGateTaskId: 'gate-1',
      approvalGateStatus: 'pending',
    }, { now: new Date('2026-06-07T00:00:00.000Z') })

    expect(result.eligible).toBe(false)
    expect(result.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining([
      'not-in-todo',
      'agent-status-not-pending',
      'missing-spec',
      'unresolved-dependencies',
      'approval-missing',
    ]))
    expect(result.summary).toMatch(/not ready/i)
    expect(result.requiredEvidence).toEqual(expect.arrayContaining([
      'Human approval id and exact approval wording',
      'Rollback or stop condition',
    ]))
  })

  it('marks a valid low-risk pending task as eligible', () => {
    const result = explainTaskLoopReadiness({
      id: 'task-2',
      title: 'Summarize internal evidence',
      columnId: 'todo',
      status: 'todo',
      assigneeAgentId: 'sage',
      agentStatus: 'pending',
      agentInput: { spec: 'Summarize the internal evidence only.' },
      dependsOn: [],
      riskLevel: 'low',
    })

    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([{ code: 'eligible', label: 'Task is eligible for the agent loop', severity: 'ready' }])
    expect(result.requiredEvidence).toEqual(['Short summary', 'Artifact or source reference'])
  })

  it('uses stricter evidence for high and critical risk work', () => {
    expect(evidenceRequirementsForRisk('high')).toEqual(expect.arrayContaining(['Approval gate id or explicit reviewer decision']))
    expect(evidenceRequirementsForRisk('critical')).toEqual(expect.arrayContaining(['Reviewer or second-review owner']))
  })
})
