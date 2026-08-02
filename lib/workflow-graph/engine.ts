import {
  DEFAULT_ORG_GRAPH_AGENT_CAP,
  GLOBAL_AGENT_CONCURRENCY,
  IN_FLIGHT_AGENT_STATUSES,
  KANBAN_MATERIALIZING_KINDS,
  TERMINAL_NODE_STATUSES,
  TERMINAL_RUN_STATUSES,
  WATCHER_TRANSIENT_BACKOFF_MS,
  isGatedCapability,
} from './constants'
import { attemptIdempotencyKey } from './validation'
import type {
  AdvanceEvent,
  AdvanceResult,
  EngineAction,
  ErrorFamily,
  GraphTemplate,
  MaterializeIntent,
  WorkflowAttempt,
  WorkflowEvidence,
  WorkflowNodeState,
  WorkflowRun,
  WorkflowRunCost,
  WorkflowRunStatus,
  WorkflowNodeStatus,
} from './types'

function cloneRun(run: WorkflowRun): WorkflowRun {
  return {
    ...run,
    approvalRefs: [...run.approvalRefs],
    nodes: run.nodes.map((node) => ({
      ...node,
      dependsOnNodeIds: [...node.dependsOnNodeIds],
      evidence: [...node.evidence],
      expectedArtifacts: [...node.expectedArtifacts],
      verifierChecklist: [...node.verifierChecklist],
      agentInput: node.agentInput
        ? {
            ...node.agentInput,
            context: node.agentInput.context ? { ...node.agentInput.context } : undefined,
            constraints: node.agentInput.constraints ? [...node.agentInput.constraints] : undefined,
          }
        : undefined,
    })),
    attempts: Object.fromEntries(
      Object.entries(run.attempts).map(([nodeId, attempts]) => [
        nodeId,
        attempts.map((attempt) => ({ ...attempt })),
      ]),
    ),
    cost: { ...run.cost },
    limits: { ...run.limits },
    budgets: { ...run.budgets },
    notify: { ...run.notify },
    sla: { ...run.sla },
    gatedCapabilities: [...run.gatedCapabilities],
    trigger: { ...run.trigger },
  }
}

function nodeById(run: WorkflowRun, nodeId: string): WorkflowNodeState | undefined {
  return run.nodes.find((node) => node.nodeId === nodeId)
}

function depsProven(run: WorkflowRun, node: WorkflowNodeState): boolean {
  return node.dependsOnNodeIds.every((depId) => {
    const dep = nodeById(run, depId)
    return dep?.status === 'done'
  })
}

function materializes(kind: WorkflowNodeState['kind']): boolean {
  return KANBAN_MATERIALIZING_KINDS.has(kind as 'agent' | 'human_gate')
}

function topologicalWaves(nodes: WorkflowNodeState[]): string[][] {
  const remaining = new Set(nodes.map((node) => node.nodeId))
  const byId = new Map(nodes.map((node) => [node.nodeId, node]))
  const waves: string[][] = []
  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) => {
      const node = byId.get(id)!
      return node.dependsOnNodeIds.every((dep) => !remaining.has(dep))
    })
    if (ready.length === 0) {
      // cycle safeguard — dump remaining as one wave
      waves.push([...remaining])
      break
    }
    waves.push(ready)
    for (const id of ready) remaining.delete(id)
  }
  return waves
}

export function createWorkflowRunFromTemplate(input: {
  runId: string
  template: GraphTemplate
  orgId: string
  projectId?: string
  trigger: WorkflowRun['trigger']
  createdBy?: string
  now: string
  sourcePlaybookId?: string
  sourcePlaybookRunId?: string
  approvalRefs?: WorkflowRun['approvalRefs']
}): WorkflowRun {
  const nodes: WorkflowNodeState[] = input.template.nodes.map((node) => ({
    nodeId: node.nodeId,
    kind: node.kind,
    name: node.name,
    status: 'pending',
    currentAttempt: 0,
    dependsOnNodeIds: [...node.dependsOnNodeIds],
    lastTransitionAt: input.now,
    evidence: [],
    expectedArtifacts: [...(node.expectedArtifacts ?? [])],
    verifierChecklist: [...(node.verifierChecklist ?? [])],
    assigneeAgentId: node.assigneeAgentId,
    requiredCapability: node.requiredCapability,
    riskLevel: node.riskLevel,
    systemAction: node.systemAction,
    checkType: node.checkType,
    checkConfig: node.checkConfig,
    reviewerAgentId: node.reviewerAgentId,
    agentInput: node.agentInput,
    materializesToKanban: materializes(node.kind),
  }))

  const maxTokens = input.template.budgets.maxTokensPerRun ?? 2_000_000
  const cost: WorkflowRunCost = {
    maxTokensPerRun: maxTokens,
    maxCostPerRun: input.template.budgets.maxCostPerRun,
    warnAtRatio: input.template.budgets.warnAtRatio ?? 0.8,
    onExceed: input.template.budgets.onExceed,
    tokensIn: 0,
    tokensOut: 0,
    tokensTotal: 0,
    estimatedCost: 0,
    currency: input.template.budgets.currency,
    attemptCountAgent: 0,
    attemptCountTotal: 0,
    budgetStatus: 'within_budget',
    usageCompleteness: 'unavailable',
    consecutiveUnknownUsageAttempts: 0,
  }

  return {
    id: input.runId,
    orgId: input.orgId,
    templateId: input.template.id || 'unknown-template',
    templateVersion: input.template.version,
    templateVersionHash: input.template.versionHash,
    projectId: input.projectId || input.template.projectId,
    status: 'created',
    trigger: input.trigger,
    wavePointer: 0,
    limits: { ...input.template.limits },
    budgets: { ...input.template.budgets },
    cost,
    approvalRefs: input.approvalRefs ? [...input.approvalRefs] : [],
    notify: { ...input.template.notify },
    sla: { ...input.template.sla },
    gatedCapabilities: [...input.template.gatedCapabilities],
    nodes,
    attempts: {},
    sourcePlaybookId: input.sourcePlaybookId || input.template.sourcePlaybookId,
    sourcePlaybookRunId: input.sourcePlaybookRunId,
    startedAt: input.now,
    updatedAt: input.now,
    createdBy: input.createdBy,
  }
}

