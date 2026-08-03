import {
  advanceWorkflowRun,
  bindKanbanTask,
  createWorkflowRunFromTemplate,
  inspectWorkflowRun,
} from '@/lib/workflow-graph/engine'
import {
  applyStuckEvaluation,
  buildOpsInspect,
  buildBlockAlertFact,
  buildQuietSuccessFact,
  computeThrashSignals,
  evaluateStuck,
  matchDomainEventTemplates,
  domainEventIdempotencyKey,
  shouldEmitBlockAlert,
  shouldEmitQuietSuccess,
  classifyOpsRunBucket,
  resolveAlert,
  bumpBlockRevisionOnAlertTransition,
} from '@/lib/workflow-graph/ops'
import { buildPilotResearchValidateDocApproveFanoutTemplate } from '@/lib/workflow-graph/pilot'
import { DEFAULT_SLA } from '@/lib/workflow-graph/constants'
import type { GraphTemplate, WorkflowRun } from '@/lib/workflow-graph/types'

const NOW = '2026-08-02T12:00:00.000Z'

function startPilotRun(): WorkflowRun {
  const template = buildPilotResearchValidateDocApproveFanoutTemplate({
    orgId: 'pib-platform-owner',
    projectId: 'proj-pilot',
  })
  template.id = 'tmpl-pilot'
  return createWorkflowRunFromTemplate({
    runId: 'wfr_ops_1',
    template,
    orgId: 'pib-platform-owner',
    projectId: 'proj-pilot',
    trigger: { type: 'manual', at: NOW },
    now: NOW,
    createdBy: 'theo',
  })
}

