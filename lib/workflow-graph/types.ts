export type WorkflowNodeKind =
  | 'agent'
  | 'human_gate'
  | 'code_check'
  | 'system'
  | 'wait_event'
  | 'delay'

export type GraphTemplateStatus = 'draft' | 'active' | 'archived'

export type WorkflowRunStatus =
  | 'created'
  | 'running'
  | 'paused_budget'
  | 'paused_approval'
  | 'paused_capacity'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'abandoned_candidate'

export type WorkflowNodeStatus =
  | 'pending'
  | 'ready'
  | 'queued_capacity'
  | 'claimed'
  | 'running'
  | 'waiting_watcher'
  | 'awaiting_gate'
  | 'waiting_event'
  | 'retry_wait'
  | 'done'
  | 'blocked'
  | 'cancelled'

export type BudgetStatus = 'within_budget' | 'warn' | 'exceeded' | 'unknown_usage'
export type UsageCompleteness = 'exact' | 'partial' | 'unavailable'
export type BudgetOnExceed = 'pause_run' | 'block_new_agent_nodes' | 'fail_run'
export type RiskLevel = 'low' | 'medium' | 'high'

export type ErrorFamily =
  | 'transient_infra'
  | 'verifier_fail'
  | 'agent_incomplete'
  | 'policy'
  | 'approval_denied'
  | 'budget'
  | 'capability'
  | 'invalid_spec'
  | 'unknown'

export type GatedCapability =
  | 'publish'
  | 'spend'
  | 'deploy'
  | 'finance'
  | 'client_message'
  | 'secrets'

export type RetryPolicy = {
  maxAttempts: number
  backoffMs: number[] | 'watcher_transient_default'
  retryOn: Array<'transient_infra' | 'verifier_fail' | 'agent_incomplete'>
  doNotRetryOn: Array<'policy' | 'approval_denied' | 'budget' | 'capability' | 'invalid_spec'>
}

export type GraphNodeTemplate = {
  nodeId: string
  kind: WorkflowNodeKind
  name: string
  dependsOnNodeIds: string[]
  assigneeAgentId?: string
  agentInput?: {
    spec: string
    context?: Record<string, unknown>
    constraints?: string[]
  }
  expectedArtifacts?: string[]
  verifierChecklist?: string[]
  reviewerAgentId?: string
  requiredCapability?: string
  riskLevel?: RiskLevel
  systemAction?: string
  checkType?: string
  checkConfig?: Record<string, unknown>
  waitEventType?: string
  delayMs?: number
  deadlineMs?: number
  limits?: { maxConcurrent?: number }
  retryPolicy?: Partial<RetryPolicy>
  budgets?: { maxTokens?: number; maxCost?: number }
}

export type GraphTemplateTrigger = {
  type: 'manual' | 'cron' | 'domain_event'
  cron?: string
  eventType?: string
  filter?: Record<string, unknown>
}

export type GraphTemplateLimits = {
  maxConcurrentAgentNodes: number
  maxConcurrentAgentNodesOrgDefault?: number
}

export type GraphTemplateBudgets = {
  currency: 'USD' | 'ZAR'
  maxTokensPerRun?: number
  maxCostPerRun?: number
  maxTokensPerNode?: number
  maxCostPerNode?: number
  maxAgentNodeAttemptsPerRun?: number
  warnAtRatio?: number
  onExceed: BudgetOnExceed
  estimatedCostModel?: 'tokens_only' | 'tokens_plus_fixed'
}

export type GraphTemplateNotify = {
  quietSuccess: boolean
  alertOnBlock: boolean
  /** Default quiet — no durable fact. ops_feed writes a quiet success fact for gatherers. */
  onSuccess?: 'quiet' | 'ops_feed'
  onBlock?: 'ops_inbox' | 'ops_inbox_and_ceo'
  onBudgetWarn?: 'ops_feed'
  onBudgetExceed?: 'ops_inbox'
  debounceSeconds?: number
  ceoNotifyOn?: Array<'block' | 'budget' | 'human_gate_sla'>
}