function setNodeStatus(
  run: WorkflowRun,
  actions: EngineAction[],
  nodeId: string,
  status: WorkflowNodeStatus,
  now: string,
  blockedReasonCode?: string,
  evidence?: WorkflowEvidence[],
): void {
  const node = nodeById(run, nodeId)
  if (!node) return
  node.status = status
  node.lastTransitionAt = now
  if (blockedReasonCode) node.blockedReasonCode = blockedReasonCode
  else if (status === 'done' || status === 'ready' || status === 'running') {
    node.blockedReasonCode = undefined
  }
  if (evidence?.length) {
    node.evidence.push(...evidence)
    run.lastEvidence = evidence[evidence.length - 1]
  }
  actions.push({
    type: 'mark_node',
    nodeId,
    status,
    blockedReasonCode,
    evidence,
  })
}

function setRunStatus(
  run: WorkflowRun,
  actions: EngineAction[],
  status: WorkflowRunStatus,
  opts?: { blockedReasonCode?: string; terminalReason?: string },
): void {
  run.status = status
  if (opts?.blockedReasonCode !== undefined) run.blockedReasonCode = opts.blockedReasonCode
  if (opts?.terminalReason !== undefined) run.terminalReason = opts.terminalReason
  actions.push({
    type: 'set_run_status',
    status,
    blockedReasonCode: opts?.blockedReasonCode,
    terminalReason: opts?.terminalReason,
  })
}

function inFlightAgentCount(run: WorkflowRun): number {
  return run.nodes.filter(
    (node) => node.kind === 'agent' && IN_FLIGHT_AGENT_STATUSES.has(node.status as 'claimed' | 'running' | 'waiting_watcher'),
  ).length
}

function hasApprovalForCapability(run: WorkflowRun, capability: string | undefined): boolean {
  if (!capability || !isGatedCapability(capability)) return true
  return run.approvalRefs.some((ref) => ref.capability === capability)
}

function missingArtifacts(
  expected: string[],
  evidence: WorkflowEvidence[],
  artifactPresence?: Record<string, boolean>,
): string[] {
  return expected.filter((artifactType) => {
    if (evidence.some((item) => item.type === artifactType && item.ref)) return false
    if (artifactPresence && artifactPresence[artifactType] === true) return false
    return true
  })
}

function recordUsage(
  run: WorkflowRun,
  actions: EngineAction[],
  now: string,
  usage: {
    tokensIn?: number
    tokensOut?: number
    tokensTotal?: number
    estimatedCost?: number
    isAgent: boolean
  },
): void {
  const tokensIn = usage.tokensIn ?? 0
  const tokensOut = usage.tokensOut ?? 0
  const tokensTotal = usage.tokensTotal ?? tokensIn + tokensOut
  const hasExact = tokensTotal > 0 || (usage.tokensIn !== undefined || usage.tokensOut !== undefined)

  run.cost.tokensIn += tokensIn
  run.cost.tokensOut += tokensOut
  run.cost.tokensTotal += tokensTotal
  run.cost.estimatedCost += usage.estimatedCost ?? 0
  run.cost.attemptCountTotal += 1
  if (usage.isAgent) run.cost.attemptCountAgent += 1

  if (hasExact) {
    run.cost.usageCompleteness = 'exact'
    run.cost.consecutiveUnknownUsageAttempts = 0
  } else if (usage.isAgent) {
    run.cost.consecutiveUnknownUsageAttempts = (run.cost.consecutiveUnknownUsageAttempts ?? 0) + 1
    if ((run.cost.consecutiveUnknownUsageAttempts ?? 0) > 2) {
      run.cost.budgetStatus = 'unknown_usage'
      run.cost.lastBudgetEventAt = now
    } else if (run.cost.usageCompleteness === 'unavailable') {
      run.cost.usageCompleteness = 'partial'
    }
  }

  const ratio = run.cost.maxTokensPerRun > 0
    ? run.cost.tokensTotal / run.cost.maxTokensPerRun
    : 0
  if (run.cost.tokensTotal >= run.cost.maxTokensPerRun
    || (run.cost.maxCostPerRun !== undefined && run.cost.estimatedCost >= run.cost.maxCostPerRun)) {
    run.cost.budgetStatus = 'exceeded'
    run.cost.lastBudgetEventAt = now
  } else if (ratio >= run.cost.warnAtRatio && run.cost.budgetStatus === 'within_budget') {
    run.cost.budgetStatus = 'warn'
    run.cost.lastBudgetEventAt = now
  }

  actions.push({ type: 'update_cost', cost: { ...run.cost } })
}

