import type { AgentCapability } from '@/lib/agents/capabilities'
import type { WorkspaceFolderVisibility } from '@/lib/workspace-folders/model'
import type { WorkspaceAclAlignmentStatus } from './artifacts'
import { asRecord, cleanRequiredString, cleanString, enumValue } from './common'

export const WORKSPACE_BROKER_JOB_COLLECTION = 'workspace_broker_jobs'
export const WORKSPACE_ARTIFACT_EVENT_COLLECTION = 'workspace_artifact_events'
export const WORKSPACE_BROKER_OPERATIONS = [
  'link_existing',
  'create_folder',
  'copy_template_doc',
  'copy_template_sheet',
  'create_doc',
  'create_sheet',
  'export_pdf',
  'inventory_refresh',
  'permission_audit',
  'request_share',
  'request_delete',
] as const
export type WorkspaceBrokerOperation = (typeof WORKSPACE_BROKER_OPERATIONS)[number]
export type WorkspaceBrokerJobStatus = 'requested' | 'awaiting_approval' | 'queued' | 'running' | 'done' | 'failed' | 'blocked' | 'cancelled'
export type WorkspaceBrokerRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface WorkspaceBrokerApprovalInput {
  operation: WorkspaceBrokerOperation
  visibility?: WorkspaceFolderVisibility | string | null
  approvalStatus?: string | null
  approvalGateTaskId?: string | null
}

export interface WorkspaceBrokerApprovalDecision {
  requiredCapability: AgentCapability
  riskLevel: WorkspaceBrokerRiskLevel
  approvalRequired: boolean
  approvalSatisfied: boolean
  status: WorkspaceBrokerJobStatus
}

const APPROVED = new Set(['approved', 'accepted', 'resolved'])

export function evaluateWorkspaceBrokerApproval(input: WorkspaceBrokerApprovalInput): WorkspaceBrokerApprovalDecision {
  const operation = input.operation
  let requiredCapability: AgentCapability = 'draft'
  let riskLevel: WorkspaceBrokerRiskLevel = 'low'
  let approvalRequired = false

  if (operation === 'request_share') {
    requiredCapability = 'publish'
    riskLevel = 'high'
    approvalRequired = true
  } else if (operation === 'request_delete') {
    requiredCapability = 'delete'
    riskLevel = 'high'
    approvalRequired = true
  } else if (['create_folder', 'create_doc', 'create_sheet', 'copy_template_doc', 'copy_template_sheet', 'export_pdf'].includes(operation)) {
    requiredCapability = 'write'
    riskLevel = input.visibility === 'admin_agents_clients' ? 'medium' : 'low'
    approvalRequired = input.visibility === 'admin_agents_clients'
  } else if (operation === 'permission_audit' || operation === 'inventory_refresh') {
    requiredCapability = 'read'
  }

  const status = cleanString(input.approvalStatus)?.toLowerCase()
  const approvalSatisfied = !!status && APPROVED.has(status) && !!cleanString(input.approvalGateTaskId)
  return {
    requiredCapability,
    riskLevel,
    approvalRequired,
    approvalSatisfied,
    status: approvalRequired && !approvalSatisfied ? 'awaiting_approval' : 'queued',
  }
}

export interface WorkspaceBrokerJobInput {
  orgId: string
  operation: WorkspaceBrokerOperation
  connectionId?: string | null
  agentId?: string | null
  requestedBy?: string | null
  createdByType?: string | null
  approvalGateTaskId?: string | null
  approvalStatus?: string | null
  idempotencyKey?: string | null
  input?: Record<string, unknown>
}

export interface WorkspaceBrokerJob {
  orgId: string
  operation: WorkspaceBrokerOperation
  status: WorkspaceBrokerJobStatus
  connectionId: string | null
  requestedBy: string | null
  createdByType: string
  agentId: string | null
  approvalGateTaskId: string | null
  approvalStatus: string | null
  requiredCapability: AgentCapability
  riskLevel: WorkspaceBrokerRiskLevel
  input: Record<string, unknown>
  output: { googleMutationPerformed: false; artifactId?: string | null; fileId?: string | null; url?: string | null }
  error: string | null
  attempts: number
  nextRunAt: string | null
  idempotencyKey: string | null
}

export function buildWorkspaceBrokerJobInput(input: WorkspaceBrokerJobInput): WorkspaceBrokerJob {
  const operation = enumValue(input.operation, WORKSPACE_BROKER_OPERATIONS, 'link_existing', 'operation')
  const payload = asRecord(input.input)
  const decision = evaluateWorkspaceBrokerApproval({
    operation,
    visibility: cleanString(payload.visibility),
    approvalStatus: input.approvalStatus,
    approvalGateTaskId: input.approvalGateTaskId,
  })
  return {
    orgId: cleanRequiredString(input.orgId, 'orgId'),
    operation,
    status: decision.status,
    connectionId: cleanString(input.connectionId),
    requestedBy: cleanString(input.requestedBy),
    createdByType: cleanString(input.createdByType) ?? 'agent',
    agentId: cleanString(input.agentId),
    approvalGateTaskId: cleanString(input.approvalGateTaskId),
    approvalStatus: cleanString(input.approvalStatus),
    requiredCapability: decision.requiredCapability,
    riskLevel: decision.riskLevel,
    input: payload,
    output: { googleMutationPerformed: false },
    error: null,
    attempts: 0,
    nextRunAt: null,
    idempotencyKey: cleanString(input.idempotencyKey),
  }
}

export function detectWorkspaceAclAlignment(input: { visibility: WorkspaceFolderVisibility; anyoneWithLink?: boolean; externalShared?: boolean; domainShared?: boolean }): WorkspaceAclAlignmentStatus {
  if (input.visibility !== 'admin_agents_clients' && (input.anyoneWithLink || input.externalShared || input.domainShared)) return 'broader_than_pib'
  return 'aligned'
}
