import type { LoopActionKind, LoopApprovalGate, LoopRiskLevel } from './registry'

export type LoopActionExecutionMode = 'safe-auto' | 'approval-required' | 'draft-only'

export type LoopActionProposal = {
  id: string
  kind: LoopActionKind
  label: string
  summary: string
  targetType: 'task' | 'project' | 'comment' | 'briefing' | 'crm' | 'message' | 'report' | 'loop-run'
  targetId?: string | null
  mode: LoopActionExecutionMode
  approvalGates: LoopApprovalGate[]
  evidenceRequired: string[]
  payload?: Record<string, unknown>
}

const SIDE_EFFECT_GATES_BY_ACTION: Partial<Record<LoopActionKind, LoopApprovalGate[]>> = {
  'message-draft': ['client-visible'],
}

const APPROVAL_SENSITIVE_CAPABILITIES: Partial<Record<string, LoopApprovalGate>> = {
  message_client: 'client-visible',
  publish: 'public-publishing',
  deploy: 'production-deploy',
  spend: 'paid-spend',
  finance: 'finance',
  access_secret: 'secret-config',
  delete: 'destructive-data',
  approve: 'human-review',
}

export function approvalGatesForCapability(capability: string | null | undefined): LoopApprovalGate[] {
  if (!capability) return []
  const gate = APPROVAL_SENSITIVE_CAPABILITIES[capability]
  return gate ? [gate] : []
}

export function approvalGatesForAction(kind: LoopActionKind): LoopApprovalGate[] {
  return SIDE_EFFECT_GATES_BY_ACTION[kind] ?? []
}

export function modeForAction(kind: LoopActionKind, riskLevel: LoopRiskLevel, gates: LoopApprovalGate[]): LoopActionExecutionMode {
  if (kind === 'message-draft' || kind === 'draft') return 'draft-only'
  if (gates.length > 0 || riskLevel === 'critical') return 'approval-required'
  return 'safe-auto'
}

export function isActionExecutableWithoutApproval(action: LoopActionProposal): boolean {
  return action.mode === 'safe-auto' && action.approvalGates.length === 0
}