function canStartAgentNode(
  run: WorkflowRun,
  orgInFlightAgentClaims: number,
  agentInFlightByAssignee: Record<string, number>,
  assigneeAgentId?: string,
): { ok: true } | { ok: false; reason: string; runStatus?: WorkflowRunStatus } {
  if (run.cost.budgetStatus === 'exceeded') {
    return {
      ok: false,
      reason: 'budget_exceeded',
      runStatus: run.cost.onExceed === 'fail_run' ? 'failed' : 'paused_budget',
    }
  }
  if (run.cost.budgetStatus === 'unknown_usage') {
    return { ok: false, reason: 'unknown_usage', runStatus: 'paused_budget' }
  }

  const maxAgentAttempts = run.budgets.maxAgentNodeAttemptsPerRun ?? 40
  if (run.cost.attemptCountAgent >= maxAgentAttempts) {
    return { ok: false, reason: 'budget_exceeded', runStatus: 'paused_budget' }
  }

  if (inFlightAgentCount(run) >= run.limits.maxConcurrentAgentNodes) {
    return { ok: false, reason: 'concurrency_cap:run' }
  }

  const orgCap = run.limits.maxConcurrentAgentNodesOrgDefault ?? DEFAULT_ORG_GRAPH_AGENT_CAP
  if (orgInFlightAgentClaims >= orgCap) {
    return { ok: false, reason: 'concurrency_cap:org' }
  }

  if (assigneeAgentId) {
    const agentCount = agentInFlightByAssignee[assigneeAgentId] ?? 0
    if (agentCount >= GLOBAL_AGENT_CONCURRENCY) {
      return { ok: false, reason: 'concurrency_cap:agent' }
    }
  }

  return { ok: true }
}

function latestAttempt(run: WorkflowRun, nodeId: string): WorkflowAttempt | undefined {
  const attempts = run.attempts[nodeId] ?? []
  return attempts[attempts.length - 1]
}

function isAgentRetryDue(run: WorkflowRun, node: WorkflowNodeState, now: string): boolean {
  const retryAt = node.retryAt || latestAttempt(run, node.nodeId)?.retryAt
  if (!retryAt) return true
  const dueMs = Date.parse(retryAt)
  const nowMs = Date.parse(now)
  if (Number.isNaN(dueMs) || Number.isNaN(nowMs)) return true
  return nowMs >= dueMs
}

function transientBackoffMs(attemptNumber: number): number {
  // attempt 1 failure → index 0 (1m); attempt 2 → index 1 (5m); attempt 3 → index 2 (15m)
  return WATCHER_TRANSIENT_BACKOFF_MS[Math.min(Math.max(attemptNumber - 1, 0), WATCHER_TRANSIENT_BACKOFF_MS.length - 1)] ?? 60_000
}

