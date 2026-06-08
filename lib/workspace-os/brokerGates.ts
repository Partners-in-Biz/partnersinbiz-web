import type { ApiUser } from '@/lib/api/types'
import { AgentCapabilityError, assertAgentCapability, type AgentCapability } from '@/lib/agents/capabilities'
import { getAgentSkillPolicy } from '@/lib/agents/skill-policy'
import { adminDb } from '@/lib/firebase/admin'
import { WORKSPACE_CONNECTION_COLLECTION } from '@/lib/workspace-os/connections'
import { cleanString } from '@/lib/workspace-os/common'
import { type WorkspaceBrokerJob, type WorkspaceBrokerOperation } from '@/lib/workspace-os/broker'

const GOOGLE_MUTATION_OPERATIONS = new Set<WorkspaceBrokerOperation>([
  'create_folder',
  'create_doc',
  'create_sheet',
  'copy_template_doc',
  'copy_template_sheet',
  'export_pdf',
  'request_share',
  'request_delete',
])

const APPROVED = new Set(['approved', 'accepted', 'resolved'])
const READY_CONNECTION_STATUSES = new Set(['active', 'approved'])
const READY_TOKEN_STATUSES = new Set(['valid', 'healthy'])

const OPERATION_CAPABILITIES: Record<WorkspaceBrokerOperation, string[]> = {
  link_existing: ['read'],
  inventory_refresh: ['driveRead'],
  permission_audit: ['driveRead'],
  create_folder: ['driveWrite'],
  create_doc: ['driveWrite', 'docsWrite'],
  create_sheet: ['driveWrite', 'sheetsWrite'],
  copy_template_doc: ['driveRead', 'driveWrite', 'docsWrite'],
  copy_template_sheet: ['driveRead', 'driveWrite', 'sheetsWrite'],
  export_pdf: ['driveRead', 'driveWrite'],
  request_share: ['driveShare', 'externalShare'],
  request_delete: ['driveDelete'],
}

export class WorkspaceBrokerGateError extends Error {
  status = 403

  constructor(message: string, status = 403) {
    super(message)
    this.name = 'WorkspaceBrokerGateError'
    this.status = status
  }
}

export function isGoogleMutationOperation(operation: WorkspaceBrokerOperation): boolean {
  return GOOGLE_MUTATION_OPERATIONS.has(operation)
}

function dataOf(snapshot: { data?: () => unknown } | null | undefined): Record<string, unknown> {
  const data = snapshot?.data?.()
  return data && typeof data === 'object' ? data as Record<string, unknown> : {}
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => cleanString(item)).filter((item): item is string => !!item)
}

function connectionAllowsCapability(connection: Record<string, unknown>, operation: WorkspaceBrokerOperation, requiredCapability: AgentCapability): boolean {
  const capabilityScopes = cleanList(connection.capabilityScopes).map((item) => item.toLowerCase())
  const loweredRequired = requiredCapability.toLowerCase()
  if (capabilityScopes.includes('*') || capabilityScopes.includes(loweredRequired) || capabilityScopes.includes(operation.toLowerCase())) return true

  const capabilities = connection.capabilities && typeof connection.capabilities === 'object'
    ? connection.capabilities as Record<string, unknown>
    : {}
  return (OPERATION_CAPABILITIES[operation] ?? []).some((capability) => capabilities[capability] === true)
}

function agentCanUseWorkspaceBroker(agentId: string | null | undefined): boolean {
  if (!agentId) return false
  const policy = getAgentSkillPolicy(agentId as never)
  if (!policy) return false
  const skills = [...policy.pibSkills, ...policy.runtimeSkills, ...policy.globalSkills]
  return skills.some((skill) => skill === 'google-workspace' || skill === 'partnersinbiz/google-workspace')
}

