/**
 * Phase 2 ops surface — pure stuck SLAs, inspector payload, thrash, notify facts.
 * No second board. No CEO permanent dashboard. Facts are stored for gatherers.
 */
import { DEFAULT_SLA, TERMINAL_RUN_STATUSES } from './constants'
import { inspectWorkflowRun } from './engine'
import { appendTimeline as appendTimelineShared } from './ops-timeline'
import type {
  GraphTemplate,
  WorkflowNodeState,
  WorkflowOpsFact,
  WorkflowRun,
  WorkflowTimelineEntry,
} from './types'

const QUEUED_CAPACITY_STUCK_MS = 2 * 60 * 60_000
const PAUSED_OPS_SLA_MS = 24 * 60 * 60_000
const CODE_SYSTEM_RUNNING_MS = 10 * 60_000
const WAIT_EVENT_GRACE_MS = 5 * 60_000
const TIMELINE_CAP = 40

export type StuckEvaluation = {
  stuck: boolean
  stuckReasonCode?: string
  stuckAt?: string
  nodeId?: string
  slaDueAt?: string
  suggestedAction?: string
  class?: 'engineering' | 'capacity' | 'human' | 'budget_ops' | 'approval_ops'
}

export type ThrashSignals = {
  retriesAtLeast3: string[]
  highSpendLowProgress: boolean
  oscillatingBlockRequeue: string[]
  signals: string[]
}

export type OpsListItem = {
  runId?: string
  orgId: string
  templateId: string
  projectId?: string
  status: WorkflowRun['status']
  bucket: 'stuck' | 'blocked' | 'paused_budget' | 'running' | 'terminal' | 'other'
  blockedReasonCode?: string
  stuckReasonCode?: string
  stuckAt?: string
  costTokensTotal: number
  budgetStatus: string
  updatedAt: string
  deepLink?: string
}

export type OpsInspectPayload = ReturnType<typeof inspectWorkflowRun> & {
  identity: {
    runId?: string
    templateId: string
    templateVersion: number
    orgId: string
    projectId?: string
    trigger: WorkflowRun['trigger']
    parentRunId?: string
    childRunIds?: string[]
    sourcePlaybookId?: string
  }
  state: {
    status: WorkflowRun['status']
    wavePointer: number
    startedAt?: string
    updatedAt: string
    completedAt?: string
    terminalReason?: string
    blockedReasonCode?: string
    stuckAt?: string
    stuckReasonCode?: string
  }
  blocker: null | {
    code: string
    sentence: string
    nodeId?: string
  }
  evidence: {
    lastEvidence?: WorkflowRun['lastEvidence']
    expectedVsPresent: Array<{
      nodeId: string
      expected: string[]
      present: string[]
      missing: string[]
    }>
    approvalTaskIds: string[]
  }
  thrash: ThrashSignals
  timeline: WorkflowTimelineEntry[]
  stuck: StuckEvaluation
  safeActions: Array<{ action: string; description: string; sideEffect: false }>
  costStrip: WorkflowRun['cost']
}

function msSince(iso: string, now: string): number {
  const a = Date.parse(iso)
  const b = Date.parse(now)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.max(0, b - a)
}

function sla(run: WorkflowRun) {
  return {
    agentRunningHeartbeatMs: run.sla.agentRunningHeartbeatMs ?? DEFAULT_SLA.agentRunningHeartbeatMs!,
    agentReadyUnclaimedMs: run.sla.agentReadyUnclaimedMs ?? DEFAULT_SLA.agentReadyUnclaimedMs!,
    humanGateWarnMs: run.sla.humanGateWarnMs ?? DEFAULT_SLA.humanGateWarnMs!,
    humanGateEscalateMs: run.sla.humanGateEscalateMs ?? DEFAULT_SLA.humanGateEscalateMs!,
    runNoTransitionMs: run.sla.runNoTransitionMs ?? DEFAULT_SLA.runNoTransitionMs!,
  }
}