function buildMaterializeIntent(run: WorkflowRun, node: WorkflowNodeState): MaterializeIntent {
  const dependsOnKanbanTaskIds = node.dependsOnNodeIds
    .map((depId) => nodeById(run, depId)?.kanbanTaskId)
    .filter((id): id is string => Boolean(id))

  const isGate = node.kind === 'human_gate'
  const nextAttempt = node.currentAttempt + 1
  const requeueExisting = Boolean(node.lastKanbanTaskId) || node.status === 'retry_wait'
  const labels = [
    `workflow-run:${run.id}`,
    `workflow-node:${node.nodeId}`,
    `workflow-template:${run.templateId}`,
    ...(isGate ? ['approval-gate', 'human_gate'] : ['workflow-agent']),
    ...(requeueExisting ? [`workflow-attempt:${nextAttempt}`, 'workflow-retry'] : []),
  ]

  return {
    nodeId: node.nodeId,
    kind: isGate ? 'human_gate' : 'agent',
    title: node.name,
    assigneeAgentId: isGate ? undefined : node.assigneeAgentId,
    agentStatus: isGate ? 'awaiting-input' : 'pending',
    columnId: isGate ? 'blocked' : 'todo',
    dependsOnKanbanTaskIds,
    expectedArtifacts: [...node.expectedArtifacts],
    verifierChecklist: [...node.verifierChecklist],
    reviewerAgentId: node.reviewerAgentId,
    requiredCapability: node.requiredCapability,
    riskLevel: node.riskLevel,
    approvalGate: isGate ? (node.requiredCapability || 'approval') : undefined,
    labels,
    agentInput: node.agentInput
      ? {
          ...node.agentInput,
          context: {
            ...(node.agentInput.context ?? {}),
            workflowRunId: run.id,
            workflowNodeId: node.nodeId,
            workflowAttempt: nextAttempt,
            expectedArtifacts: node.expectedArtifacts,
            verifierChecklist: node.verifierChecklist,
            ...(requeueExisting ? { retryReason: 'transient_infra' } : {}),
          },
        }
      : undefined,
    // Attempt-scoped so retries do not collide with the first dispatch key.
    idempotencyKey: attemptIdempotencyKey(run.id || 'run', node.nodeId, nextAttempt),
    requeueExisting,
    previousKanbanTaskId: node.lastKanbanTaskId,
  }
}

function startAttempt(
  run: WorkflowRun,
  actions: EngineAction[],
  node: WorkflowNodeState,
  now: string,
  status: WorkflowNodeStatus,
): WorkflowAttempt {
  const attemptNumber = node.currentAttempt + 1
  node.currentAttempt = attemptNumber
  const attempt: WorkflowAttempt = {
    attemptNumber,
    idempotencyKey: attemptIdempotencyKey(run.id || 'run', node.nodeId, attemptNumber),
    status,
    startedAt: now,
    kanbanTaskId: node.kanbanTaskId,
  }
  if (!run.attempts[node.nodeId]) run.attempts[node.nodeId] = []
  // Idempotent: do not double-append same attempt number
  const existing = run.attempts[node.nodeId].find((item) => item.attemptNumber === attemptNumber)
  if (existing) return existing
  run.attempts[node.nodeId].push(attempt)
  actions.push({ type: 'start_attempt', nodeId: node.nodeId, attempt })
  return attempt
}

function completeAttempt(
  run: WorkflowRun,
  actions: EngineAction[],
  nodeId: string,
  attemptNumber: number,
  patch: Partial<WorkflowAttempt>,
): void {
  const attempts = run.attempts[nodeId] ?? []
  const attempt = attempts.find((item) => item.attemptNumber === attemptNumber)
  if (!attempt) return
  Object.assign(attempt, patch)
  actions.push({ type: 'complete_attempt', nodeId, attemptNumber, patch })
}

function evaluateCodeCheck(
  node: WorkflowNodeState,
  artifactPresence?: Record<string, boolean>,
): { ok: boolean; missing: string[]; evidence: WorkflowEvidence[] } {
  const expected = node.expectedArtifacts.length
    ? node.expectedArtifacts
    : (typeof node.checkConfig?.artifactTypes === 'object'
        && Array.isArray(node.checkConfig?.artifactTypes)
        ? (node.checkConfig.artifactTypes as string[])
        : [])

  if (node.checkType === 'always_pass') {
    return {
      ok: true,
      missing: [],
      evidence: [{ type: 'code_check', ref: node.nodeId, label: 'always_pass', at: new Date().toISOString() }],
    }
  }

  const missing = missingArtifacts(expected, node.evidence, artifactPresence)
  if (missing.length) {
    return { ok: false, missing, evidence: [] }
  }

  return {
    ok: true,
    missing: [],
    evidence: expected.map((type) => ({
      type,
      ref: `verified:${type}`,
      label: 'code_check',
      at: new Date().toISOString(),
    })),
  }
}

function markRunTerminalIfComplete(run: WorkflowRun, actions: EngineAction[], now: string): void {
  const allDone = run.nodes.every((node) => node.status === 'done')
  if (allDone) {
    setRunStatus(run, actions, 'succeeded', { terminalReason: 'all_nodes_proven' })
    run.completedAt = now
    run.blockedReasonCode = undefined
    return
  }

  const anyBlocked = run.nodes.some((node) => node.status === 'blocked')
  const remainingOpen = run.nodes.some((node) => !TERMINAL_NODE_STATUSES.has(node.status as 'done' | 'blocked' | 'cancelled'))
  if (anyBlocked && !remainingOpen) {
    const blocked = run.nodes.find((node) => node.status === 'blocked')
    setRunStatus(run, actions, 'failed', {
      blockedReasonCode: blocked?.blockedReasonCode,
      terminalReason: 'blocked_without_open_paths',
    })
    run.completedAt = now
  }
}

