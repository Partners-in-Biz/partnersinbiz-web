import type {
  GatedCapability,
  GraphTemplate,
  GraphTemplateBudgets,
  GraphTemplateLimits,
  GraphTemplateNotify,
  GraphTemplateSla,
  RetryPolicy,
} from './types'

export const DEFAULT_GATED_CAPABILITIES: GatedCapability[] = [
  'publish',
  'spend',
  'deploy',
  'finance',
  'client_message',
  'secrets',
]

export const WATCHER_TRANSIENT_BACKOFF_MS = [60_000, 300_000, 900_000] as const

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoffMs: 'watcher_transient_default',
  retryOn: ['transient_infra', 'verifier_fail', 'agent_incomplete'],
  doNotRetryOn: ['policy', 'approval_denied', 'budget', 'capability', 'invalid_spec'],
}

export const DEFAULT_LIMITS: GraphTemplateLimits = {
  maxConcurrentAgentNodes: 3,
  maxConcurrentAgentNodesOrgDefault: 8,
}

export const DEFAULT_BUDGETS: GraphTemplateBudgets = {
  currency: 'USD',
  maxTokensPerRun: 2_000_000,
  maxAgentNodeAttemptsPerRun: 40,
  warnAtRatio: 0.8,
  onExceed: 'pause_run',
  estimatedCostModel: 'tokens_only',
}

export const DEFAULT_NOTIFY: GraphTemplateNotify = {
  quietSuccess: true,
  alertOnBlock: true,
}

export const DEFAULT_SLA: GraphTemplateSla = {
  agentRunningHeartbeatMs: 20 * 60_000,
  agentReadyUnclaimedMs: 15 * 60_000,
  humanGateWarnMs: 24 * 60 * 60_000,
  humanGateEscalateMs: 72 * 60 * 60_000,
  runNoTransitionMs: 30 * 60_000,
}

export const GLOBAL_AGENT_CONCURRENCY = 5
export const DEFAULT_ORG_GRAPH_AGENT_CAP = 8
export const NON_AGENT_ORG_CONCURRENCY = 20

export const KANBAN_MATERIALIZING_KINDS = new Set(['agent', 'human_gate'] as const)

export const TERMINAL_RUN_STATUSES = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'abandoned_candidate',
] as const)

export const TERMINAL_NODE_STATUSES = new Set(['done', 'blocked', 'cancelled'] as const)

export const IN_FLIGHT_AGENT_STATUSES = new Set([
  'claimed',
  'running',
  'waiting_watcher',
] as const)

export function isGatedCapability(value: string | undefined | null): value is GatedCapability {
  if (!value) return false
  return (DEFAULT_GATED_CAPABILITIES as string[]).includes(value)
}

export function applyTemplateDefaults(partial: Partial<GraphTemplate> & Pick<GraphTemplate, 'orgId' | 'name' | 'nodes'>): Omit<GraphTemplate, 'versionHash'> & { versionHash?: string } {
  return {
    orgId: partial.orgId,
    name: partial.name,
    version: partial.version ?? 1,
    versionHash: partial.versionHash,
    status: partial.status ?? 'draft',
    nodes: partial.nodes,
    edges: partial.edges,
    triggers: partial.triggers ?? [{ type: 'manual' }],
    limits: {
      ...DEFAULT_LIMITS,
      ...(partial.limits ?? {}),
    },
    budgets: {
      ...DEFAULT_BUDGETS,
      ...(partial.budgets ?? {}),
    },
    retryPolicy: {
      ...DEFAULT_RETRY_POLICY,
      ...(partial.retryPolicy ?? {}),
    },
    notify: {
      ...DEFAULT_NOTIFY,
      ...(partial.notify ?? {}),
    },
    sla: {
      ...DEFAULT_SLA,
      ...(partial.sla ?? {}),
    },
    gatedCapabilities: partial.gatedCapabilities ?? [...DEFAULT_GATED_CAPABILITIES],
    pilot: partial.pilot,
    projectId: partial.projectId,
    sourcePlaybookId: partial.sourcePlaybookId,
    executionBackend: 'workflow_graph',
    createdAt: partial.createdAt,
    updatedAt: partial.updatedAt,
    createdBy: partial.createdBy,
    id: partial.id,
  }
}