// Prefer higher-severity / tighter diagnosis over earlier slaDueAt alone.
// capacity_starvation should not lose to run_no_transition; heartbeat beats ready.
const SEVERITY: Record<string, number> = {
  human_gate_escalate: 90,
  paused_budget_ops_sla: 85,
  paused_approval_ops_sla: 85,
  agent_heartbeat_stale: 80,
  system_or_check_stale: 75,
  human_gate_warn: 70,
  agent_ready_unclaimed: 60,
  wait_event_deadline: 55,
  capacity_starvation: 50,
  run_no_transition: 40,
}

function candidate(
  base: StuckEvaluation,
  next: StuckEvaluation,
): StuckEvaluation {
  if (!base.stuck) return next
  if (!next.stuck) return base
  const baseSev = SEVERITY[base.stuckReasonCode || ''] ?? 10
  const nextSev = SEVERITY[next.stuckReasonCode || ''] ?? 10
  if (nextSev !== baseSev) return nextSev > baseSev ? next : base
  if (next.slaDueAt && base.slaDueAt && Date.parse(next.slaDueAt) < Date.parse(base.slaDueAt)) return next
  return base
}

export function evaluateStuck(run: WorkflowRun, now: string): StuckEvaluation {
  if (TERMINAL_RUN_STATUSES.has(run.status as 'succeeded' | 'failed' | 'cancelled' | 'abandoned_candidate')) {
    return { stuck: false }
  }

  const s = sla(run)
  let best: StuckEvaluation = { stuck: false }

  // Paused budget / approval: ops SLA only (not eng stuck until overdue)
  if (run.status === 'paused_budget') {
    const age = msSince(run.updatedAt, now)
    if (age >= PAUSED_OPS_SLA_MS) {
      best = candidate(best, {
        stuck: true,
        stuckReasonCode: 'paused_budget_ops_sla',
        stuckAt: run.stuckAt || new Date(Date.parse(run.updatedAt) + PAUSED_OPS_SLA_MS).toISOString(),
        slaDueAt: new Date(Date.parse(run.updatedAt) + PAUSED_OPS_SLA_MS).toISOString(),
        suggestedAction: 'Resolve budget (lower caps / cancel / human override) — do not auto-raise.',
        class: 'budget_ops',
      })
    }
    return best
  }
  if (run.status === 'paused_approval') {
    const age = msSince(run.updatedAt, now)
    if (age >= PAUSED_OPS_SLA_MS) {
      best = candidate(best, {
        stuck: true,
        stuckReasonCode: 'paused_approval_ops_sla',
        stuckAt: run.stuckAt || new Date(Date.parse(run.updatedAt) + PAUSED_OPS_SLA_MS).toISOString(),
        slaDueAt: new Date(Date.parse(run.updatedAt) + PAUSED_OPS_SLA_MS).toISOString(),
        suggestedAction: 'Route human approval via Kanban/approval_card.',
        class: 'approval_ops',
      })
    }
    return best
  }

  for (const node of run.nodes) {
    const age = msSince(node.lastTransitionAt, now)
    if (node.kind === 'agent' && (node.status === 'running' || node.status === 'claimed' || node.status === 'waiting_watcher')) {
      if (age >= s.agentRunningHeartbeatMs) {
        best = candidate(best, {
          stuck: true,
          stuckReasonCode: 'agent_heartbeat_stale',
          stuckAt: run.stuckAt || new Date(Date.parse(node.lastTransitionAt) + s.agentRunningHeartbeatMs).toISOString(),
          nodeId: node.nodeId,
          slaDueAt: new Date(Date.parse(node.lastTransitionAt) + s.agentRunningHeartbeatMs).toISOString(),
          suggestedAction: 'Reclaim stale watcher claim / open Kanban task; if infra, Theo inspect hermesRunId.',
          class: 'engineering',
        })
      }
    }
    if (node.kind === 'agent' && node.status === 'ready' && !node.kanbanTaskId) {
      if (age >= s.agentReadyUnclaimedMs) {
        best = candidate(best, {
          stuck: true,
          stuckReasonCode: 'agent_ready_unclaimed',
          stuckAt: run.stuckAt || new Date(Date.parse(node.lastTransitionAt) + s.agentReadyUnclaimedMs).toISOString(),
          nodeId: node.nodeId,
          slaDueAt: new Date(Date.parse(node.lastTransitionAt) + s.agentReadyUnclaimedMs).toISOString(),
          suggestedAction: 'Tick engine to materialize or check watcher capacity for assignee.',
          class: 'engineering',
        })
      }
    }
    if (node.status === 'queued_capacity') {
      if (age >= QUEUED_CAPACITY_STUCK_MS) {
        best = candidate(best, {
          stuck: true,
          stuckReasonCode: 'capacity_starvation',
          stuckAt: run.stuckAt || new Date(Date.parse(node.lastTransitionAt) + QUEUED_CAPACITY_STUCK_MS).toISOString(),
          nodeId: node.nodeId,
          slaDueAt: new Date(Date.parse(node.lastTransitionAt) + QUEUED_CAPACITY_STUCK_MS).toISOString(),
          suggestedAction: 'Capacity alert: free agent slots or lower fan-out; not a node logic bug.',
          class: 'capacity',
        })
      }
    }
    if (node.kind === 'human_gate' || node.status === 'awaiting_gate') {
      if (age >= s.humanGateEscalateMs) {
        best = candidate(best, {
          stuck: true,
          stuckReasonCode: 'human_gate_escalate',
          stuckAt: run.stuckAt || new Date(Date.parse(node.lastTransitionAt) + s.humanGateEscalateMs).toISOString(),
          nodeId: node.nodeId,
          slaDueAt: new Date(Date.parse(node.lastTransitionAt) + s.humanGateEscalateMs).toISOString(),
          suggestedAction: 'Escalate open human gate to Peet/Pip via existing Kanban approval.',
          class: 'human',
        })
      } else if (age >= s.humanGateWarnMs) {
        best = candidate(best, {
          stuck: true,
          stuckReasonCode: 'human_gate_warn',
          stuckAt: run.stuckAt || new Date(Date.parse(node.lastTransitionAt) + s.humanGateWarnMs).toISOString(),
          nodeId: node.nodeId,
          slaDueAt: new Date(Date.parse(node.lastTransitionAt) + s.humanGateWarnMs).toISOString(),
          suggestedAction: 'Human gate open >24h — nudge approver on Kanban task.',
          class: 'human',
        })
      }
    }
    if ((node.kind === 'code_check' || node.kind === 'system') && node.status === 'running') {
      if (age >= CODE_SYSTEM_RUNNING_MS) {
        best = candidate(best, {
          stuck: true,
          stuckReasonCode: 'system_or_check_stale',
          stuckAt: run.stuckAt || new Date(Date.parse(node.lastTransitionAt) + CODE_SYSTEM_RUNNING_MS).toISOString(),
          nodeId: node.nodeId,
          slaDueAt: new Date(Date.parse(node.lastTransitionAt) + CODE_SYSTEM_RUNNING_MS).toISOString(),
          suggestedAction: 'Supply systemResults/artifactPresence on next tick or mark blocked.',
          class: 'engineering',
        })
      }
    }
    if (node.kind === 'wait_event' && (node.status === 'waiting_event' || node.status === 'running')) {
      // deadline not stored on node state in v0 — use runNoTransition as proxy + grace
      if (age >= s.runNoTransitionMs + WAIT_EVENT_GRACE_MS) {
        best = candidate(best, {
          stuck: true,
          stuckReasonCode: 'wait_event_deadline',
          stuckAt: run.stuckAt || now,
          nodeId: node.nodeId,
          suggestedAction: 'Domain event missed deadline — cancel wait or re-emit event.',
          class: 'engineering',
        })
      }
    }
  }

  // Run-level no transition — only if no more specific node stuck already found.
  // Capacity-queued runs are intentionally quiet until the 2h capacity SLA.
  const onlyCapacityWait =
    run.nodes.some((n) => n.status === 'queued_capacity')
    && !run.nodes.some((n) =>
      n.status === 'running'
      || n.status === 'claimed'
      || n.status === 'waiting_watcher'
      || n.status === 'ready'
      || n.status === 'awaiting_gate'
      || n.status === 'waiting_event'
      || n.status === 'retry_wait',
    )
  const runAge = msSince(run.updatedAt, now)
  if (runAge >= s.runNoTransitionMs && run.status === 'running' && !best.stuck && !onlyCapacityWait) {
    best = candidate(best, {
      stuck: true,
      stuckReasonCode: 'run_no_transition',
      stuckAt: run.stuckAt || new Date(Date.parse(run.updatedAt) + s.runNoTransitionMs).toISOString(),
      slaDueAt: new Date(Date.parse(run.updatedAt) + s.runNoTransitionMs).toISOString(),
      suggestedAction: 'Scheduler tick overdue — run cron/workflow-graph tick.',
      class: 'engineering',
    })
  }

  return best
}