function assertAgentRequestCanQueue(user: ApiUser, requiredCapability: AgentCapability) {
  if (user.role !== 'ai' && user.authKind !== 'agent_api_key' && user.authKind !== 'legacy_ai_key') return
  assertAgentCapability(user, requiredCapability, {})
  if (!agentCanUseWorkspaceBroker(user.agentId)) {
    throw new AgentCapabilityError(`Agent '${user.agentId ?? user.uid}' is not allowed to perform '${requiredCapability}'.`)
  }
}

export async function assertWorkspaceBrokerCreationGate(input: {
  user: ApiUser
  orgId: string
  operation: WorkspaceBrokerOperation
  connectionId: string | null
  requiredCapability: AgentCapability
}): Promise<void> {
  if (!GOOGLE_MUTATION_OPERATIONS.has(input.operation)) return
  assertAgentRequestCanQueue(input.user, input.requiredCapability)
  await assertWorkspaceBrokerConnectionGate({
    orgId: input.orgId,
    operation: input.operation,
    connectionId: input.connectionId,
    requiredCapability: input.requiredCapability,
  })
}

export async function assertWorkspaceBrokerConnectionGate(input: {
  orgId: string
  operation: WorkspaceBrokerOperation
  connectionId: string | null
  requiredCapability: AgentCapability
}): Promise<void> {
  if (!GOOGLE_MUTATION_OPERATIONS.has(input.operation)) return
  if (!input.connectionId) throw new WorkspaceBrokerGateError('Workspace broker connectionId is required for Google mutation jobs')

  const snapshot = await adminDb.collection(WORKSPACE_CONNECTION_COLLECTION).doc(input.connectionId).get()
  if (!snapshot.exists) throw new WorkspaceBrokerGateError('Workspace connection not found for broker mutation job', 404)
  const connection = dataOf(snapshot)
  if (cleanString(connection.orgId) !== input.orgId) throw new WorkspaceBrokerGateError('Workspace connection orgId does not match broker job orgId')
  if (connection.deleted === true) throw new WorkspaceBrokerGateError('Workspace connection not found for broker mutation job', 404)
  if (cleanString(connection.provider) !== 'google_workspace') throw new WorkspaceBrokerGateError('Workspace connection provider must be google_workspace for broker mutation jobs')

  const status = cleanString(connection.status)?.toLowerCase()
  if (!status || !READY_CONNECTION_STATUSES.has(status)) throw new WorkspaceBrokerGateError('Workspace connection must be active or approved before broker mutation jobs can be queued')

  const approvalStatus = cleanString(connection.approvalStatus)?.toLowerCase()
  if (!approvalStatus || !APPROVED.has(approvalStatus)) throw new WorkspaceBrokerGateError('Workspace connection approvalStatus must be approved before broker mutation jobs can be queued')

  const tokenStatus = cleanString(connection.tokenStatus)?.toLowerCase()
  if (!tokenStatus || !READY_TOKEN_STATUSES.has(tokenStatus)) throw new WorkspaceBrokerGateError('Workspace connection tokenStatus must be valid or healthy before broker mutation jobs can be queued')

  if (!connectionAllowsCapability(connection, input.operation, input.requiredCapability)) throw new WorkspaceBrokerGateError('Workspace connection does not grant the required broker capability')
}

export async function assertWorkspaceBrokerExecutionGate(job: WorkspaceBrokerJob & { id?: string }): Promise<void> {
  await assertWorkspaceBrokerConnectionGate({
    orgId: job.orgId,
    operation: job.operation,
    connectionId: cleanString(job.connectionId),
    requiredCapability: job.requiredCapability,
  })
}

export function brokerGateStatus(error: unknown): number {
  const status = error && typeof error === 'object' && typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status
    : null
  if (status && status >= 400 && status < 600) return status
  const name = error && typeof error === 'object' ? (error as { name?: unknown }).name : null
  if (name === 'WorkspaceBrokerGateError' || name === 'AgentCapabilityError') return 403
  return 500
}
