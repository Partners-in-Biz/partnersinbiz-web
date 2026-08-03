import {
  advanceWorkflowRun,
  bindKanbanTask,
  createWorkflowRunFromTemplate,
  inspectWorkflowRun,
  isNodeProvenReady,
  mapCapabilityToHumanGateApprovalGate,
  shouldMaterializeKind,
} from '@/lib/workflow-graph/engine'
import {
  buildPilotResearchValidateDocApproveFanoutTemplate,
  buildTinyBudgetPilotTemplate,
} from '@/lib/workflow-graph/pilot'
import { promotePlaybookTemplateToGraphTemplate } from '@/lib/workflow-graph/playbook-promote'
import { buildProjectTaskCreateData } from '@/lib/projects/taskPayload'
import { normalizeGraphTemplate, validateGraphTemplate, attemptIdempotencyKey } from '@/lib/workflow-graph/validation'
import type { WorkflowRun } from '@/lib/workflow-graph/types'

const NOW = '2026-08-02T12:00:00.000Z'
const LATER = '2026-08-02T12:05:00.000Z'

function startPilotRun(overrides?: { maxTokensPerRun?: number; maxConcurrent?: number }): WorkflowRun {
  const template = buildPilotResearchValidateDocApproveFanoutTemplate({
    orgId: 'pib-platform-owner',
    projectId: 'proj-pilot',
  })
  if (overrides?.maxTokensPerRun !== undefined) {
    template.budgets.maxTokensPerRun = overrides.maxTokensPerRun
  }
  if (overrides?.maxConcurrent !== undefined) {
    template.limits.maxConcurrentAgentNodes = overrides.maxConcurrent
  }
  template.id = 'tmpl-pilot'
  return createWorkflowRunFromTemplate({
    runId: 'wfr_pilot_1',
    template,
    orgId: 'pib-platform-owner',
    projectId: 'proj-pilot',
    trigger: { type: 'manual', at: NOW },
    now: NOW,
    createdBy: 'theo',
  })
}

function completeAgent(
  run: WorkflowRun,
  nodeId: string,
  taskId: string,
  artifacts: Array<{ type: string; ref: string }>,
  tokens = 10,
): WorkflowRun {
  const result = advanceWorkflowRun(run, {
    type: 'kanban_terminal',
    now: LATER,
    nodeId,
    kanbanTaskId: taskId,
    outcome: 'done',
    evidence: artifacts.map((a) => ({ ...a, at: LATER })),
    tokensIn: tokens,
    tokensOut: tokens,
    tokensTotal: tokens * 2,
    summary: 'ok',
  })
  return result.run
}