export function applyStuckEvaluation(run: WorkflowRun, now: string): WorkflowRun {
  const stuck = evaluateStuck(run, now)
  if (!stuck.stuck) {
    if (run.stuckAt || run.stuckReasonCode) {
      return { ...run, stuckAt: undefined, stuckReasonCode: undefined, updatedAt: run.updatedAt }
    }
    return run
  }
  return {
    ...run,
    stuckAt: stuck.stuckAt || now,
    stuckReasonCode: stuck.stuckReasonCode,
  }
}

export function computeThrashSignals(run: WorkflowRun): ThrashSignals {
  const retriesAtLeast3: string[] = []
  const oscillatingBlockRequeue: string[] = []
  const signals: string[] = []

  for (const node of run.nodes) {
    const attempts = run.attempts[node.nodeId] ?? []
    if (node.currentAttempt >= 3 || attempts.length >= 3) {
      retriesAtLeast3.push(node.nodeId)
      signals.push(`retries>=3:${node.nodeId}`)
    }
    let sawBlock = false
    let sawRequeue = false
    for (const attempt of attempts) {
      if (attempt.status === 'blocked' || attempt.errorFamily) sawBlock = true
      if (attempt.reason === 'human_requeue' || attempt.status === 'retry_wait') sawRequeue = true
    }
    if (sawBlock && sawRequeue && attempts.length >= 2) {
      oscillatingBlockRequeue.push(node.nodeId)
      signals.push(`oscillating_block_requeue:${node.nodeId}`)
    }
  }

  const doneCount = run.nodes.filter((n) => n.status === 'done').length
  const progress = run.nodes.length ? doneCount / run.nodes.length : 0
  const spendRatio = run.cost.maxTokensPerRun > 0 ? run.cost.tokensTotal / run.cost.maxTokensPerRun : 0
  const highSpendLowProgress = spendRatio > 0.5 && progress < 0.3
  if (highSpendLowProgress) signals.push('high_spend_low_progress')

  return {
    retriesAtLeast3,
    highSpendLowProgress,
    oscillatingBlockRequeue,
    signals,
  }
}

