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
import { sanitizeMaterializeApprovalGate } from '@/lib/workflow-graph/materialize-sanitize'
import { buildProjectTaskCreateData } from '@/lib/projects/taskPayload'
import { normalizeGraphTemplate, validateGraphTemplate, attemptIdempotencyKey } from '@/lib/workflow-graph/validation'
import type { MaterializeIntent, WorkflowRun } from '@/lib/workflow-graph/types'

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

  test('per-node agentModel flows into materialize intent and Kanban task create data', () => {
    const template = normalizeGraphTemplate({
      orgId: 'pib-platform-owner',
      name: 'model-routed-impl-review',
      nodes: [
        {
          nodeId: 'impl',
          kind: 'agent',
          name: 'Implement',
          dependsOnNodeIds: [],
          assigneeAgentId: 'theo',
          agentModel: 'gpt-5.3-codex-spark',
          expectedArtifacts: ['impl_commit_sha'],
          agentInput: { spec: 'Implement on development only' },
        },
        {
          nodeId: 'review',
          kind: 'agent',
          name: 'Verify & review',
          dependsOnNodeIds: ['impl'],
          assigneeAgentId: 'qa-release',
          agentModel: 'claude-sonnet-4-6',
          expectedArtifacts: ['review_verdict'],
          agentInput: { spec: 'Judge the implementation' },
        },
        {
          nodeId: 'promote_gate',
          kind: 'human_gate',
          name: 'Production promote gate',
          dependsOnNodeIds: ['review'],
          requiredCapability: 'deploy',
          approvalGate: 'production-deploy',
          expectedArtifacts: ['approval_ref'],
          riskLevel: 'high',
        },
      ],
    })
    const validated = validateGraphTemplate(template)
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    template.id = 'tmpl-model-routed'

    let run = createWorkflowRunFromTemplate({
      runId: 'wfr_model_routed_1',
      template,
      orgId: 'pib-platform-owner',
      projectId: 'proj-model',
      trigger: { type: 'manual', at: NOW },
      now: NOW,
      createdBy: 'theo',
    })

    let step = advanceWorkflowRun(run, { type: 'tick', now: NOW })
    run = step.run
    const implIntent = step.materialize.find((m) => m.nodeId === 'impl')
    expect(implIntent?.agentModel).toBe('gpt-5.3-codex-spark')
    // human_gate never carries a model
    expect(step.materialize.some((m) => m.kind === 'human_gate')).toBe(false)

    // Kanban create data carries the node model through to the task
    const built = buildProjectTaskCreateData(
      {
        title: implIntent!.title,
        assigneeAgentId: implIntent!.assigneeAgentId,
        agentModel: implIntent!.agentModel,
        agentStatus: implIntent!.agentStatus,
        columnId: implIntent!.columnId,
        priority: 'medium',
        labels: implIntent!.labels,
        expectedArtifacts: implIntent!.expectedArtifacts,
        verifierChecklist: implIntent!.verifierChecklist,
        agentInput: implIntent!.agentInput,
      },
      'proj-model',
      'pib-platform-owner',
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.value.agentModel).toBe('gpt-5.3-codex-spark')

    // Complete impl, review materializes with its own model
    run = bindKanbanTask(run, 'impl', 'task-impl', NOW)
    run = completeAgent(run, 'impl', 'task-impl', [{ type: 'impl_commit_sha', ref: 'abc123' }])
    step = advanceWorkflowRun(run, { type: 'tick', now: LATER })
    run = step.run
    const reviewIntent = step.materialize.find((m) => m.nodeId === 'review')
    expect(reviewIntent?.agentModel).toBe('claude-sonnet-4-6')
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

    // code_check auto-runs from upstream agent evidence (no manual artifactPresence)
    step = advanceWorkflowRun(run, {
      type: 'tick',
      now: LATER,
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

    // approval_granted injects approval_ref and completes human_gate (no separate kanban_terminal required)
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
    expect(run.nodes.find((n) => n.nodeId === 'approve_publish_intent')?.status).toBe('done')
    expect(run.nodes.find((n) => n.nodeId === 'approve_publish_intent')?.evidence.some((e) => e.type === 'approval_ref' && e.ref === 'apr_1')).toBe(true)

    // allowlisted system:publish_noop may complete on approval tick or next tick
    if (run.nodes.find((n) => n.nodeId === 'noop_publish_system')?.status !== 'done') {
      step = advanceWorkflowRun(run, { type: 'tick', now: LATER })
      run = step.run
    }
    expect(run.nodes.find((n) => n.nodeId === 'noop_publish_system')?.status).toBe('done')
    expect(run.nodes.find((n) => n.nodeId === 'noop_publish_system')?.evidence.some((e) => e.type === 'publish_noop_receipt')).toBe(true)

    // fan-out both agents (re-tick if materialize already consumed)
    let fanIds = step.materialize.map((m) => m.nodeId).filter((id) => id === 'content_checklist' || id === 'eng_checklist').sort()
    if (fanIds.length < 2) {
      step = advanceWorkflowRun(run, { type: 'tick', now: LATER })
      run = step.run
      fanIds = step.materialize.map((m) => m.nodeId).filter((id) => id === 'content_checklist' || id === 'eng_checklist').sort()
    }
    expect(fanIds).toEqual(['content_checklist', 'eng_checklist'])
    run = bindKanbanTask(run, 'eng_checklist', 'task-eng', LATER)
    run = bindKanbanTask(run, 'content_checklist', 'task-content', LATER)
    run = completeAgent(run, 'eng_checklist', 'task-eng', [{ type: 'eng_checklist_id', ref: 'eng_1' }])
    run = completeAgent(run, 'content_checklist', 'task-content', [{ type: 'content_checklist_id', ref: 'cnt_1' }])

    step = advanceWorkflowRun(run, {
      type: 'tick',
      now: LATER,
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
    // pause_run must flip on the exceeding terminal — not only on a later tick.
    expect(run.status).toBe('paused_budget')
    expect(run.cost.estimatedCost).toBeGreaterThan(0)
    expect(run.timeline?.some((e) => e.kind === 'cost' && e.to === 'exceeded')).toBe(true)

    step = advanceWorkflowRun(run, { type: 'tick', now: LATER })
    run = step.run
    expect(run.status).toBe('paused_budget')
    const a2 = run.nodes.find((n) => n.nodeId === 'a2')
    expect(a2?.status).toBe('queued_capacity')
    expect(a2?.blockedReasonCode).toBe('budget_exceeded')
    expect(step.materialize.find((m) => m.nodeId === 'a2')).toBeUndefined()
  })

  test('pause_run: golden-like overspend pauses before fan-out agent materialize', () => {
    const template = buildPilotResearchValidateDocApproveFanoutTemplate({
      orgId: 'pib-platform-owner',
      projectId: 'proj-pilot',
    })
    template.id = 'tmpl-golden-budget'
    template.budgets.maxTokensPerRun = 200_000
    template.budgets.onExceed = 'pause_run'
    let run = createWorkflowRunFromTemplate({
      runId: 'wfr_golden_budget',
      template,
      orgId: 'pib-platform-owner',
      projectId: 'proj-pilot',
      trigger: { type: 'manual', at: NOW },
      now: NOW,
    })

    let step = advanceWorkflowRun(run, { type: 'tick', now: NOW })
    run = bindKanbanTask(step.run, 'research_brief', 't-research', NOW)
    run = completeAgent(run, 'research_brief', 't-research', [
      { type: 'research_doc_id', ref: 'doc_r' },
    ], 56_000) // tokensTotal = 112_000 via completeAgent (*2)

    step = advanceWorkflowRun(run, { type: 'tick', now: LATER })
    // research check auto-done; draft should materialize while still under ceiling
    run = step.run
    const draftMat = step.materialize.find((m) => m.nodeId === 'draft_build_note')
      || (run.nodes.find((n) => n.nodeId === 'draft_build_note')?.status === 'waiting_watcher'
        ? { nodeId: 'draft_build_note' }
        : undefined)
    // draft may already be waiting from completeAgent's activate
    const draftNode = run.nodes.find((n) => n.nodeId === 'draft_build_note')
    if (draftNode && !draftNode.kanbanTaskId && draftNode.status === 'waiting_watcher') {
      run = bindKanbanTask(run, 'draft_build_note', 't-draft', LATER)
    } else if (draftMat) {
      run = bindKanbanTask(run, 'draft_build_note', 't-draft', LATER)
    } else {
      // force materialize path
      step = advanceWorkflowRun(run, { type: 'tick', now: LATER })
      run = bindKanbanTask(step.run, 'draft_build_note', 't-draft', LATER)
    }

    run = completeAgent(run, 'draft_build_note', 't-draft', [
      { type: 'draft_doc_id', ref: 'doc_d' },
    ], 56_000) // cumulative ~224k > 200k

    expect(run.cost.tokensTotal).toBeGreaterThanOrEqual(200_000)
    expect(run.cost.budgetStatus).toBe('exceeded')
    expect(run.status).toBe('paused_budget')
    expect(run.cost.estimatedCost).toBeGreaterThan(0)

    step = advanceWorkflowRun(run, { type: 'tick', now: LATER })
    run = step.run
    expect(step.materialize.find((m) => m.nodeId === 'eng_checklist')).toBeUndefined()
    expect(step.materialize.find((m) => m.nodeId === 'content_checklist')).toBeUndefined()
    const eng = run.nodes.find((n) => n.nodeId === 'eng_checklist')
    const content = run.nodes.find((n) => n.nodeId === 'content_checklist')
    // Fan-out must not be in-flight after exceed under pause_run.
    expect(eng?.status === 'waiting_watcher' || eng?.status === 'running').toBe(false)
    expect(content?.status === 'waiting_watcher' || content?.status === 'running').toBe(false)
    expect(run.status).not.toBe('succeeded')
  })

  test('block_new_agent_nodes: may succeed over budget without claiming pause_run', () => {
    const template = buildTinyBudgetPilotTemplate()
    template.id = 'tmpl-block-agents'
    template.budgets.onExceed = 'block_new_agent_nodes'
    // Single agent so exceed on complete can still all-done succeed
    template.nodes = [template.nodes[0]]
    let run = createWorkflowRunFromTemplate({
      runId: 'wfr_block_agents',
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
      tokensTotal: 250,
      tokensIn: 200,
      tokensOut: 50,
    })
    run = step.run
    expect(run.cost.budgetStatus).toBe('exceeded')
    expect(run.status).toBe('succeeded')
    expect(run.terminalReason).toBe('all_nodes_proven')
    expect(run.status).not.toBe('paused_budget')
  })

  test('kanban_terminal is idempotent: no double tokens or attempt inflate', () => {
    const template = buildTinyBudgetPilotTemplate()
    template.id = 'tmpl-idem'
    template.budgets.maxTokensPerRun = 1_000_000
    template.nodes = [template.nodes[0]]
    let run = createWorkflowRunFromTemplate({
      runId: 'wfr_idem',
      template,
      orgId: 'pib-platform-owner',
      projectId: 'proj',
      trigger: { type: 'manual', at: NOW },
      now: NOW,
    })
    let step = advanceWorkflowRun(run, { type: 'tick', now: NOW })
    run = bindKanbanTask(step.run, 'a1', 't1', NOW)
    const agentStarts = run.cost.attemptCountAgent
    expect(agentStarts).toBe(1)
    step = advanceWorkflowRun(run, {
      type: 'kanban_terminal',
      now: LATER,
      nodeId: 'a1',
      kanbanTaskId: 't1',
      outcome: 'done',
      evidence: [{ type: 'a_art', ref: 'a', at: LATER }],
      tokensTotal: 40,
      tokensIn: 30,
      tokensOut: 10,
    })
    run = step.run
    const tokensAfterFirst = run.cost.tokensTotal
    const attemptsAfterFirst = run.cost.attemptCountAgent
    expect(attemptsAfterFirst).toBe(agentStarts) // counted at start, not terminal

    step = advanceWorkflowRun(run, {
      type: 'kanban_terminal',
      now: LATER,
      nodeId: 'a1',
      kanbanTaskId: 't1',
      outcome: 'done',
      evidence: [{ type: 'a_art', ref: 'a', at: LATER }],
      tokensTotal: 40,
      tokensIn: 30,
      tokensOut: 10,
    })
    run = step.run
    expect(run.cost.tokensTotal).toBe(tokensAfterFirst)
    expect(run.cost.attemptCountAgent).toBe(attemptsAfterFirst)
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

  test('cancel mid waiting_watcher survives tick + empty de-arm write-back (never failed/running/succeeded)', () => {
    const template = normalizeGraphTemplate({
      orgId: 'pib-platform-owner',
      name: 'cancel-dearm-durable',
      status: 'active',
      nodes: [
        {
          nodeId: 'n_agent',
          kind: 'agent',
          name: 'Agent',
          dependsOnNodeIds: [],
          expectedArtifacts: ['qa_probe_id'],
          assigneeAgentId: 'theo',
        },
        {
          nodeId: 'n_check',
          kind: 'code_check',
          name: 'Check',
          dependsOnNodeIds: ['n_agent'],
          expectedArtifacts: ['qa_probe_id'],
        },
        {
          nodeId: 'n_gate',
          kind: 'human_gate',
          name: 'Gate',
          dependsOnNodeIds: ['n_check'],
          expectedArtifacts: ['approval_ref'],
        },
      ],
    })
    template.id = 'tmpl-cancel-dearm'
    let run = createWorkflowRunFromTemplate({
      runId: 'wfr_cancel_dearm',
      template,
      orgId: 'pib-platform-owner',
      projectId: 'proj-cancel-dearm',
      trigger: { type: 'manual', at: NOW },
      now: NOW,
    })

    let step = advanceWorkflowRun(run, { type: 'tick', now: NOW })
    run = bindKanbanTask(step.run, 'n_agent', 'task-agent-dearm', NOW)
    expect(run.nodes.find((n) => n.nodeId === 'n_agent')?.status).toBe('waiting_watcher')

    step = advanceWorkflowRun(run, {
      type: 'cancel',
      now: LATER,
      reason: 'operator_cancel_mid_waiting_watcher',
    })
    run = step.run
    expect(run.status).toBe('cancelled')
    expect(run.terminalReason).toBe('operator_cancel_mid_waiting_watcher')
    expect(run.nodes.every((n) => n.status === 'cancelled')).toBe(true)

    // Post-cancel tick must not resurrect or re-materialize.
    step = advanceWorkflowRun(run, { type: 'tick', now: LATER })
    run = step.run
    expect(run.status).toBe('cancelled')
    expect(step.materialize).toEqual([])
    expect(run.nodes.every((n) => n.status === 'cancelled')).toBe(true)

    // Empty board de-arm write-back (done, no artifacts) must not un-cancel or flip run to failed.
    step = advanceWorkflowRun(run, {
      type: 'kanban_terminal',
      now: LATER,
      nodeId: 'n_agent',
      kanbanTaskId: 'task-agent-dearm',
      outcome: 'done',
      summary: 'board closed empty de-arm',
      evidence: [],
    })
    run = step.run
    expect(run.status).toBe('cancelled')
    expect(run.terminalReason).toBe('operator_cancel_mid_waiting_watcher')
    expect(run.nodes.find((n) => n.nodeId === 'n_agent')?.status).toBe('cancelled')
    expect(run.nodes.every((n) => n.status === 'cancelled')).toBe(true)
    expect(['running', 'succeeded', 'failed']).not.toContain(run.status)
  })

  test('cancelled latches through tick when a prior false-done left a blocked node', () => {
    const template = normalizeGraphTemplate({
      orgId: 'pib-platform-owner',
      name: 'cancel-after-false-done',
      status: 'active',
      nodes: [
        {
          nodeId: 'n_agent',
          kind: 'agent',
          name: 'Agent',
          dependsOnNodeIds: [],
          expectedArtifacts: ['qa_probe_id'],
          assigneeAgentId: 'theo',
        },
        {
          nodeId: 'n_check',
          kind: 'code_check',
          name: 'Check',
          dependsOnNodeIds: ['n_agent'],
          expectedArtifacts: ['qa_probe_id'],
        },
        {
          nodeId: 'n_gate',
          kind: 'human_gate',
          name: 'Gate',
          dependsOnNodeIds: ['n_check'],
          expectedArtifacts: ['approval_ref'],
        },
      ],
    })
    template.id = 'tmpl-cancel-after-false-done'
    let run = createWorkflowRunFromTemplate({
      runId: 'wfr_cancel_after_false_done',
      template,
      orgId: 'pib-platform-owner',
      projectId: 'proj-cancel-after-false-done',
      trigger: { type: 'manual', at: NOW },
      now: NOW,
    })

    let step = advanceWorkflowRun(run, { type: 'tick', now: NOW })
    run = bindKanbanTask(step.run, 'n_agent', 'task-agent-fd', NOW)

    // Preserve missing_artifact false-done: empty done while running → blocked, not succeeded.
    step = advanceWorkflowRun(run, {
      type: 'kanban_terminal',
      now: LATER,
      nodeId: 'n_agent',
      kanbanTaskId: 'task-agent-fd',
      outcome: 'done',
      summary: 'url-only de-arm without qa_probe_id',
      evidence: [],
    })
    run = step.run
    expect(run.status).not.toBe('succeeded')
    expect(run.nodes.find((n) => n.nodeId === 'n_agent')?.status).toBe('blocked')
    expect(run.nodes.find((n) => n.nodeId === 'n_agent')?.blockedReasonCode).toMatch(/^missing_artifact:/)

    step = advanceWorkflowRun(run, {
      type: 'cancel',
      now: LATER,
      reason: 'operator_cancel_after_false_done',
    })
    run = step.run
    expect(run.status).toBe('cancelled')
    // Already-blocked agent stays blocked (terminal); open nodes cancel.
    expect(run.nodes.find((n) => n.nodeId === 'n_agent')?.status).toBe('blocked')
    expect(run.nodes.find((n) => n.nodeId === 'n_check')?.status).toBe('cancelled')
    expect(run.nodes.find((n) => n.nodeId === 'n_gate')?.status).toBe('cancelled')

    // Critical latch: post-cancel tick must not re-derive failed via blocked_without_open_paths.
    step = advanceWorkflowRun(run, { type: 'tick', now: LATER })
    run = step.run
    expect(run.status).toBe('cancelled')
    expect(run.terminalReason).toBe('operator_cancel_after_false_done')
    expect(run.nodes.find((n) => n.nodeId === 'n_agent')?.blockedReasonCode).toMatch(/^missing_artifact:/)
    expect(['running', 'succeeded', 'failed']).not.toContain(run.status)
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

  test('playbook promote approvalGate-only steps materialize valid Kanban payloads (no gate-as-capability)', () => {
    const gates = [
      'human-review',
      'paid-spend',
      'finance',
      'client-visible',
      'secret-config',
      'destructive',
      'production-deploy',
      'public-publishing',
    ] as const

    for (const gate of gates) {
      const promoted = promotePlaybookTemplateToGraphTemplate({
        orgId: 'pib-platform-owner',
        name: `promote-gate-${gate}`,
        playbookId: `pb-gate-${gate}`,
        projectId: 'proj-gate',
        playbookTemplate: {
          schemaVersion: 1,
          steps: [
            {
              stepId: 'gate',
              taskKind: 'approval-gate',
              title: `Approve ${gate}`,
              dependsOnStepIds: [],
              approvalGate: gate,
              // intentionally no requiredCapability — classic playbook shape
              expectedArtifacts: ['approval_ref'],
              verifierChecklist: ['scoped'],
              labels: [],
            },
          ],
        },
      })
      expect(promoted.ok).toBe(true)
      if (!promoted.ok) return
      const node = promoted.template.nodes.find((n) => n.nodeId === 'gate')
      expect(node?.kind).toBe('human_gate')
      expect(node?.approvalGate).toBe(gate)
      expect(node?.requiredCapability).toBeUndefined()

      const template = { ...promoted.template, id: `tmpl-${gate}` }
      const run = createWorkflowRunFromTemplate({
        runId: `wfr_${gate}`,
        template,
        orgId: 'pib-platform-owner',
        projectId: 'proj-gate',
        trigger: { type: 'manual', at: NOW },
        now: NOW,
      })
      expect(run.nodes.find((n) => n.nodeId === 'gate')?.approvalGate).toBe(gate)

      const advanced = advanceWorkflowRun(run, { type: 'tick', now: NOW })
      const intent = advanced.materialize.find((m) => m.nodeId === 'gate')
      expect(intent?.kind).toBe('human_gate')
      expect(intent?.approvalGate).toBe(gate)
      expect(intent?.requiredCapability).toBeUndefined()

      const payload = buildProjectTaskCreateData({
        title: intent!.title,
        columnId: intent!.columnId,
        agentStatus: intent!.agentStatus,
        approvalGate: intent!.approvalGate,
        requiredCapability: intent!.requiredCapability,
        expectedArtifacts: intent!.expectedArtifacts,
        labels: intent!.labels,
      }, 'proj-gate', 'pib-platform-owner')
      expect(payload.ok).toBe(true)
      if (payload.ok) {
        expect(payload.value.approvalGate).toBe(gate)
        expect(payload.value.requiredCapability).toBeUndefined()
      }
    }
  })

  test('pilot publish capability path still maps approvalGate + keeps requiredCapability publish', () => {
    const promoted = promotePlaybookTemplateToGraphTemplate({
      orgId: 'pib-platform-owner',
      name: 'pilot-publish',
      playbookId: 'pb-publish',
      projectId: 'proj-gate',
      playbookTemplate: {
        schemaVersion: 1,
        steps: [
          {
            stepId: 'approve_publish',
            taskKind: 'approval-gate',
            title: 'Approve publish',
            dependsOnStepIds: [],
            approvalGate: 'public-publishing',
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
    const node = promoted.template.nodes.find((n) => n.nodeId === 'approve_publish')
    expect(node?.requiredCapability).toBe('publish')
    expect(node?.approvalGate).toBe('public-publishing')

    const run = createWorkflowRunFromTemplate({
      runId: 'wfr_publish_cap',
      template: { ...promoted.template, id: 'tmpl-publish' },
      orgId: 'pib-platform-owner',
      projectId: 'proj-gate',
      trigger: { type: 'manual', at: NOW },
      now: NOW,
    })
    const intent = advanceWorkflowRun(run, { type: 'tick', now: NOW }).materialize.find(
      (m) => m.nodeId === 'approve_publish',
    )
    expect(intent?.approvalGate).toBe('public-publishing')
    expect(intent?.requiredCapability).toBe('publish')
    const payload = buildProjectTaskCreateData({
      title: intent!.title,
      columnId: intent!.columnId,
      agentStatus: intent!.agentStatus,
      approvalGate: intent!.approvalGate,
      requiredCapability: intent!.requiredCapability,
      expectedArtifacts: intent!.expectedArtifacts,
      labels: intent!.labels,
      riskLevel: intent!.riskLevel,
    }, 'proj-gate', 'pib-platform-owner')
    expect(payload.ok).toBe(true)
    if (payload.ok) {
      expect(payload.value.approvalGate).toBe('public-publishing')
      expect(payload.value.requiredCapability).toBe('publish')
    }
  })

  test('store sanitize maps stale intent approvalGate aliases (publish/approval) before taskPayload', () => {
    const base: Omit<MaterializeIntent, 'approvalGate' | 'requiredCapability' | 'kind'> = {
      nodeId: 'g',
      title: 'Gate',
      agentStatus: 'awaiting-input',
      columnId: 'blocked',
      dependsOnKanbanTaskIds: [],
      expectedArtifacts: ['approval_ref'],
      verifierChecklist: [],
      labels: ['human_gate'],
      idempotencyKey: 'k',
      requeueExisting: false,
    }
    expect(
      sanitizeMaterializeApprovalGate({
        ...base,
        kind: 'human_gate',
        approvalGate: 'publish',
        requiredCapability: undefined,
      }),
    ).toBe('public-publishing')
    expect(
      sanitizeMaterializeApprovalGate({
        ...base,
        kind: 'human_gate',
        approvalGate: 'approval',
      }),
    ).toBe('human-review')
    expect(
      sanitizeMaterializeApprovalGate({
        ...base,
        kind: 'human_gate',
        approvalGate: undefined,
        requiredCapability: 'publish',
      }),
    ).toBe('public-publishing')
    expect(
      sanitizeMaterializeApprovalGate({
        ...base,
        kind: 'human_gate',
        approvalGate: 'public-publishing',
        requiredCapability: 'publish',
      }),
    ).toBe('public-publishing')

    for (const gate of ['publish', 'approval', undefined] as const) {
      const sanitized = sanitizeMaterializeApprovalGate({
        ...base,
        kind: 'human_gate',
        approvalGate: gate,
        requiredCapability: gate === 'publish' || gate === undefined ? 'publish' : undefined,
      })
      const payload = buildProjectTaskCreateData({
        title: 'G',
        columnId: 'blocked',
        agentStatus: 'awaiting-input',
        approvalGate: sanitized,
        expectedArtifacts: ['approval_ref'],
        labels: ['human_gate'],
      }, 'proj-gate', 'pib-platform-owner')
      expect(payload.ok).toBe(true)
      if (payload.ok) {
        expect(payload.value.approvalGate).toMatch(/public-publishing|human-review/)
      }
    }
  })

  test('invalid node.approvalGate publish (no requiredCapability) still maps at materialize', () => {
    const template = normalizeGraphTemplate({
      orgId: 'pib-platform-owner',
      name: 'bad-gate-field',
      status: 'active',
      nodes: [
        {
          nodeId: 'bad',
          kind: 'human_gate',
          name: 'Bad stored gate',
          dependsOnNodeIds: [],
          approvalGate: 'publish',
          expectedArtifacts: ['approval_ref'],
        },
      ],
    })
    template.id = 'tmpl-bad-gate'
    const run = createWorkflowRunFromTemplate({
      runId: 'wfr_bad_gate',
      template,
      orgId: 'pib-platform-owner',
      projectId: 'proj-gate',
      trigger: { type: 'manual', at: NOW },
      now: NOW,
    })
    expect(run.nodes[0]?.approvalGate).toBe('publish')
    const intent = advanceWorkflowRun(run, { type: 'tick', now: NOW }).materialize[0]
    expect(intent?.approvalGate).toBe('public-publishing')
    expect(sanitizeMaterializeApprovalGate(intent!)).toBe('public-publishing')
  })

  test('normalizeGraphTemplate persists approvalGate on human_gate nodes', () => {
    const template = normalizeGraphTemplate({
      orgId: 'pib-platform-owner',
      name: 'persist-gate',
      status: 'active',
      nodes: [
        {
          nodeId: 'g1',
          kind: 'human_gate',
          name: 'G',
          dependsOnNodeIds: [],
          approvalGate: 'human-review',
          expectedArtifacts: ['approval_ref'],
        },
      ],
    })
    expect(template.nodes[0]?.approvalGate).toBe('human-review')
    const validated = validateGraphTemplate(template)
    expect(validated.ok).toBe(true)
  })

  test('pilot template human_gate carries explicit public-publishing approvalGate', () => {
    const template = buildPilotResearchValidateDocApproveFanoutTemplate({
      orgId: 'pib-platform-owner',
      projectId: 'proj-pilot',
    })
    const gate = template.nodes.find((n) => n.nodeId === 'approve_publish_intent')
    expect(gate?.kind).toBe('human_gate')
    expect(gate?.requiredCapability).toBe('publish')
    expect(gate?.approvalGate).toBe('public-publishing')
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
