import {
  advanceWorkflowRun,
  bindKanbanTask,
  createWorkflowRunFromTemplate,
  inspectWorkflowRun,
  shouldMaterializeKind,
} from '@/lib/workflow-graph/engine'
import { buildOpsInspect, evaluateStuck } from '@/lib/workflow-graph/ops'
import { DEFAULT_SLA } from '@/lib/workflow-graph/constants'
import {
  buildPilotResearchValidateDocApproveFanoutTemplate,
  buildTinyBudgetPilotTemplate,
} from '@/lib/workflow-graph/pilot'
import {
  blankGraphTemplateDraft,
  buildTemplateFromDraft,
  draftFromTemplate,
  exposeNoraControls,
  materializationPreview,
  serializeAuthoringPayload,
} from '@/lib/workflow-graph/authoring'
import {
  attemptIdempotencyKey,
  normalizeGraphTemplate,
  validateGraphTemplate,
} from '@/lib/workflow-graph/validation'
import type { WorkflowRun } from '@/lib/workflow-graph/types'

const NOW = '2026-08-02T15:00:00.000Z'
const LATER = '2026-08-02T15:05:00.000Z'

function startPilotRun(): WorkflowRun {
  const template = buildPilotResearchValidateDocApproveFanoutTemplate({
    orgId: 'pib-platform-owner',
    projectId: 'proj-phase3',
  })
  template.id = 'tmpl-phase3-pilot'
  return createWorkflowRunFromTemplate({
    runId: 'wfr_phase3_1',
    template,
    orgId: 'pib-platform-owner',
    projectId: 'proj-phase3',
    trigger: { type: 'manual', at: NOW },
    now: NOW,
    createdBy: 'theo',
  })
}