function singleBlocker(run: WorkflowRun, stuck: StuckEvaluation): OpsInspectPayload['blocker'] {
  if (run.blockedReasonCode) {
    const node = run.nodes.find((n) => n.blockedReasonCode === run.blockedReasonCode)
      || run.nodes.find((n) => n.status === 'blocked' || n.status === 'awaiting_gate' || n.status === 'queued_capacity')
    return {
      code: run.blockedReasonCode,
      sentence: `Run blocked: ${run.blockedReasonCode}${node ? ` on node ${node.nodeId}` : ''}.`,
      nodeId: node?.nodeId,
    }
  }
  if (run.status === 'paused_budget') {
    return {
      code: 'budget_exceeded',
      sentence: 'Run paused on budget ceiling; new agent nodes will not claim until resolved.',
    }
  }
  if (stuck.stuck && stuck.stuckReasonCode) {
    return {
      code: stuck.stuckReasonCode,
      sentence: stuck.suggestedAction || `Run stuck: ${stuck.stuckReasonCode}`,
      nodeId: stuck.nodeId,
    }
  }
  const awaiting = run.nodes.find((n) => n.status === 'awaiting_gate')
  if (awaiting?.blockedReasonCode) {
    return {
      code: awaiting.blockedReasonCode,
      sentence: `Waiting on gate for node ${awaiting.nodeId}: ${awaiting.blockedReasonCode}.`,
      nodeId: awaiting.nodeId,
    }
  }
  const blocked = run.nodes.find((n) => n.status === 'blocked')
  if (blocked?.blockedReasonCode) {
    return {
      code: blocked.blockedReasonCode,
      sentence: `Node ${blocked.nodeId} blocked: ${blocked.blockedReasonCode}.`,
      nodeId: blocked.nodeId,
    }
  }
  return null
}