function activateReadyNodes(
  run: WorkflowRun,
  actions: EngineAction[],
  materialize: MaterializeIntent[],
  event: Extract<AdvanceEvent, { type: 'tick' }>,
): void {
  if (TERMINAL_RUN_STATUSES.has(run.status as 'succeeded' | 'failed' | 'cancelled' | 'abandoned_candidate')) return
  if (run.status === 'paused_budget' && run.cost.onExceed === 'pause_run') {
    // Still allow non-agent ledger nodes to drain; block new agent starts via canStartAgentNode
  }

  if (run.status === 'created') {
    setRunStatus(run, actions, 'running')
  }

  const waves = topologicalWaves(run.nodes)
  const currentWaveIndex = waves.findIndex((wave) =>
    wave.some((nodeId) => {
      const node = nodeById(run, nodeId)
      return node && !TERMINAL_NODE_STATUSES.has(node.status as 'done' | 'blocked' | 'cancelled')
    }),
  )
  if (currentWaveIndex >= 0 && currentWaveIndex !== run.wavePointer) {
    run.wavePointer = currentWaveIndex
    actions.push({ type: 'set_wave', wavePointer: currentWaveIndex })
  }

  for (const node of run.nodes) {
    if (TERMINAL_NODE_STATUSES.has(node.status as 'done' | 'blocked' | 'cancelled')) continue
    if (!depsProven(run, node)) {
      if (node.status !== 'pending') {
        // keep waiting
      }
      continue
    }

    // Gated system/agent execute path
    if (
      (node.kind === 'system' || node.kind === 'agent')
      && isGatedCapability(node.requiredCapability)
      && !hasApprovalForCapability(run, node.requiredCapability)
    ) {
      if (node.status !== 'awaiting_gate') {
        setNodeStatus(
          run,
          actions,
          node.nodeId,
          'awaiting_gate',
          event.now,
          `waiting_human_gate:${node.requiredCapability}`,
        )
      }
      continue
    }

    if (node.kind === 'agent' || node.kind === 'human_gate') {
      const baseEligible =
        node.status === 'pending'
        || node.status === 'ready'
        || node.status === 'queued_capacity'
      const retryEligible = node.status === 'retry_wait' && isAgentRetryDue(run, node, event.now)

      if (baseEligible || retryEligible) {
        // Re-arm retry_wait: clear bind so activate can emit materialize/requeue intent.
        // lastKanbanTaskId keeps the prior task for store requeue.
        if (retryEligible) {
          if (node.kanbanTaskId) {
            node.lastKanbanTaskId = node.kanbanTaskId
            node.kanbanTaskId = undefined
          }
          node.retryAt = undefined
        }

        if (!node.kanbanTaskId) {
          if (node.kind === 'agent') {
            const capacity = canStartAgentNode(
              run,
              event.orgInFlightAgentClaims ?? 0,
              event.agentInFlightByAssignee ?? {},
              node.assigneeAgentId,
            )
            if (!capacity.ok) {
              if (capacity.runStatus) {
                setRunStatus(run, actions, capacity.runStatus, {
                  blockedReasonCode: capacity.reason,
                  terminalReason: capacity.runStatus === 'failed' ? capacity.reason : undefined,
                })
                if (capacity.runStatus === 'failed') {
                  setNodeStatus(run, actions, node.nodeId, 'blocked', event.now, capacity.reason)
                  continue
                }
              }
              // Preserve retry_wait identity when capacity is full so later ticks still re-arm.
              setNodeStatus(
                run,
                actions,
                node.nodeId,
                retryEligible ? 'retry_wait' : 'queued_capacity',
                event.now,
                capacity.reason,
              )
              continue
            }
          }

          const intent = buildMaterializeIntent(run, node)
          // Reuse existing materialize action if already queued this tick
          if (!materialize.some((item) => item.nodeId === node.nodeId)) {
            materialize.push(intent)
            actions.push({ type: 'materialize', intent })
          }
          startAttempt(run, actions, node, event.now, node.kind === 'human_gate' ? 'awaiting_gate' : 'waiting_watcher')
          setNodeStatus(
            run,
            actions,
            node.nodeId,
            node.kind === 'human_gate' ? 'awaiting_gate' : 'waiting_watcher',
            event.now,
          )
        }
      }
      continue
    }

    if (node.kind === 'code_check') {
      if (node.status === 'pending' || node.status === 'ready' || node.status === 'retry_wait') {
        startAttempt(run, actions, node, event.now, 'running')
        setNodeStatus(run, actions, node.nodeId, 'running', event.now)
        const check = evaluateCodeCheck(node, event.artifactPresence)
        if (check.ok) {
          completeAttempt(run, actions, node.nodeId, node.currentAttempt, {
            status: 'done',
            completedAt: event.now,
            summary: 'code_check passed',
          })
          setNodeStatus(run, actions, node.nodeId, 'done', event.now, undefined, check.evidence)
        } else {
          const missing = check.missing[0] || 'unknown'
          completeAttempt(run, actions, node.nodeId, node.currentAttempt, {
            status: 'blocked',
            completedAt: event.now,
            errorFamily: 'verifier_fail',
            retryable: node.currentAttempt < 2,
            summary: `missing artifacts: ${check.missing.join(',')}`,
          })
          if (node.currentAttempt < 2) {
            setNodeStatus(run, actions, node.nodeId, 'retry_wait', event.now, `missing_artifact:${missing}`)
          } else {
            setNodeStatus(run, actions, node.nodeId, 'blocked', event.now, `missing_artifact:${missing}`)
          }
        }
      }
      continue
    }

    if (node.kind === 'system') {
      if (node.status === 'pending' || node.status === 'ready' || node.status === 'retry_wait') {
        startAttempt(run, actions, node, event.now, 'running')
        setNodeStatus(run, actions, node.nodeId, 'running', event.now)
      }
      if (node.status === 'running') {
        const result = event.systemResults?.[node.nodeId] ?? event.systemResults?.[node.systemAction || '']
        if (!result) {
          // leave running until external executor reports; for pure engine tests supply systemResults
          continue
        }
        if (result.ok) {
          completeAttempt(run, actions, node.nodeId, Math.max(node.currentAttempt, 1), {
            status: 'done',
            completedAt: event.now,
            summary: 'system ok',
          })
          setNodeStatus(run, actions, node.nodeId, 'done', event.now, undefined, result.evidence)
        } else {
          const family = result.errorFamily || 'unknown'
          const retryable = family === 'transient_infra' && node.currentAttempt < 5
          completeAttempt(run, actions, node.nodeId, Math.max(node.currentAttempt, 1), {
            status: 'blocked',
            completedAt: event.now,
            errorFamily: family,
            retryable,
          })
          setNodeStatus(
            run,
            actions,
            node.nodeId,
            retryable ? 'retry_wait' : 'blocked',
            event.now,
            family === 'capability' ? 'capability_denied' : `verifier_fail`,
          )
        }
      }
      continue
    }

    if (node.kind === 'delay' || node.kind === 'wait_event') {
      // Phase 1: auto-complete delay with delayMs=0 or missing; wait_event stays waiting_event
      if (node.kind === 'delay') {
        startAttempt(run, actions, node, event.now, 'running')
        completeAttempt(run, actions, node.nodeId, node.currentAttempt, {
          status: 'done',
          completedAt: event.now,
          summary: 'delay elapsed',
        })
        setNodeStatus(run, actions, node.nodeId, 'done', event.now)
      } else if (node.status !== 'waiting_event') {
        setNodeStatus(run, actions, node.nodeId, 'waiting_event', event.now)
      }
    }
  }
}