export type WorkflowTimelineEntry = {
  at: string
  kind: 'node' | 'run' | 'cost' | 'alert' | 'trigger'
  nodeId?: string
  from?: string
  to?: string
  reason?: string
  summary?: string
}

export type WorkflowOpsFactKind =
  | 'block'
  | 'budget_exceed'
  | 'budget_warn'
  | 'stuck'
  | 'success_quiet'
  | 'human_gate_sla'
  | 'unknown_usage'

export type WorkflowOpsFact = {
  id: string
  orgId: string
  kind: WorkflowOpsFactKind
  workflowRunId: string
  templateId: string
  projectId?: string
  dedupeKey: string
  blockRevision?: number
  reasonCode?: string
  summary: string
  deepLink?: string
  nodeId?: string
  createdAt: string
  ceoNotify?: boolean
}

export type GraphTemplateSla = {
  agentRunningHeartbeatMs?: number
  agentReadyUnclaimedMs?: number
  humanGateWarnMs?: number
  humanGateEscalateMs?: number
  runNoTransitionMs?: number
}

export type GraphTemplate = {
  id?: string
  orgId: string
  name: string
  version: number
  versionHash: string
  status: GraphTemplateStatus
  nodes: GraphNodeTemplate[]
  edges?: Array<{ from: string; to: string }>
  triggers: GraphTemplateTrigger[]
  limits: GraphTemplateLimits
  budgets: GraphTemplateBudgets
  retryPolicy: RetryPolicy
  notify: GraphTemplateNotify
  sla: GraphTemplateSla
  gatedCapabilities: GatedCapability[]
  pilot?: boolean
  projectId?: string
  sourcePlaybookId?: string
  executionBackend?: 'workflow_graph'
  createdAt?: string
  updatedAt?: string
  createdBy?: string
}

export type WorkflowRunCost = {
  maxTokensPerRun: number
  maxCostPerRun?: number
  warnAtRatio: number
  onExceed: BudgetOnExceed
  tokensIn: number
  tokensOut: number
  tokensReasoning?: number
  tokensTotal: number
  estimatedCost: number
  currency: string
  attemptCountAgent: number
  attemptCountTotal: number
  budgetStatus: BudgetStatus
  lastBudgetEventAt?: string
  usageCompleteness: UsageCompleteness
  consecutiveUnknownUsageAttempts?: number
}

export type WorkflowApprovalRef = {
  capability: string
  resourceIds: string[]
  approvedBy: string
  at: string
  ref: string
}

export type WorkflowEvidence = {
  type: string
  ref: string
  label?: string
  at: string
}

export type WorkflowNodeState = {
  nodeId: string
  kind: WorkflowNodeKind
  name: string
  status: WorkflowNodeStatus
  currentAttempt: number
  dependsOnNodeIds: string[]
  kanbanTaskId?: string
  /** Prior Kanban bind retained across retry_wait so store can requeue the same task. */
  lastKanbanTaskId?: string
  /** Earliest ISO time the node may leave retry_wait for another attempt. */
  retryAt?: string
  blockedReasonCode?: string
  lastTransitionAt: string
  evidence: WorkflowEvidence[]
  expectedArtifacts: string[]
  verifierChecklist: string[]
  approvalRef?: string
  assigneeAgentId?: string
  requiredCapability?: string
  riskLevel?: RiskLevel
  systemAction?: string
  checkType?: string
  checkConfig?: Record<string, unknown>
  reviewerAgentId?: string
  agentInput?: GraphNodeTemplate['agentInput']
  materializesToKanban: boolean
}

export type WorkflowAttempt = {
  attemptNumber: number
  idempotencyKey: string
  status: WorkflowNodeStatus
  hermesRunId?: string
  kanbanTaskId?: string
  errorFamily?: ErrorFamily
  retryable?: boolean
  retryAt?: string
  tokensIn?: number
  tokensOut?: number
  tokensTotal?: number
  estimatedCost?: number
  model?: string
  provider?: string
  durationMs?: number
  startedAt?: string
  completedAt?: string
  summary?: string
  reason?: string
}