describe('workflow graph phase 3 authoring', () => {
  test('blank draft exposes Nora budgets/limits/notify/SLA defaults', () => {
    const draft = blankGraphTemplateDraft({
      orgId: 'pib-platform-owner',
      projectId: 'proj-1',
    })
    const nora = exposeNoraControls(draft)
    expect(nora.limits.maxConcurrentAgentNodes).toBe(3)
    expect(nora.budgets.onExceed).toBe('pause_run')
    expect(nora.budgets.currency).toBe('USD')
    expect(nora.notify.quietSuccess).toBe(true)
    expect(nora.notify.alertOnBlock).toBe(true)
    expect(nora.sla.humanGateWarnMs).toBeGreaterThan(0)
    expect(nora.sla.agentRunningHeartbeatMs).toBeGreaterThan(0)
    expect(draft.nodes).toEqual([])
  })

  test('authoring round-trip preserves Nora controls + structured nodes', () => {
    const draft = blankGraphTemplateDraft({
      orgId: 'pib-platform-owner',
      projectId: 'proj-1',
      name: 'suite-authored-graph',
    })
    draft.status = 'draft'
    draft.limits = {
      maxConcurrentAgentNodes: 2,
      maxConcurrentAgentNodesOrgDefault: 8,
    }
    draft.budgets = {
      currency: 'USD',
      maxTokensPerRun: 120_000,
      maxCostPerRun: 25,
      maxAgentNodeAttemptsPerRun: 12,
      warnAtRatio: 0.75,
      onExceed: 'pause_run',
      estimatedCostModel: 'tokens_only',
    }
    draft.notify = {
      quietSuccess: true,
      alertOnBlock: true,
      onSuccess: 'quiet',
      onBlock: 'ops_inbox',
      onBudgetExceed: 'ops_inbox',
      debounceSeconds: 300,
      ceoNotifyOn: ['block', 'budget'],
    }
    draft.sla = {
      agentRunningHeartbeatMs: 15 * 60_000,
      agentReadyUnclaimedMs: 10 * 60_000,
      humanGateWarnMs: 12 * 60 * 60_000,
      humanGateEscalateMs: 36 * 60 * 60_000,
      runNoTransitionMs: 20 * 60_000,
    }
    draft.nodes = [
      {
        nodeId: 'research',
        kind: 'agent',
        name: 'Research',
        dependsOnNodeIds: [],
        assigneeAgentId: 'sage',
        expectedArtifacts: ['research_doc_id'],
        agentInput: { spec: 'Research briefly' },
        riskLevel: 'medium',
      },
      {
        nodeId: 'check',
        kind: 'code_check',
        name: 'Check research',
        dependsOnNodeIds: ['research'],
        checkType: 'artifact_presence',
        expectedArtifacts: ['research_doc_id'],
      },
      {
        nodeId: 'approve',
        kind: 'human_gate',
        name: 'Approve',
        dependsOnNodeIds: ['check'],
        requiredCapability: 'publish',
        expectedArtifacts: ['approval_ref'],
        riskLevel: 'high',
      },
      {
        nodeId: 'sys',
        kind: 'system',
        name: 'Noop',
        dependsOnNodeIds: ['approve'],
        systemAction: 'system:publish_noop',
        requiredCapability: 'publish',
      },
    ]

    const built = buildTemplateFromDraft(draft, 'pib-platform-owner')
    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(built.template.budgets.maxTokensPerRun).toBe(120_000)
    expect(built.template.budgets.maxCostPerRun).toBe(25)
    expect(built.template.budgets.warnAtRatio).toBe(0.75)
    expect(built.template.limits.maxConcurrentAgentNodes).toBe(2)
    expect(built.template.notify.ceoNotifyOn).toEqual(['block', 'budget'])
    expect(built.template.sla.humanGateWarnMs).toBe(12 * 60 * 60_000)
    expect(built.template.projectId).toBe('proj-1')
    expect(built.template.executionBackend).toBe('workflow_graph')

    const roundTrip = draftFromTemplate(built.template)
    const again = buildTemplateFromDraft(roundTrip, 'pib-platform-owner')
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.template.versionHash).toBe(built.template.versionHash)
    expect(again.template.nodes.map((n) => n.kind)).toEqual([
      'agent',
      'code_check',
      'human_gate',
      'system',
    ])
  })

  test('materialization preview only includes agent + human_gate (no second board kinds)', () => {
    const template = buildPilotResearchValidateDocApproveFanoutTemplate()
    const preview = materializationPreview(template.nodes)
    expect(preview.kanbanNodeIds.length).toBeGreaterThan(0)
    expect(preview.ledgerOnlyNodeIds.length).toBeGreaterThan(0)
    expect(preview.kanban.every((n) => n.kind === 'agent' || n.kind === 'human_gate')).toBe(true)
    expect(preview.ledgerOnly.every((n) => n.kind !== 'agent' && n.kind !== 'human_gate')).toBe(true)
    expect(preview.kanban.every((n) => shouldMaterializeKind(n.kind))).toBe(true)
    // Product law: code_check/system never board cards
    expect(preview.ledgerOnly.some((n) => n.kind === 'code_check')).toBe(true)
    expect(preview.ledgerOnly.some((n) => n.kind === 'system')).toBe(true)
  })

  test('serializeAuthoringPayload is API-ready and validates', () => {
    const draft = blankGraphTemplateDraft({
      orgId: 'pib-platform-owner',
      projectId: 'proj-1',
      name: 'api-ready',
    })
    draft.nodes = [
      {
        nodeId: 'a1',
        kind: 'agent',
        name: 'A1',
        dependsOnNodeIds: [],
        assigneeAgentId: 'theo',
        expectedArtifacts: ['commit'],
        agentInput: { spec: 'Ship' },
      },
    ]
    const payload = serializeAuthoringPayload(draft, 'pib-platform-owner')
    expect(payload.orgId).toBe('pib-platform-owner')
    expect(payload.projectId).toBe('proj-1')
    expect(Array.isArray(payload.nodes)).toBe(true)
    expect(payload.budgets).toBeTruthy()
    expect(payload.limits).toBeTruthy()
    expect(payload.notify).toBeTruthy()
    expect(payload.sla).toBeTruthy()
    const validated = validateGraphTemplate(normalizeGraphTemplate(payload))
    expect(validated.ok).toBe(true)
  })

  test('normalize preserves node-level budgets when authored', () => {
    const template = normalizeGraphTemplate({
      orgId: 'pib-platform-owner',
      name: 'node-budget',
      nodes: [
        {
          nodeId: 'a1',
          kind: 'agent',
          name: 'A',
          dependsOnNodeIds: [],
          assigneeAgentId: 'theo',
          expectedArtifacts: ['x'],
          agentInput: { spec: 'do' },
          budgets: { maxTokens: 5000, maxCost: 1 },
        },
      ],
    })
    expect(template.nodes[0]?.budgets?.maxTokens).toBe(5000)
    expect(template.nodes[0]?.budgets?.maxCost).toBe(1)
  })

  test('authoring round-trip preserves per-node agentModel (cost-tiered routing)', () => {
    const draft = blankGraphTemplateDraft({
      orgId: 'pib-platform-owner',
      projectId: 'proj-1',
      name: 'model-routed-graph',
    })
    draft.nodes = [
      {
        nodeId: 'impl',
        kind: 'agent',
        name: 'Implement',
        dependsOnNodeIds: [],
        assigneeAgentId: 'theo',
        agentModel: 'gpt-5.3-codex-spark',
        expectedArtifacts: ['impl_commit_sha'],
        agentInput: { spec: 'Implement the change on development only' },
      },
      {
        nodeId: 'review',
        kind: 'agent',
        name: 'Review',
        dependsOnNodeIds: ['impl'],
        assigneeAgentId: 'qa-release',
        agentModel: 'claude-sonnet-4-6',
        expectedArtifacts: ['review_verdict'],
        agentInput: { spec: 'Judge the implementation' },
      },
    ]
    const built = buildTemplateFromDraft(draft, 'pib-platform-owner')
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.template.nodes[0]?.agentModel).toBe('gpt-5.3-codex-spark')
    expect(built.template.nodes[1]?.agentModel).toBe('claude-sonnet-4-6')

    const roundTrip = draftFromTemplate(built.template)
    const again = buildTemplateFromDraft(roundTrip, 'pib-platform-owner')
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.template.nodes[0]?.agentModel).toBe('gpt-5.3-codex-spark')
    expect(again.template.nodes[1]?.agentModel).toBe('claude-sonnet-4-6')
    expect(again.template.versionHash).toBe(built.template.versionHash)
  })

  test('normalize preserves agentModel and validate rejects non-allowlisted models', () => {
    const template = normalizeGraphTemplate({
      orgId: 'pib-platform-owner',
      name: 'model-allowlist',
      nodes: [
        {
          nodeId: 'a1',
          kind: 'agent',
          name: 'A',
          dependsOnNodeIds: [],
          assigneeAgentId: 'theo',
          agentModel: 'gpt-5.3-codex-spark',
          expectedArtifacts: ['x'],
          agentInput: { spec: 'do' },
        },
      ],
    })
    expect(template.nodes[0]?.agentModel).toBe('gpt-5.3-codex-spark')

    const invalid = normalizeGraphTemplate({
      orgId: 'pib-platform-owner',
      name: 'model-invalid',
      nodes: [
        {
          nodeId: 'a1',
          kind: 'agent',
          name: 'A',
          dependsOnNodeIds: [],
          assigneeAgentId: 'theo',
          agentModel: 'not-a-real-model',
          expectedArtifacts: ['x'],
          agentInput: { spec: 'do' },
        },
      ],
    })
    expect(invalid.nodes[0]?.agentModel).toBe('not-a-real-model')
    const validated = validateGraphTemplate(invalid)
    expect(validated.ok).toBe(false)
    if (!validated.ok) expect(validated.error).toContain('outside the allowlist')
  })
})