function handleKanbanTerminal(
  run: WorkflowRun,
  actions: EngineAction[],
  event: Extract<AdvanceEvent, { type: 'kanban_terminal' }>,
): void {
  const node = nodeById(run, event.nodeId)
  if (!node) return
  if (node.kanbanTaskId && event.kanbanTaskId && node.kanbanTaskId !== event.kanbanTaskId) return

  if (!node.kanbanTaskId) node.kanbanTaskId = event.kanbanTaskId

  const isAgent = node.kind === 'agent'
  recordUsage(run, actions, event.now, {
    tokensIn: event.tokensIn,
    tokensOut: event.tokensOut,
    tokensTotal: event.tokensTotal,
    estimatedCost: event.estimatedCost,
    isAgent,
  })

  if (event.outcome === 'done') {
    const missing = missingArtifacts(node.expectedArtifacts, [
      ...node.evidence,
      ...(event.evidence ?? []),
    ])
    if (missing.length > 0) {
      // Fail closed: narrative done without proof is not done
      completeAttempt(run, actions, node.nodeId, Math.max(node.currentAttempt, 1), {
        status: 'blocked',
        completedAt: event.now,
        errorFamily: 'agent_incomplete',
        retryable: node.currentAttempt < 2,
        summary: event.summary,
        hermesRunId: event.hermesRunId,
        tokensIn: event.tokensIn,
        tokensOut: event.tokensOut,
        tokensTotal: event.tokensTotal,
        estimatedCost: event.estimatedCost,
        model: event.model,
        provider: event.provider,
      })
      setNodeStatus(
        run,
        actions,
        node.nodeId,
        'blocked',
        event.now,
        `missing_artifact:${missing[0]}`,
        event.evidence,
      )
      if (run.notify.alertOnBlock) {
        run.blockedReasonCode = `missing_artifact:${missing[0]}`
      }
      return
    }

    completeAttempt(run, actions, node.nodeId, Math.max(node.currentAttempt, 1), {
      status: 'done',
      completedAt: event.now,
      summary: event.summary,
      hermesRunId: event.hermesRunId,
      tokensIn: event.tokensIn,
      tokensOut: event.tokensOut,
      tokensTotal: event.tokensTotal,
      estimatedCost: event.estimatedCost,
      model: event.model,
      provider: event.provider,
    })
    setNodeStatus(run, actions, node.nodeId, 'done', event.now, undefined, event.evidence)
    return
  }

  if (event.outcome === 'rejected') {
    completeAttempt(run, actions, node.nodeId, Math.max(node.currentAttempt, 1), {
      status: 'blocked',
      completedAt: event.now,
      errorFamily: 'approval_denied',
      retryable: false,
      summary: event.summary,
    })
    setNodeStatus(run, actions, node.nodeId, 'blocked', event.now, 'approval_denied', event.evidence)
    return
  }

  if (event.outcome === 'awaiting_input') {
    setNodeStatus(run, actions, node.nodeId, 'awaiting_gate', event.now, node.blockedReasonCode)
    return
  }

  // blocked
  const family: ErrorFamily = event.errorFamily || 'unknown'
  const maxAttempts = family === 'transient_infra' ? 3 : family === 'agent_incomplete' || family === 'verifier_fail' ? 2 : 1
  const attemptNumber = Math.max(node.currentAttempt, 1)
  // Retry while completed attempts remain under max (attempt 1 and 2 may retry; attempt 3 blocks).
  const retryable = family === 'transient_infra' && attemptNumber < maxAttempts
  const retryAt = retryable
    ? new Date(Date.parse(event.now) + transientBackoffMs(attemptNumber)).toISOString()
    : undefined
  completeAttempt(run, actions, node.nodeId, attemptNumber, {
    status: retryable ? 'retry_wait' : 'blocked',
    completedAt: event.now,
    errorFamily: family,
    retryable,
    summary: event.summary,
    hermesRunId: event.hermesRunId,
    retryAt,
  })

  if (retryable) {
    // Keep last bind for store requeue; clear active bind so activateReadyNodes can re-dispatch after backoff.
    if (node.kanbanTaskId) {
      node.lastKanbanTaskId = node.kanbanTaskId
    }
    node.retryAt = retryAt
    setNodeStatus(run, actions, node.nodeId, 'retry_wait', event.now, 'transient_infra_retry')
  } else {
    const reason =
      family === 'transient_infra'
        ? 'transient_infra_exhausted'
        : family === 'capability'
          ? 'capability_denied'
          : family === 'budget'
            ? 'budget_exceeded'
            : family === 'policy'
              ? 'invalid_spec'
              : family === 'approval_denied'
                ? 'approval_denied'
                : family === 'unknown'
                  ? 'unknown'
                  : `missing_artifact:blocked`
    node.retryAt = undefined
    setNodeStatus(run, actions, node.nodeId, 'blocked', event.now, reason, event.evidence)
    run.blockedReasonCode = reason
  }
}