describe('workflow graph phase 1 engine', () => {
  test('pilot template validates and only agent/human_gate materialize', () => {
    const template = buildPilotResearchValidateDocApproveFanoutTemplate()
    const validated = validateGraphTemplate(template)
    expect(validated.ok).toBe(true)

    const materializing = template.nodes.filter((node) => shouldMaterializeKind(node.kind))
    const ledgerOnly = template.nodes.filter((node) => !shouldMaterializeKind(node.kind))
    expect(materializing.map((n) => n.kind).every((k) => k === 'agent' || k === 'human_gate')).toBe(true)
    expect(ledgerOnly.some((n) => n.kind === 'code_check')).toBe(true)
    expect(ledgerOnly.some((n) => n.kind === 'system')).toBe(true)
    // materialization law: code_check + system never on kanban
    expect(ledgerOnly.every((n) => n.kind !== 'agent' && n.kind !== 'human_gate')).toBe(true)
  })

  test('golden path: research → checks → draft → gate → gated system → fan-out → succeed quiet', () => {
    let run = startPilotRun()
    let step = advanceWorkflowRun(run, { type: 'tick', now: NOW })
    run = step.run

    // Only first agent materializes
    expect(step.materialize.map((m) => m.nodeId)).toEqual(['research_brief'])
    expect(step.materialize[0].kind).toBe('agent')
    expect(step.materialize[0].labels.some((l) => l.startsWith('workflow-run:'))).toBe(true)
    expect(run.status).toBe('running')

    run = bindKanbanTask(run, 'research_brief', 'task-research', NOW)
    run = completeAgent(run, 'research_brief', 'task-research', [
      { type: 'research_doc_id', ref: 'doc_research_1' },
    ])

    // code_check auto-runs on tick after agent done
    step = advanceWorkflowRun(run, {
      type: 'tick',
      now: LATER,
      artifactPresence: { research_doc_id: true },
    })
    run = step.run
    expect(run.nodes.find((n) => n.nodeId === 'check_research')?.status).toBe('done')

    // draft agent materializes
    expect(step.materialize.map((m) => m.nodeId)).toContain('draft_build_note')
    run = bindKanbanTask(run, 'draft_build_note', 'task-draft', LATER)
    run = completeAgent(run, 'draft_build_note', 'task-draft', [
      { type: 'draft_doc_id', ref: 'doc_draft_1' },
    ])

    step = advanceWorkflowRun(run, {
      type: 'tick',
      now: LATER,
      artifactPresence: { draft_doc_id: true },
    })
    run = step.run
    expect(run.nodes.find((n) => n.nodeId === 'check_draft')?.status).toBe('done')

    // human gate materializes (not agent) with Kanban-valid approvalGate
    const gateIntent = step.materialize.find((m) => m.nodeId === 'approve_publish_intent' && m.kind === 'human_gate')
    expect(gateIntent).toBeTruthy()
    expect(gateIntent?.requiredCapability).toBe('publish')
    expect(gateIntent?.approvalGate).toBe('public-publishing')
    expect(gateIntent?.approvalGate).not.toBe('publish')
    expect(gateIntent?.approvalGate).not.toBe('approval')
    // Must survive taskPayload cleanApprovalGate (live invalid_spec / materialize-failed root cause)
    const gateTaskPayload = buildProjectTaskCreateData({
      title: gateIntent!.title,
      columnId: gateIntent!.columnId,
      agentStatus: gateIntent!.agentStatus,
      requiredCapability: gateIntent!.requiredCapability,
      riskLevel: gateIntent!.riskLevel,
      approvalGate: gateIntent!.approvalGate,
      expectedArtifacts: gateIntent!.expectedArtifacts,
      verifierChecklist: gateIntent!.verifierChecklist,
      labels: gateIntent!.labels,
    }, 'proj-pilot', 'pib-platform-owner')
    expect(gateTaskPayload.ok).toBe(true)
    if (gateTaskPayload.ok) {
      expect(gateTaskPayload.value.approvalGate).toBe('public-publishing')
      expect(gateTaskPayload.value.requiredCapability).toBe('publish')
    }
    run = bindKanbanTask(run, 'approve_publish_intent', 'task-gate', LATER)

    // Approve gate via kanban done + approval ref
    step = advanceWorkflowRun(run, {
      type: 'approval_granted',
      now: LATER,
      approval: {
        capability: 'publish',
        resourceIds: ['pilot'],
        approvedBy: 'peet',
        at: LATER,
        ref: 'apr_1',
      },
    })
    run = step.run
    run = completeAgent(run, 'approve_publish_intent', 'task-gate', [
      { type: 'approval_ref', ref: 'apr_1' },
    ])

    // gated system needs systemResults
    step = advanceWorkflowRun(run, {
      type: 'tick',
      now: LATER,
      systemResults: {
        noop_publish_system: {
          ok: true,
          evidence: [{ type: 'publish_noop_receipt', ref: 'receipt_1', at: LATER }],
        },
      },
    })
    run = step.run
    expect(run.nodes.find((n) => n.nodeId === 'noop_publish_system')?.status).toBe('done')

    // fan-out both agents
    expect(step.materialize.map((m) => m.nodeId).sort()).toEqual(['content_checklist', 'eng_checklist'])
    run = bindKanbanTask(run, 'eng_checklist', 'task-eng', LATER)
    run = bindKanbanTask(run, 'content_checklist', 'task-content', LATER)
    run = completeAgent(run, 'eng_checklist', 'task-eng', [{ type: 'eng_checklist_id', ref: 'eng_1' }])
    run = completeAgent(run, 'content_checklist', 'task-content', [{ type: 'content_checklist_id', ref: 'cnt_1' }])

    step = advanceWorkflowRun(run, {
      type: 'tick',
      now: LATER,
      artifactPresence: {
        eng_checklist_id: true,
        content_checklist_id: true,
      },
    })
    run = step.run

    expect(run.nodes.find((n) => n.nodeId === 'check_fanout')?.status).toBe('done')
    expect(run.status).toBe('succeeded')
    expect(run.terminalReason).toBe('all_nodes_proven')
    // Quiet success: notify stays quietSuccess true, no forced CEO fields
    expect(run.notify.quietSuccess).toBe(true)

    const inspect = inspectWorkflowRun(run)
    expect(inspect.status).toBe('succeeded')
    expect(inspect.nodes.every((n) => n.status === 'done')).toBe(true)
    expect(inspect.gateMap.some((g) => g.capability === 'publish' && g.hasApproval)).toBe(true)
  })

  test('fail-closed: agent done without expected artifact is not false-done', () => {
    let run = startPilotRun()
    let step = advanceWorkflowRun(run, { type: 'tick', now: NOW })
    run = bindKanbanTask(step.run, 'research_brief', 'task-research', NOW)

    step = advanceWorkflowRun(run, {
      type: 'kanban_terminal',
      now: LATER,
      nodeId: 'research_brief',
      kanbanTaskId: 'task-research',
      outcome: 'done',
      summary: 'I totally did the research (narrative only)',
      // no evidence
    })
    run = step.run
    const node = run.nodes.find((n) => n.nodeId === 'research_brief')
    expect(node?.status).toBe('blocked')
    expect(node?.blockedReasonCode).toMatch(/^missing_artifact:/)
    expect(run.status).not.toBe('succeeded')
    // Downstream must not materialize
    expect(step.materialize.find((m) => m.nodeId === 'draft_build_note')).toBeUndefined()
  })

  test('fail-closed: gated system without approvalRef stays awaiting_gate', () => {
    const template = normalizeGraphTemplate({
      orgId: 'pib-platform-owner',
      name: 'gate-only',
      status: 'active',
      nodes: [
        {
          nodeId: 'publish_it',
          kind: 'system',
          name: 'Publish',
          dependsOnNodeIds: [],
          systemAction: 'system:publish_social',
          requiredCapability: 'publish',
        },
      ],
    })
    template.id = 'tmpl-gate'
    let run = createWorkflowRunFromTemplate({
      runId: 'wfr_gate',
      template,
      orgId: 'pib-platform-owner',
      projectId: 'proj',
      trigger: { type: 'manual', at: NOW },
      now: NOW,
    })

    const step = advanceWorkflowRun(run, {
      type: 'tick',
      now: NOW,
      systemResults: {
        publish_it: { ok: true, evidence: [{ type: 'x', ref: 'y', at: NOW }] },
      },
    })
    run = step.run
    const node = run.nodes.find((n) => n.nodeId === 'publish_it')
    expect(node?.status).toBe('awaiting_gate')
    expect(node?.blockedReasonCode).toBe('waiting_human_gate:publish')
    // systemResults must not execute without gate
    expect(node?.status).not.toBe('done')
  })

  test('fail-closed: tiny budget pauses before next agent claim', () => {
    const template = buildTinyBudgetPilotTemplate()
    template.id = 'tmpl-budget'
    let run = createWorkflowRunFromTemplate({
      runId: 'wfr_budget',
      template,
      orgId: 'pib-platform-owner',
      projectId: 'proj',
      trigger: { type: 'manual', at: NOW },
      now: NOW,
    })

    let step = advanceWorkflowRun(run, { type: 'tick', now: NOW })
    run = bindKanbanTask(step.run, 'a1', 't1', NOW)
    step = advanceWorkflowRun(run, {
      type: 'kanban_terminal',
      now: LATER,
      nodeId: 'a1',
      kanbanTaskId: 't1',
      outcome: 'done',
      evidence: [{ type: 'a_art', ref: 'a', at: LATER }],
      tokensTotal: 150,
      tokensIn: 100,
      tokensOut: 50,
    })
    run = step.run
    expect(run.cost.budgetStatus).toBe('exceeded')

    step = advanceWorkflowRun(run, { type: 'tick', now: LATER })
    run = step.run
    expect(run.status).toBe('paused_budget')
    const a2 = run.nodes.find((n) => n.nodeId === 'a2')
    expect(a2?.status).toBe('queued_capacity')
    expect(a2?.blockedReasonCode).toBe('budget_exceeded')
    expect(step.materialize.find((m) => m.nodeId === 'a2')).toBeUndefined()
  })

  test('concurrency: per-run cap queues rather than fails', () => {
    const template = normalizeGraphTemplate({
      orgId: 'pib-platform-owner',
      name: 'fan',
      status: 'active',
      limits: { maxConcurrentAgentNodes: 1 },
      nodes: [
        {
          nodeId: 'p1',
          kind: 'agent',
          name: 'P1',
          dependsOnNodeIds: [],
          assigneeAgentId: 'theo',
          expectedArtifacts: ['x'],
          agentInput: { spec: 'p1' },
        },
        {
          nodeId: 'p2',
          kind: 'agent',
          name: 'P2',
          dependsOnNodeIds: [],
          assigneeAgentId: 'maya',
          expectedArtifacts: ['y'],
          agentInput: { spec: 'p2' },
        },
      ],
    })
    template.id = 'tmpl-fan'
    let run = createWorkflowRunFromTemplate({
      runId: 'wfr_fan',
      template,
      orgId: 'pib-platform-owner',
      projectId: 'proj',
      trigger: { type: 'manual', at: NOW },
      now: NOW,
    })

    let step = advanceWorkflowRun(run, { type: 'tick', now: NOW })
    // first materialize one, bind it into waiting_watcher (in-flight)
    expect(step.materialize.length).toBeGreaterThanOrEqual(1)
    const first = step.materialize[0].nodeId
    run = bindKanbanTask(step.run, first, 'task-first', NOW)
    // mark first as running/in-flight for concurrency accounting
    const firstNode = run.nodes.find((n) => n.nodeId === first)!
    firstNode.status = 'running'

    step = advanceWorkflowRun(run, { type: 'tick', now: LATER })
    run = step.run
    const secondId = first === 'p1' ? 'p2' : 'p1'
    const second = run.nodes.find((n) => n.nodeId === secondId)
    expect(second?.status).toBe('queued_capacity')
    expect(second?.blockedReasonCode).toBe('concurrency_cap:run')
    expect(run.status).not.toBe('failed')
  })

  test('idempotent attempt keys are stable per run/node/attempt', () => {
    expect(attemptIdempotencyKey('r1', 'n1', 1)).toBe('r1:n1:1')
    expect(attemptIdempotencyKey('r1', 'n1', 2)).toBe('r1:n1:2')
  })

  test('proven-ready requires deps + clear gates', () => {
    let run = startPilotRun()
    run = advanceWorkflowRun(run, { type: 'tick', now: NOW }).run
    expect(isNodeProvenReady(run, 'research_brief').ready).toBe(true)
    expect(isNodeProvenReady(run, 'draft_build_note').ready).toBe(false)
    expect(isNodeProvenReady(run, 'draft_build_note').reasons).toContain('deps_not_proven')
  })

  test('playbook promotion maps approval-gate to human_gate without dual board kinds', () => {
    const promoted = promotePlaybookTemplateToGraphTemplate({
      orgId: 'pib-platform-owner',
      name: 'from-playbook',
      playbookId: 'pb1',
      projectId: 'proj1',
      playbookTemplate: {
        schemaVersion: 1,
        steps: [
          {
            stepId: 's1',
            taskKind: 'agent',
            title: 'Do work',
            assigneeAgentId: 'theo',
            agentInput: { spec: 'work' },
            dependsOnStepIds: [],
            reviewerAgentId: 'pip',
            requiredCapability: 'engineering',
            riskLevel: 'low',
            expectedArtifacts: ['commit'],
            verifierChecklist: ['tests green'],
            labels: [],
          },
          {
            stepId: 's2',
            taskKind: 'approval-gate',
            title: 'Approve',
            dependsOnStepIds: ['s1'],
            approvalGate: 'publish',
            requiredCapability: 'publish',
            riskLevel: 'high',
            expectedArtifacts: ['approval'],
            verifierChecklist: ['scoped'],
            labels: [],
          },
        ],
      },
    })
    expect(promoted.ok).toBe(true)
    if (!promoted.ok) return
    expect(promoted.template.nodes.find((n) => n.nodeId === 's2')?.kind).toBe('human_gate')
    expect(promoted.template.sourcePlaybookId).toBe('pb1')
    expect(promoted.template.nodes.every((n) => n.kind === 'agent' || n.kind === 'human_gate')).toBe(true)
  })

  test('cancel is terminal and stops materialization', () => {
    let run = startPilotRun()
    run = advanceWorkflowRun(run, { type: 'tick', now: NOW }).run
    const cancelled = advanceWorkflowRun(run, { type: 'cancel', now: LATER, reason: 'operator_cancel' })
    expect(cancelled.run.status).toBe('cancelled')
    expect(cancelled.materialize).toEqual([])
    const again = advanceWorkflowRun(cancelled.run, { type: 'tick', now: LATER })
    expect(again.materialize).toEqual([])
  })

  test('human_gate approvalGate maps capability aliases to VALID_APPROVAL_GATES (not publish/approval)', () => {
    expect(mapCapabilityToHumanGateApprovalGate('publish')).toBe('public-publishing')
    expect(mapCapabilityToHumanGateApprovalGate('spend')).toBe('paid-spend')
    expect(mapCapabilityToHumanGateApprovalGate('deploy')).toBe('production-deploy')
    expect(mapCapabilityToHumanGateApprovalGate('finance')).toBe('finance')
    expect(mapCapabilityToHumanGateApprovalGate('secrets')).toBe('secret-config')
    expect(mapCapabilityToHumanGateApprovalGate('access_secret')).toBe('secret-config')
    expect(mapCapabilityToHumanGateApprovalGate('delete')).toBe('destructive')
    expect(mapCapabilityToHumanGateApprovalGate('message_client')).toBe('client-visible')
    expect(mapCapabilityToHumanGateApprovalGate(undefined)).toBe('human-review')
    expect(mapCapabilityToHumanGateApprovalGate('approval')).toBe('human-review')
    expect(mapCapabilityToHumanGateApprovalGate('public-publishing')).toBe('public-publishing')

    const template = normalizeGraphTemplate({
      orgId: 'pib-platform-owner',
      name: 'gate-no-cap',
      status: 'active',
      nodes: [
        {
          nodeId: 'bare_gate',
          kind: 'human_gate',
          name: 'Human gate bare',
          dependsOnNodeIds: [],
          expectedArtifacts: ['approval_ref'],
        },
      ],
    })
    template.id = 'tmpl-bare-gate'
    let run = createWorkflowRunFromTemplate({
      runId: 'wfr_bare_gate',
      template,
      orgId: 'pib-platform-owner',
      projectId: 'proj-gate',
      trigger: { type: 'manual', at: NOW },
      now: NOW,
    })
    const step = advanceWorkflowRun(run, { type: 'tick', now: NOW })
    const intent = step.materialize.find((m) => m.nodeId === 'bare_gate')
    expect(intent?.kind).toBe('human_gate')
    expect(intent?.requiredCapability).toBeUndefined()
    expect(intent?.approvalGate).toBe('human-review')
    const payload = buildProjectTaskCreateData({
      title: intent!.title,
      columnId: intent!.columnId,
      agentStatus: intent!.agentStatus,
      approvalGate: intent!.approvalGate,
      expectedArtifacts: intent!.expectedArtifacts,
      labels: intent!.labels,
    }, 'proj-gate', 'pib-platform-owner')
    expect(payload.ok).toBe(true)
    if (payload.ok) {
      expect(payload.value.approvalGate).toBe('human-review')
      // Real Kanban id is assigned by store.materializeKanbanTask; intent must not be the sentinel.
      expect(intent?.nodeId).not.toBe('materialize-failed')
    }
  })

  test('fail-closed: transient_infra 3x → blocked with exhausted reason and rematerialize between attempts', () => {
    let run = startPilotRun()
    let step = advanceWorkflowRun(run, { type: 'tick', now: NOW })
    run = bindKanbanTask(step.run, 'research_brief', 'task-research', NOW)

    const failAt = (iso: string) =>
      advanceWorkflowRun(run, {
        type: 'kanban_terminal',
        now: iso,
        nodeId: 'research_brief',
        kanbanTaskId: 'task-research',
        outcome: 'blocked',
        errorFamily: 'transient_infra',
        summary: 'broken pipe / stream idle',
      })

    // Attempt 1 fails → retry_wait with retry reason (not exhausted)
    step = failAt('2026-08-02T12:10:00.000Z')
    run = step.run
    let node = run.nodes.find((n) => n.nodeId === 'research_brief')!
    expect(node.status).toBe('retry_wait')
    expect(node.blockedReasonCode).toBe('transient_infra_retry')
    expect(node.blockedReasonCode).not.toBe('transient_infra_exhausted')
    expect(node.currentAttempt).toBe(1)
    expect(node.retryAt).toBeTruthy()
    expect(node.lastKanbanTaskId).toBe('task-research')
    // Same-tick activate must NOT re-dispatch before backoff
    expect(step.materialize.find((m) => m.nodeId === 'research_brief')).toBeUndefined()

    const attempt1 = run.attempts.research_brief?.[0]
    expect(attempt1?.errorFamily).toBe('transient_infra')
    expect(attempt1?.retryable).toBe(true)
    expect(attempt1?.retryAt).toBe(node.retryAt)

    // Before backoff: still no materialize
    step = advanceWorkflowRun(run, { type: 'tick', now: '2026-08-02T12:10:30.000Z' })
    run = step.run
    expect(step.materialize.find((m) => m.nodeId === 'research_brief')).toBeUndefined()
    expect(run.nodes.find((n) => n.nodeId === 'research_brief')?.status).toBe('retry_wait')

    // After backoff: rematerialize / requeue intent
    const afterBackoff1 = node.retryAt!
    step = advanceWorkflowRun(run, { type: 'tick', now: afterBackoff1 })
    run = step.run
    const requeue1 = step.materialize.find((m) => m.nodeId === 'research_brief')
    expect(requeue1).toBeTruthy()
    expect(requeue1?.requeueExisting).toBe(true)
    expect(requeue1?.previousKanbanTaskId).toBe('task-research')
    expect(requeue1?.idempotencyKey).toBe('wfr_pilot_1:research_brief:2')
    node = run.nodes.find((n) => n.nodeId === 'research_brief')!
    expect(node.status).toBe('waiting_watcher')
    expect(node.currentAttempt).toBe(2)
    expect(node.kanbanTaskId).toBeUndefined() // cleared until bind

    run = bindKanbanTask(run, 'research_brief', 'task-research', afterBackoff1)

    // Attempt 2 fails → still retryable
    step = failAt('2026-08-02T12:20:00.000Z')
    run = step.run
    node = run.nodes.find((n) => n.nodeId === 'research_brief')!
    expect(node.status).toBe('retry_wait')
    expect(node.blockedReasonCode).toBe('transient_infra_retry')
    expect(node.currentAttempt).toBe(2)

    const afterBackoff2 = node.retryAt!
    step = advanceWorkflowRun(run, { type: 'tick', now: afterBackoff2 })
    run = step.run
    const requeue2 = step.materialize.find((m) => m.nodeId === 'research_brief')
    expect(requeue2).toBeTruthy()
    expect(requeue2?.requeueExisting).toBe(true)
    expect(requeue2?.idempotencyKey).toBe('wfr_pilot_1:research_brief:3')
    node = run.nodes.find((n) => n.nodeId === 'research_brief')!
    expect(node.currentAttempt).toBe(3)

    run = bindKanbanTask(run, 'research_brief', 'task-research', afterBackoff2)

    // Attempt 3 fails → blocked exhausted (no further materialize)
    step = failAt('2026-08-02T12:40:00.000Z')
    run = step.run
    node = run.nodes.find((n) => n.nodeId === 'research_brief')!
    expect(node.status).toBe('blocked')
    expect(node.blockedReasonCode).toBe('transient_infra_exhausted')
    expect(node.currentAttempt).toBe(3)
    expect(run.blockedReasonCode).toBe('transient_infra_exhausted')
    expect(step.materialize.find((m) => m.nodeId === 'research_brief')).toBeUndefined()

    const attempts = run.attempts.research_brief ?? []
    expect(attempts).toHaveLength(3)
    expect(attempts.every((a) => a.errorFamily === 'transient_infra')).toBe(true)
    expect(attempts[0]?.retryable).toBe(true)
    expect(attempts[1]?.retryable).toBe(true)
    expect(attempts[2]?.retryable).toBe(false)
    expect(attempts[2]?.status).toBe('blocked')

    // Later ticks must not re-dispatch exhausted node; no false-done
    step = advanceWorkflowRun(run, { type: 'tick', now: '2026-08-02T13:00:00.000Z' })
    expect(step.materialize.find((m) => m.nodeId === 'research_brief')).toBeUndefined()
    expect(step.run.nodes.find((n) => n.nodeId === 'research_brief')?.status).toBe('blocked')
    expect(step.run.status).not.toBe('succeeded')

    const inspect = inspectWorkflowRun(step.run)
    const inspectNode = inspect.nodes.find((n) => n.nodeId === 'research_brief')
    expect(inspectNode?.blockedReasonCode).toBe('transient_infra_exhausted')
    expect(inspectNode?.status).toBe('blocked')
  })
})