export type WorkflowRun = {
  id?: string
  orgId: string
  templateId: string
  templateVersion: number
  templateVersionHash: string
  projectId?: string
  parentRunId?: string
  childRunIds?: string[]
  status: WorkflowRunStatus
  trigger: { type: string; ref?: string; at: string }
  wavePointer: number
  limits: GraphTemplateLimits
  budgets: GraphTemplateBudgets
  cost: WorkflowRunCost
  blockedReasonCode?: string
  stuckAt?: string
  stuckReasonCode?: string
  approvalRefs: WorkflowApprovalRef[]
  notify: GraphTemplateNotify
  sla: GraphTemplateSla
  gatedCapabilities: GatedCapability[]
  nodes: WorkflowNodeState[]
  attempts: Record<string, WorkflowAttempt[]>
  terminalReason?: string
  sourcePlaybookId?: string
  sourcePlaybookRunId?: string
  startedAt?: string
  updatedAt: string
  completedAt?: string
  createdBy?: string
  lastEvidence?: WorkflowEvidence
  /** Client/create idempotency key for run start dedupe */
  createIdempotencyKey?: string
  /** Compact state transition log (capped); Phase 2 inspector timeline. */
  timeline?: WorkflowTimelineEntry[]
  /** Incremented on each new alert-worthy transition for ops alert dedupe. */
  blockRevision?: number
  /** Last ops fact dedupe key written for this run (block path). */
  lastAlertDedupeKey?: string
}

export type MaterializeIntent = {
  nodeId: string
  kind: 'agent' | 'human_gate'
  title: string
  assigneeAgentId?: string
  agentStatus: 'pending' | 'awaiting-input'
  columnId: 'todo' | 'blocked'
  dependsOnKanbanTaskIds: string[]
  expectedArtifacts: string[]
  verifierChecklist: string[]
  reviewerAgentId?: string
  requiredCapability?: string
  riskLevel?: RiskLevel
  approvalGate?: string
  labels: string[]
  agentInput?: {
    spec: string
    context?: Record<string, unknown>
    constraints?: string[]
  }
  idempotencyKey: string
  /** When true, materializer must requeue an existing workflow node task instead of no-op reuse. */
  requeueExisting?: boolean
  previousKanbanTaskId?: string
}

export type EngineAction =
  | { type: 'materialize'; intent: MaterializeIntent }
  | { type: 'mark_node'; nodeId: string; status: WorkflowNodeStatus; blockedReasonCode?: string; evidence?: WorkflowEvidence[] }
  | { type: 'start_attempt'; nodeId: string; attempt: WorkflowAttempt }
  | { type: 'complete_attempt'; nodeId: string; attemptNumber: number; patch: Partial<WorkflowAttempt> }
  | { type: 'set_run_status'; status: WorkflowRunStatus; blockedReasonCode?: string; terminalReason?: string }
  | { type: 'set_wave'; wavePointer: number }
  | { type: 'append_evidence'; evidence: WorkflowEvidence }
  | { type: 'update_cost'; cost: WorkflowRunCost }

export type AdvanceEvent =
  | {
      type: 'tick'
      now: string
      orgInFlightAgentClaims?: number
      agentInFlightByAssignee?: Record<string, number>
      artifactPresence?: Record<string, boolean>
      systemResults?: Record<string, { ok: boolean; evidence?: WorkflowEvidence[]; errorFamily?: ErrorFamily }>
    }
  | {
      type: 'kanban_terminal'
      now: string
      nodeId: string
      kanbanTaskId: string
      outcome: 'done' | 'blocked' | 'awaiting_input' | 'rejected'
      evidence?: WorkflowEvidence[]
      summary?: string
      tokensIn?: number
      tokensOut?: number
      tokensTotal?: number
      estimatedCost?: number
      model?: string
      provider?: string
      hermesRunId?: string
      errorFamily?: ErrorFamily
    }
  | {
      type: 'approval_granted'
      now: string
      approval: WorkflowApprovalRef
    }
  | {
      type: 'cancel'
      now: string
      reason: string
    }

export type AdvanceResult = {
  run: WorkflowRun
  actions: EngineAction[]
  materialize: MaterializeIntent[]
}