/**
 * Pure engine step. Does not touch Firestore or Kanban — returns intents.
 * Apply materialize intents externally, then call bindKanbanTask + advance again.
 */
export function advanceWorkflowRun(runInput: WorkflowRun, event: AdvanceEvent): AdvanceResult {
  const run = cloneRun(runInput)
  const actions: EngineAction[] = []
  const materialize: MaterializeIntent[] = []
  run.updatedAt = event.now

  if (event.type === 'cancel') {
    if (!TERMINAL_RUN_STATUSES.has(run.status as 'succeeded' | 'failed' | 'cancelled' | 'abandoned_candidate')) {
      for (const node of run.nodes) {
        if (!TERMINAL_NODE_STATUSES.has(node.status as 'done' | 'blocked' | 'cancelled')) {
          setNodeStatus(run, actions, node.nodeId, 'cancelled', event.now)
        }
      }
      setRunStatus(run, actions, 'cancelled', { terminalReason: event.reason })
      run.completedAt = event.now
    }
    return { run, actions, materialize }
  }

  if (event.type === 'approval_granted') {
    const exists = run.approvalRefs.some((ref) => ref.ref === event.approval.ref)
    if (!exists) run.approvalRefs.push(event.approval)
    // Release nodes waiting on this capability
    for (const node of run.nodes) {
      if (
        node.status === 'awaiting_gate'
        && node.requiredCapability
        && node.requiredCapability === event.approval.capability
      ) {
        setNodeStatus(run, actions, node.nodeId, 'ready', event.now)
      }
    }
    if (run.status === 'paused_approval') setRunStatus(run, actions, 'running')
  }

  if (event.type === 'kanban_terminal') {
    handleKanbanTerminal(run, actions, event)
  }

  // Always try to activate newly ready work after terminal/approval/tick
  activateReadyNodes(run, actions, materialize, {
    type: 'tick',
    now: event.now,
    orgInFlightAgentClaims: event.type === 'tick' ? event.orgInFlightAgentClaims : undefined,
    agentInFlightByAssignee: event.type === 'tick' ? event.agentInFlightByAssignee : undefined,
    artifactPresence: event.type === 'tick' ? event.artifactPresence : undefined,
    systemResults: event.type === 'tick' ? event.systemResults : undefined,
  })

  markRunTerminalIfComplete(run, actions, event.now)

  return { run, actions, materialize }
}