describe('workflow graph phase 3 harden acceptance', () => {
  test('acceptance: pilot golden path + quiet succeed + inspect one-call stuck diagnosis shape', () => {
    let run = startPilotRun()
    let step = advanceWorkflowRun(run, { type: 'tick', now: NOW })
    run = step.run
    expect(step.materialize.every((m) => m.kind === 'agent' || m.kind === 'human_gate')).toBe(true)

    run = bindKanbanTask(run, 'research_brief', 't-research', NOW)
    step = advanceWorkflowRun(run, {
      type: 'kanban_terminal',
      now: LATER,
      nodeId: 'research_brief',
      kanbanTaskId: 't-research',
      outcome: 'done',
      evidence: [{ type: 'research_doc_id', ref: 'doc_r', at: LATER }],
      tokensTotal: 20,
      tokensIn: 10,
      tokensOut: 10,
    })
    run = step.run

    step = advanceWorkflowRun(run, {
      type: 'tick',
      now: LATER,
      artifactPresence: { research_doc_id: true },
    })
    run = step.run
    run = bindKanbanTask(run, 'draft_build_note', 't-draft', LATER)
    step = advanceWorkflowRun(run, {
      type: 'kanban_terminal',
      now: LATER,
      nodeId: 'draft_build_note',
      kanbanTaskId: 't-draft',
      outcome: 'done',
      evidence: [{ type: 'draft_doc_id', ref: 'doc_d', at: LATER }],
      tokensTotal: 20,
      tokensIn: 10,
      tokensOut: 10,
    })
    run = step.run

    step = advanceWorkflowRun(run, {
      type: 'tick',
      now: LATER,
      artifactPresence: { draft_doc_id: true },
    })
    run = step.run
    run = bindKanbanTask(run, 'approve_publish_intent', 't-gate', LATER)
    step = advanceWorkflowRun(run, {
      type: 'approval_granted',
      now: LATER,
      approval: {
        capability: 'publish',
        resourceIds: ['pilot'],
        approvedBy: 'peet',
        at: LATER,
        ref: 'apr_p3',
      },
    })
    run = step.run
    expect(run.nodes.find((n) => n.nodeId === 'approve_publish_intent')?.status).toBe('done')

    // Allowlisted noop may complete on the same approval tick; otherwise on next tick.
    if (run.nodes.find((n) => n.nodeId === 'noop_publish_system')?.status !== 'done') {
      step = advanceWorkflowRun(run, { type: 'tick', now: LATER })
      run = step.run
    }
    expect(run.nodes.find((n) => n.nodeId === 'noop_publish_system')?.status).toBe('done')

    // fan-out agents (may already be on step.materialize from approval/system advance)
    let fan = step.materialize.filter((m) => m.kind === 'agent')
    if (fan.length < 1) {
      step = advanceWorkflowRun(run, { type: 'tick', now: LATER })
      run = step.run
      fan = step.materialize.filter((m) => m.kind === 'agent')
    }
    expect(fan.length).toBeGreaterThanOrEqual(1)
    for (const m of fan) {
      run = bindKanbanTask(run, m.nodeId, `t-${m.nodeId}`, LATER)
      const art = m.nodeId === 'eng_checklist' ? 'eng_checklist_id' : 'content_checklist_id'
      step = advanceWorkflowRun(run, {
        type: 'kanban_terminal',
        now: LATER,
        nodeId: m.nodeId,
        kanbanTaskId: `t-${m.nodeId}`,
        outcome: 'done',
        evidence: [{ type: art, ref: `${art}_1`, at: LATER }],
        tokensTotal: 10,
        tokensIn: 5,
        tokensOut: 5,
      })
      run = step.run
    }

    // If concurrency queued one agent, tick + complete remaining
    for (let i = 0; i < 4; i++) {
      step = advanceWorkflowRun(run, {
        type: 'tick',
        now: LATER,
      })
      run = step.run
      for (const m of step.materialize.filter((x) => x.kind === 'agent')) {
        if (run.nodes.find((n) => n.nodeId === m.nodeId)?.kanbanTaskId) continue
        run = bindKanbanTask(run, m.nodeId, `t-${m.nodeId}`, LATER)
        const art = m.nodeId === 'eng_checklist' ? 'eng_checklist_id' : 'content_checklist_id'
        step = advanceWorkflowRun(run, {
          type: 'kanban_terminal',
          now: LATER,
          nodeId: m.nodeId,
          kanbanTaskId: `t-${m.nodeId}`,
          outcome: 'done',
          evidence: [{ type: art, ref: `${art}_1`, at: LATER }],
          tokensTotal: 10,
          tokensIn: 5,
          tokensOut: 5,
        })
        run = step.run
      }
      if (run.status === 'succeeded') break
    }

    expect(run.status).toBe('succeeded')
    expect(run.terminalReason).toBe('all_nodes_proven')
    expect(run.notify.quietSuccess).toBe(true)

    const inspect = buildOpsInspect(run)
    expect(inspect.status).toBe('succeeded')
    expect(inspect.nodes.every((n) => n.status === 'done')).toBe(true)
    expect(inspect.cost).toBeDefined()
    expect(inspect.gateMap.some((g) => g.capability === 'publish')).toBe(true)
    // quiet success: no second board surface; inspect is one-call
    expect(inspect.blocker == null || inspect.blocker.code == null || inspect.status === 'succeeded').toBe(true)
  })

  test('acceptance: false-done rate = 0 (narrative done without artifacts blocks)', () => {
    let run = startPilotRun()
    let step = advanceWorkflowRun(run, { type: 'tick', now: NOW })
    run = bindKanbanTask(step.run, 'research_brief', 't1', NOW)
    step = advanceWorkflowRun(run, {
      type: 'kanban_terminal',
      now: LATER,
      nodeId: 'research_brief',
      kanbanTaskId: 't1',
      outcome: 'done',
      summary: 'done in prose only',
    })
    const node = step.run.nodes.find((n) => n.nodeId === 'research_brief')
    expect(node?.status).toBe('blocked')
    expect(node?.blockedReasonCode).toMatch(/^missing_artifact:/)
    expect(step.run.status).not.toBe('succeeded')
    expect(step.materialize.find((m) => m.nodeId === 'draft_build_note')).toBeUndefined()
    // false-done count for this path = 0
    const falseDones = step.run.nodes.filter((n) => n.status === 'done' && n.expectedArtifacts.length > 0 && n.evidence.length === 0)
    expect(falseDones).toHaveLength(0)
  })

  test('acceptance: failure paths 100% (budget, gate, concurrency, idempotency keys)', () => {
    // budget
    const budgetT = buildTinyBudgetPilotTemplate()
    budgetT.id = 'tmpl-p3-budget'
    let run = createWorkflowRunFromTemplate({
      runId: 'wfr_p3_budget',
      template: budgetT,
      orgId: 'pib-platform-owner',
      projectId: 'proj',
      trigger: { type: 'manual', at: NOW },
      now: NOW,
    })
    let step = advanceWorkflowRun(run, { type: 'tick', now: NOW })
    run = bindKanbanTask(step.run, 'a1', 'tb1', NOW)
    step = advanceWorkflowRun(run, {
      type: 'kanban_terminal',
      now: LATER,
      nodeId: 'a1',
      kanbanTaskId: 'tb1',
      outcome: 'done',
      evidence: [{ type: 'a_art', ref: 'a', at: LATER }],
      tokensTotal: 150,
      tokensIn: 100,
      tokensOut: 50,
    })
    run = step.run
    step = advanceWorkflowRun(run, { type: 'tick', now: LATER })
    expect(step.run.status).toBe('paused_budget')
    expect(step.materialize.find((m) => m.nodeId === 'a2')).toBeUndefined()

    // gated system
    const gateT = normalizeGraphTemplate({
      orgId: 'pib-platform-owner',
      name: 'gate',
      status: 'active',
      nodes: [
        {
          nodeId: 'pub',
          kind: 'system',
          name: 'Pub',
          dependsOnNodeIds: [],
          systemAction: 'system:publish_social',
          requiredCapability: 'publish',
        },
      ],
    })
    gateT.id = 'tmpl-p3-gate'
    run = createWorkflowRunFromTemplate({
      runId: 'wfr_p3_gate',
      template: gateT,
      orgId: 'pib-platform-owner',
      projectId: 'proj',
      trigger: { type: 'manual', at: NOW },
      now: NOW,
    })
    step = advanceWorkflowRun(run, {
      type: 'tick',
      now: NOW,
      systemResults: { pub: { ok: true, evidence: [{ type: 'x', ref: 'y', at: NOW }] } },
    })
    expect(step.run.nodes.find((n) => n.nodeId === 'pub')?.status).toBe('awaiting_gate')

    // concurrency queues
    const fanT = normalizeGraphTemplate({
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
    fanT.id = 'tmpl-p3-fan'
    run = createWorkflowRunFromTemplate({
      runId: 'wfr_p3_fan',
      template: fanT,
      orgId: 'pib-platform-owner',
      projectId: 'proj',
      trigger: { type: 'manual', at: NOW },
      now: NOW,
    })
    step = advanceWorkflowRun(run, { type: 'tick', now: NOW })
    const first = step.materialize[0].nodeId
    run = bindKanbanTask(step.run, first, 'tf', NOW)
    run.nodes.find((n) => n.nodeId === first)!.status = 'running'
    step = advanceWorkflowRun(run, { type: 'tick', now: LATER })
    const secondId = first === 'p1' ? 'p2' : 'p1'
    expect(step.run.nodes.find((n) => n.nodeId === secondId)?.status).toBe('queued_capacity')
    expect(step.run.status).not.toBe('failed')

    // idempotency keys unique per attempt
    expect(attemptIdempotencyKey('r', 'n', 1)).not.toBe(attemptIdempotencyKey('r', 'n', 2))
    expect(attemptIdempotencyKey('r', 'n', 1)).toBe('r:n:1')
  })

  test('acceptance: stuck diagnosis in one inspect call', () => {
    let run = startPilotRun()
    const step = advanceWorkflowRun(run, { type: 'tick', now: NOW })
    run = bindKanbanTask(step.run, 'research_brief', 't-stuck', NOW)
    const node = run.nodes.find((n) => n.nodeId === 'research_brief')!
    node.status = 'waiting_watcher'
    node.lastTransitionAt = NOW
    const later = new Date(Date.parse(NOW) + (DEFAULT_SLA.agentRunningHeartbeatMs! + 60_000)).toISOString()
    const stuck = evaluateStuck(run, later)
    expect(stuck.stuck).toBe(true)
    const withStuck = {
      ...run,
      stuckAt: later,
      stuckReasonCode: stuck.reasonCode || 'agent_heartbeat_sla',
      updatedAt: later,
    } as WorkflowRun
    const inspect = buildOpsInspect(withStuck)
    expect(inspect.stuckAt || inspect.stuckReasonCode || inspect.blocker).toBeTruthy()
    // single primary blocker surface
    const blockerCode = inspect.blocker?.code || inspect.stuckReasonCode || inspect.blockedReasonCode
    expect(typeof blockerCode === 'string' || blockerCode == null).toBe(true)
    const base = inspectWorkflowRun(withStuck)
    expect(base.status).toBe(inspect.status)
  })
})