describe('workflow graph phase 2 ops', () => {
  test('inspect one-call includes cost strip, node table, gate map, thrash, evidence, timeline', () => {
    let run = startPilotRun()
    let step = advanceWorkflowRun(run, { type: 'tick', now: NOW })
    run = bindKanbanTask(step.run, 'research_brief', 'task-research', NOW)
    step = advanceWorkflowRun(run, {
      type: 'kanban_terminal',
      now: '2026-08-02T12:01:00.000Z',
      nodeId: 'research_brief',
      kanbanTaskId: 'task-research',
      outcome: 'done',
      evidence: [{ type: 'research_doc_id', ref: 'doc_1', at: '2026-08-02T12:01:00.000Z' }],
      tokensIn: 100,
      tokensOut: 50,
      tokensTotal: 150,
    })
    run = step.run

    const inspect = buildOpsInspect(run)
    expect(inspect.runId).toBe('wfr_ops_1')
    expect(inspect.identity.trigger.type).toBe('manual')
    expect(inspect.identity.templateId).toBe('tmpl-pilot')
    expect(inspect.cost.tokensTotal).toBe(150)
    expect(inspect.cost.budgetStatus).toBeDefined()
    expect(inspect.nodes.some((n) => n.nodeId === 'research_brief' && n.status === 'done')).toBe(true)
    expect(inspect.evidence.expectedVsPresent.length).toBeGreaterThan(0)
    expect(inspect.gateMap.some((g) => g.capability === 'publish')).toBe(true)
    expect(inspect.thrash).toBeDefined()
    expect(Array.isArray(inspect.timeline)).toBe(true)
    expect(inspect.timeline.length).toBeGreaterThan(0)
    expect(inspect.blocker?.code || inspect.blockedReasonCode || null).toBeDefined()
    // Compatible with Phase 1 inspect shape
    const base = inspectWorkflowRun(run)
    expect(base.status).toBe(inspect.status)
  })

  test('stuck SLA: agent waiting_watcher beyond heartbeat is stuck', () => {
    let run = startPilotRun()
    const step = advanceWorkflowRun(run, { type: 'tick', now: NOW })
    run = bindKanbanTask(step.run, 'research_brief', 'task-research', NOW)
    // Simulate long wait without transition
    const node = run.nodes.find((n) => n.nodeId === 'research_brief')!
    node.status = 'waiting_watcher'
    node.lastTransitionAt = NOW
    const later = new Date(Date.parse(NOW) + (DEFAULT_SLA.agentRunningHeartbeatMs! + 60_000)).toISOString()
    const stuck = evaluateStuck(run, later)
    expect(stuck.stuck).toBe(true)
    expect(stuck.stuckReasonCode).toMatch(/agent_heartbeat_stale|agent_running_stale/)
    expect(stuck.nodeId).toBe('research_brief')
    expect(stuck.suggestedAction).toBeTruthy()

    const applied = applyStuckEvaluation(run, later)
    expect(applied.stuckAt).toBeTruthy()
    expect(applied.stuckReasonCode).toBe(stuck.stuckReasonCode)
  })

  test('stuck SLA: queued_capacity is not stuck until 2h', () => {
    let run = startPilotRun()
    run.status = 'running'
    const node = run.nodes.find((n) => n.nodeId === 'research_brief')!
    node.status = 'queued_capacity'
    node.lastTransitionAt = NOW
    node.blockedReasonCode = 'concurrency_cap:run'
    const at1h = new Date(Date.parse(NOW) + 60 * 60_000).toISOString()
    expect(evaluateStuck(run, at1h).stuck).toBe(false)
    const at3h = new Date(Date.parse(NOW) + 3 * 60 * 60_000).toISOString()
    const stuck = evaluateStuck(run, at3h)
    expect(stuck.stuck).toBe(true)
    expect(stuck.stuckReasonCode).toBe('capacity_starvation')
  })

  test('paused_budget is ops-bucket paused not engineering stuck before 24h', () => {
    let run = startPilotRun()
    run.status = 'paused_budget'
    run.blockedReasonCode = 'budget_exceeded'
    run.updatedAt = NOW
    const at1h = new Date(Date.parse(NOW) + 60 * 60_000).toISOString()
    const stuck = evaluateStuck(run, at1h)
    expect(stuck.stuck).toBe(false)
    expect(classifyOpsRunBucket(run, at1h)).toBe('paused_budget')
    const at25h = new Date(Date.parse(NOW) + 25 * 60 * 60_000).toISOString()
    const overdue = evaluateStuck(run, at25h)
    expect(overdue.stuck).toBe(true)
    expect(overdue.stuckReasonCode).toBe('paused_budget_ops_sla')
  })

  test('quiet success does not emit block alert; block emits one deduped fact', () => {
    let run = startPilotRun()
    run.status = 'succeeded'
    run.notify = { quietSuccess: true, alertOnBlock: true }
    run.terminalReason = 'all_nodes_proven'
    expect(shouldEmitQuietSuccess(run)).toBe(false) // default quiet = no ops spam
    expect(shouldEmitBlockAlert(run)).toBe(false)

    run = startPilotRun()
    run.status = 'failed'
    run.blockedReasonCode = 'transient_infra_exhausted'
    run.notify = { quietSuccess: true, alertOnBlock: true }
    run.blockRevision = 1
    expect(shouldEmitBlockAlert(run)).toBe(true)
    const fact = buildBlockAlertFact(run, NOW)
    expect(fact.dedupeKey).toBe('wfr_ops_1:block:1')
    expect(fact.kind).toBe('block')
    // Second emit same revision must use same key (store-level dedupe)
    const fact2 = buildBlockAlertFact(run, NOW)
    expect(fact2.dedupeKey).toBe(fact.dedupeKey)

    run.blockRevision = 2
    const fact3 = buildBlockAlertFact(run, NOW)
    expect(fact3.dedupeKey).toBe('wfr_ops_1:block:2')
    expect(fact3.dedupeKey).not.toBe(fact.dedupeKey)
  })

  test('ops_feed success path emits quiet success fact when configured', () => {
    let run = startPilotRun()
    run.status = 'succeeded'
    run.notify = { quietSuccess: true, alertOnBlock: true, onSuccess: 'ops_feed' }
    expect(shouldEmitQuietSuccess(run)).toBe(true)
    const fact = buildQuietSuccessFact(run, NOW)
    expect(fact.kind).toBe('success_quiet')
    expect(fact.dedupeKey).toBe('wfr_ops_1:success')
  })

  test('thrash signals: retries >=3 and high spend low progress', () => {
    let run = startPilotRun()
    run.attempts.research_brief = [
      { attemptNumber: 1, idempotencyKey: 'a', status: 'blocked', errorFamily: 'transient_infra' },
      { attemptNumber: 2, idempotencyKey: 'b', status: 'blocked', errorFamily: 'transient_infra' },
      { attemptNumber: 3, idempotencyKey: 'c', status: 'blocked', errorFamily: 'transient_infra' },
    ]
    run.nodes.find((n) => n.nodeId === 'research_brief')!.currentAttempt = 3
    run.cost.tokensTotal = 1_200_000
    run.cost.maxTokensPerRun = 2_000_000
    // 0% nodes done
    const thrash = computeThrashSignals(run)
    expect(thrash.retriesAtLeast3.some((id) => id === 'research_brief')).toBe(true)
    expect(thrash.highSpendLowProgress).toBe(true)
    expect(thrash.signals.length).toBeGreaterThan(0)
  })

  test('domain event template match + idempotency key for >=3 event types', () => {
    const templates: GraphTemplate[] = [
      {
        ...buildPilotResearchValidateDocApproveFanoutTemplate({ orgId: 'pib-platform-owner' }),
        id: 't1',
        triggers: [{ type: 'domain_event', eventType: 'task.completed' }],
      },
      {
        ...buildPilotResearchValidateDocApproveFanoutTemplate({ orgId: 'pib-platform-owner' }),
        id: 't2',
        triggers: [{ type: 'domain_event', eventType: 'document.approved' }],
      },
      {
        ...buildPilotResearchValidateDocApproveFanoutTemplate({ orgId: 'pib-platform-owner' }),
        id: 't3',
        triggers: [{ type: 'domain_event', eventType: 'deal.stage_changed' }],
      },
      {
        ...buildPilotResearchValidateDocApproveFanoutTemplate({ orgId: 'pib-platform-owner' }),
        id: 't4',
        triggers: [{ type: 'domain_event', eventType: 'social.post_failed' }],
      },
      {
        ...buildPilotResearchValidateDocApproveFanoutTemplate({ orgId: 'pib-platform-owner' }),
        id: 't5',
        triggers: [{ type: 'manual' }],
      },
    ]

    expect(matchDomainEventTemplates(templates, 'task.completed').map((t) => t.id)).toEqual(['t1'])
    expect(matchDomainEventTemplates(templates, 'document.approved').map((t) => t.id)).toEqual(['t2'])
    expect(matchDomainEventTemplates(templates, 'deal.stage_changed').map((t) => t.id)).toEqual(['t3'])
    expect(matchDomainEventTemplates(templates, 'social.post_failed').map((t) => t.id)).toEqual(['t4'])
    expect(matchDomainEventTemplates(templates, 'unknown.event')).toEqual([])

    expect(domainEventIdempotencyKey({
      orgId: 'pib-platform-owner',
      templateId: 't1',
      eventType: 'task.completed',
      eventId: 'evt_123',
    })).toBe('domain:pib-platform-owner:t1:task.completed:evt_123')
  })

  test('human_gate SLA warn after 24h', () => {
    let run = startPilotRun()
    run.status = 'running'
    const gate = run.nodes.find((n) => n.nodeId === 'approve_publish_intent')!
    gate.status = 'awaiting_gate'
    gate.lastTransitionAt = NOW
    const at25h = new Date(Date.parse(NOW) + 25 * 60 * 60_000).toISOString()
    const stuck = evaluateStuck(run, at25h)
    expect(stuck.stuck).toBe(true)
    expect(stuck.stuckReasonCode).toMatch(/human_gate/)
  })

  test('classify ops buckets: blocked / stuck / paused_budget', () => {
    const run = startPilotRun()
    run.status = 'running'
    run.nodes.find((n) => n.kind === 'agent')!.status = 'blocked'
    run.nodes.find((n) => n.kind === 'agent')!.blockedReasonCode = 'missing_artifact:x'
    expect(classifyOpsRunBucket(run, NOW)).toBe('blocked')

    run.status = 'paused_budget'
    run.nodes.find((n) => n.kind === 'agent')!.status = 'pending'
    run.nodes.find((n) => n.kind === 'agent')!.blockedReasonCode = undefined
    run.blockedReasonCode = undefined
    expect(classifyOpsRunBucket(run, NOW)).toBe('paused_budget')

    run.status = 'running'
    run.blockedReasonCode = undefined
    for (const n of run.nodes) {
      n.status = 'pending'
      n.blockedReasonCode = undefined
    }
    run.stuckReasonCode = 'agent_heartbeat_stale'
    run.stuckAt = NOW
    expect(classifyOpsRunBucket(run, NOW)).toBe('stuck')
  })

  test('alert signature: missing_artifact stays one revision across status/stuck thrash', () => {
    let run = startPilotRun()
    run.status = 'running'
    run.notify = { quietSuccess: true, alertOnBlock: true }
    const agent = run.nodes.find((n) => n.kind === 'agent')!
    agent.status = 'blocked'
    agent.blockedReasonCode = 'missing_artifact:qa_probe_id'
    run.blockedReasonCode = 'missing_artifact:qa_probe_id'

    const alert1 = resolveAlert(run)!
    expect(alert1.kind).toBe('block')
    expect(alert1.reasonCode).toBe('missing_artifact:qa_probe_id')
    expect(alert1.signature).toBe('block:missing_artifact:qa_probe_id')

    // First transition from clean → alert
    const clean = startPilotRun()
    clean.notify = { quietSuccess: true, alertOnBlock: true }
    let next = bumpBlockRevisionOnAlertTransition(clean, run)
    expect(next.blockRevision).toBe(1)
    expect(next.lastAlertSignature).toBe('block:missing_artifact:qa_probe_id')

    // running → failed same code must NOT bump
    const failed = {
      ...next,
      status: 'failed' as const,
      terminalReason: 'blocked_without_open_paths',
      nodes: next.nodes.map((n) => ({ ...n })),
    }
    next = bumpBlockRevisionOnAlertTransition(next, failed)
    expect(next.blockRevision).toBe(1)

    // stuck set + clear while blocked must NOT bump or change signature
    const withStuck = {
      ...next,
      stuckReasonCode: 'run_no_transition',
      stuckAt: NOW,
      nodes: next.nodes.map((n) => ({ ...n })),
    }
    next = bumpBlockRevisionOnAlertTransition(next, withStuck)
    expect(next.blockRevision).toBe(1)
    expect(resolveAlert(withStuck)!.signature).toBe('block:missing_artifact:qa_probe_id')

    const stuckCleared = {
      ...next,
      stuckReasonCode: undefined,
      stuckAt: undefined,
      nodes: next.nodes.map((n) => ({ ...n })),
    }
    next = bumpBlockRevisionOnAlertTransition(next, stuckCleared)
    expect(next.blockRevision).toBe(1)

    const fact = buildBlockAlertFact(next, NOW)
    expect(fact.dedupeKey).toBe('wfr_ops_1:block:1')
    expect(fact.kind).toBe('block')
    expect(fact.reasonCode).toBe('missing_artifact:qa_probe_id')
    expect(fact.reasonCode).not.toBe('running')
  })

  test('never emit kind=block with reasonCode=running; node block code wins', () => {
    const run = startPilotRun()
    run.status = 'running'
    run.notify = { quietSuccess: true, alertOnBlock: true }
    run.blockedReasonCode = undefined
    const check = run.nodes.find((n) => n.kind === 'code_check') || run.nodes[0]
    check.status = 'blocked'
    check.blockedReasonCode = 'missing_artifact:qa_probe_id'

    const alert = resolveAlert(run)!
    expect(alert.reasonCode).toBe('missing_artifact:qa_probe_id')
    expect(alert.reasonCode).not.toBe('running')
    expect(alert.kind).toBe('block')

    const fact = buildBlockAlertFact({ ...run, blockRevision: 1 }, NOW)
    expect(fact.reasonCode).toBe('missing_artifact:qa_probe_id')
    expect(fact.kind).toBe('block')
  })

  test('stuck-only alert uses kind=stuck never block+running', () => {
    const run = startPilotRun()
    run.status = 'running'
    run.notify = { quietSuccess: true, alertOnBlock: true }
    run.stuckReasonCode = 'run_no_transition'
    run.stuckAt = NOW
    for (const n of run.nodes) {
      n.status = 'pending'
      n.blockedReasonCode = undefined
    }
    run.blockedReasonCode = undefined

    const alert = resolveAlert(run)!
    expect(alert.kind).toBe('stuck')
    expect(alert.reasonCode).toBe('run_no_transition')
    expect(alert.signature).toBe('stuck:run_no_transition')

    const fact = buildBlockAlertFact({ ...run, blockRevision: 1 }, NOW, alert)
    expect(fact.kind).toBe('stuck')
    expect(fact.reasonCode).toBe('run_no_transition')

    // Healthy in-progress with no stuck/block is not alert-worthy
    const healthy = startPilotRun()
    healthy.status = 'running'
    healthy.notify = { quietSuccess: true, alertOnBlock: true }
    expect(resolveAlert(healthy)).toBeNull()
    expect(shouldEmitBlockAlert(healthy)).toBe(false)
  })
})