/** Bind a kanban task id onto a node after successful materialize (idempotent per active bind). */
export function bindKanbanTask(runInput: WorkflowRun, nodeId: string, kanbanTaskId: string, now: string): WorkflowRun {
  const run = cloneRun(runInput)
  const node = nodeById(run, nodeId)
  if (!node) return run
  // Allow rebind after retry re-arm cleared kanbanTaskId; reject only conflicting active binds.
  if (node.kanbanTaskId && node.kanbanTaskId !== kanbanTaskId) return run
  node.kanbanTaskId = kanbanTaskId
  node.lastKanbanTaskId = kanbanTaskId
  node.retryAt = undefined
  node.lastTransitionAt = now
  const attempts = run.attempts[nodeId] ?? []
  const latest = attempts[attempts.length - 1]
  if (latest && !latest.kanbanTaskId) latest.kanbanTaskId = kanbanTaskId
  run.updatedAt = now
  return run
}

export function inspectWorkflowRun(run: WorkflowRun): {
  runId?: string
  templateId: string
  templateVersion: number
  orgId: string
  projectId?: string
  status: WorkflowRunStatus
  wavePointer: number
  blockedReasonCode?: string
  stuckReasonCode?: string
  terminalReason?: string
  cost: WorkflowRunCost
  currentWaveNodeIds: string[]
  nodes: Array<{
    nodeId: string
    kind: string
    name: string
    status: WorkflowNodeStatus
    attempts: number
    assigneeAgentId?: string
    kanbanTaskId?: string
    lastKanbanTaskId?: string
    retryAt?: string
    blockedReasonCode?: string
    expectedArtifacts: string[]
    evidenceTypes: string[]
    materializesToKanban: boolean
  }>
  gateMap: Array<{ nodeId: string; capability?: string; status: WorkflowNodeStatus; hasApproval: boolean }>
  lastEvidence?: WorkflowEvidence
  approvalRefs: WorkflowRun['approvalRefs']
} {
  const waves = topologicalWaves(run.nodes)
  const currentWaveNodeIds = waves[run.wavePointer] ?? []
  return {
    runId: run.id,
    templateId: run.templateId,
    templateVersion: run.templateVersion,
    orgId: run.orgId,
    projectId: run.projectId,
    status: run.status,
    wavePointer: run.wavePointer,
    blockedReasonCode: run.blockedReasonCode,
    stuckReasonCode: run.stuckReasonCode,
    terminalReason: run.terminalReason,
    cost: run.cost,
    currentWaveNodeIds,
    nodes: run.nodes.map((node) => ({
      nodeId: node.nodeId,
      kind: node.kind,
      name: node.name,
      status: node.status,
      attempts: node.currentAttempt,
      assigneeAgentId: node.assigneeAgentId,
      kanbanTaskId: node.kanbanTaskId,
      lastKanbanTaskId: node.lastKanbanTaskId,
      retryAt: node.retryAt,
      blockedReasonCode: node.blockedReasonCode,
      expectedArtifacts: node.expectedArtifacts,
      evidenceTypes: node.evidence.map((item) => item.type),
      materializesToKanban: node.materializesToKanban,
    })),
    gateMap: run.nodes
      .filter((node) => node.kind === 'human_gate' || isGatedCapability(node.requiredCapability))
      .map((node) => ({
        nodeId: node.nodeId,
        capability: node.requiredCapability,
        status: node.status,
        hasApproval: hasApprovalForCapability(run, node.requiredCapability),
      })),
    lastEvidence: run.lastEvidence,
    approvalRefs: run.approvalRefs,
  }
}

export function shouldMaterializeKind(kind: string): kind is 'agent' | 'human_gate' {
  return kind === 'agent' || kind === 'human_gate'
}

export function isNodeProvenReady(run: WorkflowRun, nodeId: string): {
  ready: boolean
  reasons: string[]
} {
  const node = nodeById(run, nodeId)
  if (!node) return { ready: false, reasons: ['unknown_node'] }
  const reasons: string[] = []
  if (!depsProven(run, node)) reasons.push('deps_not_proven')
  if (isGatedCapability(node.requiredCapability) && !hasApprovalForCapability(run, node.requiredCapability)) {
    reasons.push(`waiting_human_gate:${node.requiredCapability}`)
  }
  if (run.cost.budgetStatus === 'exceeded') reasons.push('budget_exceeded')
  if (TERMINAL_RUN_STATUSES.has(run.status as 'succeeded' | 'failed' | 'cancelled' | 'abandoned_candidate')) {
    reasons.push('run_terminal')
  }
  return { ready: reasons.length === 0, reasons }
}