function evidenceTable(run: WorkflowRun) {
  return run.nodes
    .filter((n) => n.expectedArtifacts.length > 0 || n.evidence.length > 0)
    .map((node) => {
      const present = [...new Set(node.evidence.map((e) => e.type).filter(Boolean))]
      const missing = node.expectedArtifacts.filter((t) => !present.includes(t))
      return {
        nodeId: node.nodeId,
        expected: [...node.expectedArtifacts],
        present,
        missing,
      }
    })
}

export function buildOpsInspect(run: WorkflowRun, now?: string): OpsInspectPayload {
  const at = now || run.updatedAt || new Date().toISOString()
  const stuck = evaluateStuck(run, at)
  const base = inspectWorkflowRun(run)
  const thrash = computeThrashSignals(run)
  const blocker = singleBlocker(run, stuck)
  const timeline = (run.timeline ?? []).slice(-20)

  return {
    ...base,
    stuckReasonCode: run.stuckReasonCode || stuck.stuckReasonCode,
    blockedReasonCode: run.blockedReasonCode || blocker?.code,
    identity: {
      runId: run.id,
      templateId: run.templateId,
      templateVersion: run.templateVersion,
      orgId: run.orgId,
      projectId: run.projectId,
      trigger: run.trigger,
      parentRunId: run.parentRunId,
      childRunIds: run.childRunIds,
      sourcePlaybookId: run.sourcePlaybookId,
    },
    state: {
      status: run.status,
      wavePointer: run.wavePointer,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      completedAt: run.completedAt,
      terminalReason: run.terminalReason,
      blockedReasonCode: run.blockedReasonCode,
      stuckAt: run.stuckAt || (stuck.stuck ? stuck.stuckAt : undefined),
      stuckReasonCode: run.stuckReasonCode || stuck.stuckReasonCode,
    },
    blocker,
    evidence: {
      lastEvidence: run.lastEvidence,
      expectedVsPresent: evidenceTable(run),
      approvalTaskIds: run.nodes
        .filter((n) => n.kind === 'human_gate' && n.kanbanTaskId)
        .map((n) => n.kanbanTaskId!) ,
    },
    thrash,
    timeline,
    stuck,
    safeActions: [
      { action: 'copy_inspect', description: 'Copy run id / inspect payload for Nora handoff', sideEffect: false },
      { action: 'open_kanban', description: 'Open linked Kanban task if kanbanTaskId present', sideEffect: false },
      { action: 'flag_theo', description: 'Propose Theo eng task with runId + inspect (does not create)', sideEffect: false },
      { action: 'propose_cancel', description: 'Propose cancel/requeue — requires confirm; gated side effects need approval', sideEffect: false },
    ],
    costStrip: run.cost,
  }
}

export function nextBlockRevision(run: WorkflowRun): number {
  return (run.blockRevision ?? 0) + 1
}

/** Non-alert lifecycle statuses — never use these as reasonCode. */
const NON_ALERT_REASON_STATUSES = new Set([
  'running',
  'created',
  'succeeded',
  'cancelled',
  'abandoned_candidate',
  'paused_capacity',
  'paused_approval',
])

export type ResolvedAlert = {
  kind: WorkflowOpsFact['kind']
  reasonCode: string
  signature: string
  nodeId?: string
}

/**
 * Resolve a stable alert identity for quiet-success / alert-on-block.
 * Signature changes ⇒ new blockRevision; same signature ⇒ at most one fact (overwrite OK).
 * Never emits bare lifecycle status like reasonCode=running.
 */
