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
  now?: string | null
  input?: Record<string, unknown>
}

export interface WorkspaceBrokerRequester {
  id: string | null
  type: string
  role: string
  agentId: string | null
}

export interface WorkspaceBrokerApprovalEvidence {
  gateTaskId: string | null
  status: string | null
}

export interface WorkspaceBrokerTargetResource {
  orgId?: string
  connectionId?: string
  artifactId?: string
  folderId?: string
  projectId?: string
  taskId?: string
  templateId?: string
  title?: string
  url?: string
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
  requestedCapability: AgentCapability
  riskLevel: WorkspaceBrokerRiskLevel
  approvalRequired: boolean
  approvalSatisfied: boolean
  approvalEvidence: WorkspaceBrokerApprovalEvidence
  requester: WorkspaceBrokerRequester
  targetResource: WorkspaceBrokerTargetResource
  input: Record<string, unknown>
  output: { googleMutationPerformed: false; artifactId?: string | null; fileId?: string | null; url?: string | null; artifactIds: string[]; artifactUrls: string[]; resultArtifactIds: string[]; resultArtifactUrls: string[] }
  resultArtifactIds: string[]
  resultArtifactUrls: string[]
  error: string | null
  errors: string[]
  attempts: number
  nextRunAt: string | null
  idempotencyKey: string | null
  requestedAt: string
  updatedAt: string
  completedAt: string | null
}

function cleanOptionalStringField(payload: Record<string, unknown>, key: string): string | undefined {
  return cleanString(payload[key]) ?? undefined
}

function buildWorkspaceBrokerRequester(input: WorkspaceBrokerJobInput): WorkspaceBrokerRequester {
  const createdByType = cleanString(input.createdByType) ?? 'agent'
  return {
    id: cleanString(input.requestedBy),
    type: createdByType,
    role: createdByType,
    agentId: cleanString(input.agentId),
  }
}

function buildWorkspaceBrokerTargetResource(orgId: string, connectionId: string | null, payload: Record<string, unknown>): WorkspaceBrokerTargetResource {
  const target: WorkspaceBrokerTargetResource = { orgId }
  if (connectionId) target.connectionId = connectionId
  for (const key of ['artifactId', 'folderId', 'projectId', 'taskId', 'templateId', 'title', 'url'] as const) {
    const value = cleanOptionalStringField(payload, key)
    if (value) target[key] = value
  }
  return target
}

export function buildWorkspaceBrokerJobInput(input: WorkspaceBrokerJobInput): WorkspaceBrokerJob {
  const operation = enumValue(input.operation, WORKSPACE_BROKER_OPERATIONS, 'link_existing', 'operation')
  const payload = asRecord(input.input)
  const orgId = cleanRequiredString(input.orgId, 'orgId')
  const connectionId = cleanString(input.connectionId)
  const now = cleanString(input.now) ?? new Date().toISOString()
  const approvalGateTaskId = cleanString(input.approvalGateTaskId)
  const approvalStatus = cleanString(input.approvalStatus)
  const decision = evaluateWorkspaceBrokerApproval({
    operation,
    visibility: cleanString(payload.visibility),
    approvalStatus,
    approvalGateTaskId,
  })
  return {
    orgId,
    operation,
    status: decision.status,
    connectionId,
    requestedBy: cleanString(input.requestedBy),
    createdByType: cleanString(input.createdByType) ?? 'agent',
    agentId: cleanString(input.agentId),
    requester: buildWorkspaceBrokerRequester(input),
    approvalGateTaskId,
    approvalStatus,
    requiredCapability: decision.requiredCapability,
    requestedCapability: decision.requiredCapability,
    riskLevel: decision.riskLevel,
    approvalRequired: decision.approvalRequired,
    approvalSatisfied: decision.approvalSatisfied,
    approvalEvidence: { gateTaskId: approvalGateTaskId, status: approvalStatus },
    targetResource: buildWorkspaceBrokerTargetResource(orgId, connectionId, payload),
    input: payload,
    output: { googleMutationPerformed: false, artifactIds: [], artifactUrls: [], resultArtifactIds: [], resultArtifactUrls: [] },
    resultArtifactIds: [],
    resultArtifactUrls: [],
    error: null,
    errors: [],
    attempts: 0,
    nextRunAt: null,
    idempotencyKey: cleanString(input.idempotencyKey),
    requestedAt: now,
    updatedAt: now,
    completedAt: null,
  }
}

export function canExecuteWorkspaceBrokerJob(job: Partial<WorkspaceBrokerJob>): { ok: true } | { ok: false; reason: 'approval_required' | 'not_ready' } {
  if (job.approvalRequired && !job.approvalSatisfied) return { ok: false, reason: 'approval_required' }
  const status = cleanString(job.status)
  if (status !== 'queued' && status !== 'running') return { ok: false, reason: 'not_ready' }
  return { ok: true }
}

export function detectWorkspaceAclAlignment(input: { visibility: WorkspaceFolderVisibility; anyoneWithLink?: boolean; externalShared?: boolean; domainShared?: boolean }): WorkspaceAclAlignmentStatus {
  if (input.visibility !== 'admin_agents_clients' && (input.anyoneWithLink || input.externalShared || input.domainShared)) return 'broader_than_pib'
  return 'aligned'
}
