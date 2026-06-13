import { LOOP_REGISTRY, getLoopById, loopsByStatus, loopsRequiringApprovalGate } from '@/lib/loop-engine/registry'
import { isActionExecutableWithoutApproval } from '@/lib/loop-engine/actions'
import { evaluateLoopRun } from '@/lib/loop-engine/executor'
import { explainTaskLoopReadiness, evidenceRequirementsForRisk } from '@/lib/loop-engine/readiness'

describe('loop engine registry', () => {
  it('defines the first operating loops with owners, gates, and evidence requirements', () => {
    expect(LOOP_REGISTRY.map((loop) => loop.id)).toEqual(expect.arrayContaining([
      'agent-task-watcher',
      'dependency-release',
      'approval-gate',
      'seo-to-crm-acquisition',
      'lead-response',
      'agent-evolution-review',
      'business-insight-review',
    ]))

    const approvalLoop = getLoopById('approval-gate')
    expect(approvalLoop).toEqual(expect.objectContaining({
      ownerAgentId: 'pip',
      reviewerAgentId: 'nora',
      riskLevel: 'critical',
    }))
    expect(approvalLoop?.approvalGates).toEqual(expect.arrayContaining(['client-visible', 'production-deploy', 'destructive-data']))
    expect(approvalLoop?.evidenceRequirements.join(' ')).toMatch(/approval/i)
    expect(approvalLoop?.loopContract).toEqual(expect.objectContaining({
      stopCondition: expect.stringMatching(/approval/i),
      maxIterations: 1,
      noProgressPolicy: expect.stringMatching(/awaiting input/i),
    }))
    expect(approvalLoop?.positioning.buyerValue).toMatch(/Governed automation/i)

    expect(loopsByStatus('active').length).toBeGreaterThanOrEqual(2)
    expect(loopsRequiringApprovalGate('client-visible').map((loop) => loop.id)).toEqual(expect.arrayContaining([
      'approval-gate',
      'seo-to-crm-acquisition',
      'lead-response',
      'business-insight-review',
    ]))
  })

  it('defines guarded self-improvement and business-insight loops', () => {
    const evolutionLoop = getLoopById('agent-evolution-review')
    expect(evolutionLoop).toEqual(expect.objectContaining({
      name: 'Agent Evolution Review Loop',
      status: 'planned',
      ownerAgentId: 'pip',
      reviewerAgentId: 'qa-release',
      riskLevel: 'high',
      allowedActions: expect.arrayContaining(['read', 'draft', 'task-create', 'report']),
      approvalGates: ['human-review'],
    }))
    expect(evolutionLoop?.dataSources).toEqual(expect.arrayContaining([
      'agent runs',
      'review status',
      'agent output',
      'skill policy',
    ]))
    expect(evolutionLoop?.evidenceRequirements.join(' ')).toMatch(/repeated pattern/i)
    expect(evolutionLoop?.loopContract.verificationSignals.join(' ')).toMatch(/before\/after/i)
    expect(evolutionLoop?.loopContract.stopCondition).toMatch(/review card|task/i)

    const insightLoop = getLoopById('business-insight-review')
    expect(insightLoop).toEqual(expect.objectContaining({
      name: 'Business Insight Review Loop',
      status: 'planned',
      ownerAgentId: 'pip',
      reviewerAgentId: 'nora',
      riskLevel: 'high',
      allowedActions: expect.arrayContaining(['read', 'draft', 'task-create', 'report']),
      approvalGates: expect.arrayContaining(['human-review', 'client-visible', 'public-publishing', 'paid-spend', 'finance']),
    }))
    expect(insightLoop?.dataSources).toEqual(expect.arrayContaining([
      'CRM contacts/deals',
      'SEO sprints',
      'ad campaigns',
      'support tickets',
      'agent outputs',
    ]))
    expect(insightLoop?.evidenceRequirements.join(' ')).toMatch(/metric snapshot/i)
    expect(insightLoop?.loopContract.noProgressPolicy).toMatch(/suppress/i)
    expect(insightLoop?.positioning.buyerValue).toMatch(/proactive/i)
  })
})

describe('loop execution engine', () => {
  it('creates dry-run lead-response proposals without executing client-visible work', () => {
    const run = evaluateLoopRun({
      loopId: 'lead-response',
      orgId: 'pib-platform-owner',
      dryRun: true,
      now: new Date('2026-06-07T00:00:00.000Z'),
      idempotencyKey: 'lead-demo',
      candidates: [{
        id: 'lead-1',
        type: 'lead',
        title: 'New website lead',
        riskLevel: 'critical',
        requiredCapability: 'message_client',
      }],
    })

    expect(run.id).toBe('lead-response:lead-demo')
    expect(run.status).toBe('awaiting_approval')
    expect(run.proposedActions.map((action) => action.kind)).toEqual(expect.arrayContaining(['task-create', 'message-draft']))
    expect(run.executedActions).toEqual([])
    expect(run.approvalGates).toEqual(expect.arrayContaining(['client-visible']))
    expect(run.decision).toMatch(/approval/i)
    expect(run.observability).toEqual(expect.objectContaining({
      progressSignal: 'awaiting-approval',
      needsHumanJudgment: true,
      budgetStatus: 'within-budget',
    }))

    const draftAction = run.proposedActions.find((action) => action.kind === 'message-draft')
    expect(draftAction).toEqual(expect.objectContaining({ mode: 'draft-only' }))
    expect(draftAction && isActionExecutableWithoutApproval(draftAction)).toBe(false)
  })

  it('executes only safe internal actions when dryRun is false', () => {
    const run = evaluateLoopRun({
      loopId: 'review-pileup',
      orgId: 'pib-platform-owner',
      dryRun: false,
      now: new Date('2026-06-07T00:00:00.000Z'),
      idempotencyKey: 'review-demo',
      candidates: [{
        id: 'review-1',
        type: 'review-item',
        title: 'Review completed internal task',
        taskId: 'task-1',
        riskLevel: 'medium',
      }],
    })

    expect(run.status).toBe('executed')
    expect(run.executedActions).toHaveLength(1)
    expect(run.executedActions[0]).toEqual(expect.objectContaining({ kind: 'task-review', mode: 'safe-auto' }))
    expect(run.decision).toMatch(/safe internal actions/i)
    expect(run.observability).toEqual(expect.objectContaining({
      progressSignal: 'advanced',
      noOpStreak: 0,
      lastMeaningfulAction: 'Route stale review item',
    }))
  })

  it('keeps dependency release behind approval gates for sensitive work', () => {
    const run = evaluateLoopRun({
      loopId: 'dependency-release',
      orgId: 'pib-platform-owner',
      dryRun: false,
      now: new Date('2026-06-07T00:00:00.000Z'),
      idempotencyKey: 'release-demo',
      candidates: [{
        id: 'task-2',
        type: 'task',
        title: 'Publish approved page',
        taskId: 'task-2',
        riskLevel: 'high',
        requiredCapability: 'publish',
        approvalGateStatus: 'approved',
        task: {
          columnId: 'todo',
          status: 'todo',
          assigneeAgentId: 'maya',
          agentStatus: 'pending',
          agentInput: { spec: 'Prepare publish checklist.' },
          dependsOn: [],
        },
      }],
    })

    expect(run.status).toBe('awaiting_approval')
    expect(run.executedActions).toEqual([])
    expect(run.proposedActions[0]).toEqual(expect.objectContaining({ mode: 'approval-required' }))
    expect(run.approvalGates).toEqual(expect.arrayContaining(['public-publishing']))
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