export function resolveAlert(run: WorkflowRun): ResolvedAlert | null {
  if (run.status === 'paused_budget') {
    return {
      kind: 'budget_exceed',
      reasonCode: run.blockedReasonCode || 'budget_exceeded',
      signature: 'budget:exceeded',
    }
  }

  if (run.cost?.budgetStatus === 'unknown_usage') {
    return {
      kind: 'unknown_usage',
      reasonCode: 'unknown_usage',
      signature: 'budget:unknown_usage',
    }
  }

  const blockedNode =
    run.nodes.find((n) => n.status === 'blocked' && n.blockedReasonCode)
    || run.nodes.find((n) => n.status === 'blocked')
    || run.nodes.find((n) => Boolean(n.blockedReasonCode) && n.status !== 'done' && n.status !== 'cancelled')

  const blockCode =
    run.blockedReasonCode
    || blockedNode?.blockedReasonCode
    || (blockedNode ? `node_blocked:${blockedNode.nodeId}` : undefined)

  // Concrete block outranks stuck so stuck clear/set does not thrash revisions.
  if (blockCode) {
    return {
      kind: 'block',
      reasonCode: blockCode,
      signature: `block:${blockCode}`,
      nodeId: blockedNode?.nodeId,
    }
  }

  if (run.status === 'failed') {
    const code = run.terminalReason || 'failed'
    if (NON_ALERT_REASON_STATUSES.has(code)) return null
    return {
      kind: 'block',
      reasonCode: code,
      signature: `block:${code}`,
    }
  }

  if (run.stuckReasonCode) {
    const stuckCode = run.stuckReasonCode
    const kind: WorkflowOpsFact['kind'] =
      stuckCode.startsWith('human_gate') ? 'human_gate_sla' : 'stuck'
    return {
      kind,
      reasonCode: stuckCode,
      signature: `stuck:${stuckCode}`,
      nodeId: undefined,
    }
  }

  return null
}

export function isAlertWorthyStatus(run: WorkflowRun): boolean {
  return resolveAlert(run) !== null
}

export function shouldEmitBlockAlert(run: WorkflowRun): boolean {
  if (!run.notify.alertOnBlock) return false
  return resolveAlert(run) !== null
}

export function shouldEmitQuietSuccess(run: WorkflowRun): boolean {
  if (run.status !== 'succeeded') return false
  // Default quiet = no fact. Only ops_feed emits a durable quiet success fact.
  return run.notify.onSuccess === 'ops_feed'
}

export function buildBlockAlertFact(
  run: WorkflowRun,
  now: string,
  alert?: ResolvedAlert | null,
): WorkflowOpsFact {
  const resolved = alert === undefined ? resolveAlert(run) : alert
  const revision = run.blockRevision && run.blockRevision > 0 ? run.blockRevision : 1
  const code = resolved?.reasonCode
    || run.blockedReasonCode
    || run.stuckReasonCode
    || 'alert'
  // Never persist bare lifecycle statuses as the alert reason.
  const reasonCode = NON_ALERT_REASON_STATUSES.has(code) ? (resolved?.reasonCode || 'alert') : code
  const kind = resolved?.kind
    || (run.status === 'paused_budget'
      ? 'budget_exceed'
      : run.stuckReasonCode
        ? (run.stuckReasonCode.startsWith('human_gate') ? 'human_gate_sla' : 'stuck')
        : 'block')
  return {
    id: `${run.id}:block:${revision}`,
    orgId: run.orgId,
    kind,
    workflowRunId: run.id || 'unknown',
    templateId: run.templateId,
    projectId: run.projectId,
    dedupeKey: `${run.id}:block:${revision}`,
    blockRevision: revision,
    reasonCode,
    summary: `Workflow run ${run.id} ${run.status}: ${reasonCode}`,
    deepLink: run.id ? `/api/v1/workflow-runs/${run.id}` : undefined,
    nodeId: resolved?.nodeId
      || run.nodes.find((n) => n.status === 'blocked' || n.blockedReasonCode)?.nodeId,
    createdAt: now,
    ceoNotify: run.notify.onBlock === 'ops_inbox_and_ceo'
      || (run.notify.ceoNotifyOn || []).includes('block'),
  }
}

export function buildQuietSuccessFact(run: WorkflowRun, now: string): WorkflowOpsFact {
  return {
    id: `${run.id}:success`,
    orgId: run.orgId,
    kind: 'success_quiet',
    workflowRunId: run.id || 'unknown',
    templateId: run.templateId,
    projectId: run.projectId,
    dedupeKey: `${run.id}:success`,
    summary: `Workflow run ${run.id} succeeded (quiet)`,
    createdAt: now,
    ceoNotify: false,
  }
}

