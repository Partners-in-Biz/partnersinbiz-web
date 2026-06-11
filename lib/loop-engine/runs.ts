import type { LoopRegistryEntry, LoopRiskLevel, LoopTriggerKind } from './registry'
import type { LoopActionProposal } from './actions'
import type { LoopReadinessResult } from './readiness'

export type LoopRunStatus =
  | 'evaluated'
  | 'blocked'
  | 'proposed'
  | 'awaiting_approval'
  | 'executed'
  | 'failed'
  | 'cancelled'

export type LoopRunEvidence = {
  type: 'source' | 'readiness' | 'approval' | 'artifact' | 'verification' | 'blocker'
  label: string
  ref?: string | null
  summary: string
}

export type LoopRunCandidate = {
  id: string
  type: 'task' | 'lead' | 'seo-signal' | 'review-item' | 'manual'
  title: string
  orgId?: string | null
  projectId?: string | null
  taskId?: string | null
  riskLevel?: LoopRiskLevel | string | null
  requiredCapability?: string | null
  approvalGateTaskId?: string | null
  approvalGateStatus?: string | null
  task?: Record<string, unknown> | null
  context?: Record<string, unknown>
}

export type LoopRunTrigger = {
  kind: LoopTriggerKind | 'manual'
  ref?: string | null
  source?: string | null
}

export type LoopRunObservability = {
  lastMeaningfulAction: string
  noOpStreak: number
  verificationFailures: string[]
  budgetStatus: 'within-budget' | 'near-limit' | 'exceeded'
  needsHumanJudgment: boolean
  progressSignal: 'advanced' | 'no-op' | 'blocked' | 'awaiting-approval'
}

export type LoopRunRecord = {
  id: string
  loopId: string
  loopName: string
  orgId: string
  status: LoopRunStatus
  dryRun: boolean
  riskLevel: LoopRiskLevel
  ownerAgentId: string
  reviewerAgentId: string
  trigger: LoopRunTrigger
  candidateSummary: string
  candidates: LoopRunCandidate[]
  readinessResults: Array<LoopReadinessResult & { candidateId: string }>
  proposedActions: LoopActionProposal[]
  executedActions: LoopActionProposal[]
  approvalGates: string[]
  evidence: LoopRunEvidence[]
  observability: LoopRunObservability
  decision: string
  createdByType: 'system' | 'agent' | 'user'
  createdBy: string
  createdAt: string
  updatedAt: string
  idempotencyKey: string
  error?: string | null
}

export function deriveLoopRunStatus(input: {
  dryRun: boolean
  proposedActions: LoopActionProposal[]
  executedActions: LoopActionProposal[]
  blocked: boolean
}): LoopRunStatus {
  if (input.blocked) return 'blocked'
  if (input.proposedActions.some((action) => action.mode === 'approval-required' || action.approvalGates.length > 0)) return 'awaiting_approval'
  if (input.dryRun) return 'proposed'
  if (input.executedActions.length > 0) return 'executed'
  return 'evaluated'
}

export function buildLoopRunId(loop: LoopRegistryEntry, idempotencyKey: string): string {
  return `${loop.id}:${idempotencyKey}`
}