/** Derive ops list bucket for Nora daily pass. */
export function classifyOpsRunBucket(
  run: WorkflowRun,
  now: string,
): 'stuck' | 'blocked' | 'paused_budget' | 'running' | 'terminal' | 'other' {
  if (TERMINAL_RUN_STATUSES.has(run.status as 'succeeded' | 'failed' | 'cancelled' | 'abandoned_candidate')) {
    if (run.status === 'failed') return 'blocked'
    return 'terminal'
  }
  if (run.status === 'paused_budget') return 'paused_budget'
  if (run.nodes.some((n) => n.status === 'blocked') || run.blockedReasonCode) return 'blocked'
  const stuck = evaluateStuck(run, now)
  if (run.stuckReasonCode || stuck.stuck) return 'stuck'
  if (run.status === 'running' || run.status === 'created' || run.status === 'paused_capacity' || run.status === 'paused_approval') {
    return 'running'
  }
  return 'other'
}

export function matchDomainEventTemplates(
  templates: GraphTemplate[],
  eventType: string,
): GraphTemplate[] {
  const needle = eventType.trim()
  if (!needle) return []
  return templates.filter((template) => {
    if (template.status !== 'active' && template.status !== undefined) {
      // draft/archived skip — but allow missing status in tests
      if (template.status === 'draft' || template.status === 'archived') return false
    }
    return (template.triggers || []).some(
      (t) => t.type === 'domain_event' && (t.eventType || '') === needle,
    )
  })
}

export function matchCronTemplates(templates: GraphTemplate[]): GraphTemplate[] {
  return templates.filter((template) => {
    if (template.status === 'draft' || template.status === 'archived') return false
    return (template.triggers || []).some((t) => t.type === 'cron' && Boolean(t.cron))
  })
}

export function domainEventIdempotencyKey(input: {
  orgId: string
  templateId: string
  eventType: string
  eventId: string
}): string {
  return `domain:${input.orgId}:${input.templateId}:${input.eventType}:${input.eventId}`
}

export function cronTriggerIdempotencyKey(input: {
  orgId: string
  templateId: string
  windowBucket: string
}): string {
  return `cron:${input.orgId}:${input.templateId}:${input.windowBucket}`
}

/** UTC hour bucket for cron dedupe (Hermes/cron hourly ticks). */
export function cronWindowBucket(now: Date = new Date()): string {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const h = String(now.getUTCHours()).padStart(2, '0')
  return `${y}${m}${d}T${h}`
}

function appendTimeline(
  timeline: WorkflowTimelineEntry[] | undefined,
  entry: WorkflowTimelineEntry,
  cap = TIMELINE_CAP,
): WorkflowTimelineEntry[] {
  return appendTimelineShared(timeline, entry, cap)
}

/**
 * Bump blockRevision only when the stable alert signature changes.
 * Status thrash (running→failed) and stuck clear/set with the same block code
 * must not mint new revisions (ADR §19 once-only alert-on-block).
 */
export function bumpBlockRevisionOnAlertTransition(
  previous: WorkflowRun,
  next: WorkflowRun,
): WorkflowRun {
  const nextAlert = resolveAlert(next)
  if (!nextAlert) {
    return next
  }

  // Already stamped this exact signature — keep revision (cron re-entry / merge residue).
  if (next.lastAlertSignature === nextAlert.signature && (next.blockRevision ?? 0) > 0) {
    return next
  }

  const prevAlert = resolveAlert(previous)
  const prevSignature = previous.lastAlertSignature || prevAlert?.signature || null

  if (prevSignature === nextAlert.signature) {
    // Same condition as previous snapshot: adopt existing revision or start at 1.
    const revision = (previous.blockRevision && previous.blockRevision > 0)
      ? previous.blockRevision
      : (next.blockRevision && next.blockRevision > 0 ? next.blockRevision : 1)
    return {
      ...next,
      blockRevision: revision,
      lastAlertSignature: nextAlert.signature,
    }
  }

  // New alert condition (or first alert after clear).
  return {
    ...next,
    blockRevision: nextBlockRevision(previous),
    lastAlertSignature: nextAlert.signature,
  }
}

export function nodeAgeMs(node: WorkflowNodeState, now: string): number {
  return msSince(node.lastTransitionAt, now)
}
