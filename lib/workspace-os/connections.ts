import { asRecord, assertNoRawSecrets, cleanIsoString, cleanRequiredString, cleanString, cleanStringArray, enumValue, normalizeRegistryAudit, normalizeRegistryOwner, normalizeSafeMetadata, slugify, type SafeMetadata, type WorkspaceRegistryAudit, type WorkspaceRegistryOwner } from './common'

export const WORKSPACE_CONNECTION_COLLECTION = 'workspace_connections'
export const WORKSPACE_CONNECTION_PROVIDERS = ['google_workspace'] as const
export const WORKSPACE_CONNECTION_TYPES = ['user_oauth', 'service_account', 'domain_delegation', 'manual_link'] as const
export const WORKSPACE_CONNECTION_STATUSES = ['proposed', 'approved', 'active', 'paused', 'revoked', 'retired'] as const
export const WORKSPACE_SCOPE_CLASSIFICATIONS = ['non_sensitive', 'sensitive', 'restricted'] as const
export const WORKSPACE_AUTOMATION_IDENTITIES = ['peet', 'ops_mailbox', 'no_reply', 'service_account', 'tbd'] as const
export const WORKSPACE_CONNECTION_RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const

export type WorkspaceConnectionStatus = (typeof WORKSPACE_CONNECTION_STATUSES)[number]

export interface WorkspaceConnection {
  id?: string
  orgId: string
  connectionKey: string | null
  displayName: string
  provider: 'google_workspace'
  connectionType: (typeof WORKSPACE_CONNECTION_TYPES)[number]
  status: WorkspaceConnectionStatus
  ownerAgentId: string | null
  ownerUserId: string | null
  owner: WorkspaceRegistryOwner
  visibility: string | null
  resourceType: string | null
  resourceId: string | null
  projectId: string | null
  taskId: string | null
  clientDocumentId: string | null
  sourceDocumentId: string | null
  sourceResearchItemId: string | null
  capabilityScopes: string[]
  audit: WorkspaceRegistryAudit
  safeMetadata: SafeMetadata
  googleCloudProjectId: string | null
  oauthClientId: string | null
  serviceAccountEmail: string | null
  automationIdentity: (typeof WORKSPACE_AUTOMATION_IDENTITIES)[number]
  scopes: Array<{ scope: string; classification: (typeof WORKSPACE_SCOPE_CLASSIFICATIONS)[number]; approved: boolean; approvedBy: string | null; approvedAt: string | null; approvalGateTaskId: string | null }>
  capabilities: Record<'driveRead' | 'driveWrite' | 'driveShare' | 'driveDelete' | 'docsRead' | 'docsWrite' | 'sheetsRead' | 'sheetsWrite' | 'externalShare', boolean>
  credentialRef: { secretName: string | null; envVarName: string | null; tokenStorePath: string | null; keyPrefix: string | null }
  redirectUri: string | null
  tokenStatus: string
  reconnectInstructions: string | null
  allowedOrgIds: string[]
  restrictedResourceIds: string[]
  dataTouched: string[]
  approvalStatus: string | null
  approvalGateTaskId: string | null
  riskLevel: (typeof WORKSPACE_CONNECTION_RISK_LEVELS)[number]
  retentionRule: string | null
  rollbackPath: string | null
  lastReviewedAt: string | null
  lastReviewedBy: string | null
  deleted: boolean
}

function normalizeScopes(value: unknown): WorkspaceConnection['scopes'] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const row = asRecord(item)
    return {
      scope: cleanRequiredString(row.scope, 'scopes.scope'),
      classification: enumValue(row.classification, WORKSPACE_SCOPE_CLASSIFICATIONS, 'sensitive', 'scopes.classification'),
      approved: row.approved === true,
      approvedBy: cleanString(row.approvedBy),
      approvedAt: cleanIsoString(row.approvedAt, 'scopes.approvedAt'),
      approvalGateTaskId: cleanString(row.approvalGateTaskId),
    }
  })
}

function normalizeCapabilities(value: unknown): WorkspaceConnection['capabilities'] {
  const body = asRecord(value)
  return {
    driveRead: body.driveRead === true,
    driveWrite: body.driveWrite === true,
    driveShare: body.driveShare === true,
    driveDelete: body.driveDelete === true,
    docsRead: body.docsRead === true,
    docsWrite: body.docsWrite === true,
    sheetsRead: body.sheetsRead === true,
    sheetsWrite: body.sheetsWrite === true,
    externalShare: body.externalShare === true,
  }
}

export function normalizeWorkspaceConnectionInput(input: unknown, orgId: string): WorkspaceConnection {
  assertNoRawSecrets(input)
  const body = asRecord(input)
  const credentialRef = asRecord(body.credentialRef)
  const displayName = cleanRequiredString(body.displayName ?? body.name, 'displayName')
  const rawKey = cleanString(body.connectionKey)
  return {
    orgId: cleanRequiredString(orgId, 'orgId'),
    connectionKey: rawKey ? slugify(rawKey) : null,
    displayName,
    provider: enumValue(body.provider, WORKSPACE_CONNECTION_PROVIDERS, 'google_workspace', 'provider'),
    connectionType: enumValue(body.connectionType, WORKSPACE_CONNECTION_TYPES, 'manual_link', 'connectionType'),
    status: enumValue(body.status, WORKSPACE_CONNECTION_STATUSES, 'proposed', 'status'),
    ownerAgentId: cleanString(body.ownerAgentId),
    ownerUserId: cleanString(body.ownerUserId),
    owner: normalizeRegistryOwner(body.owner, body.ownerAgentId, body.ownerUserId),
    visibility: cleanString(body.visibility),
    resourceType: cleanString(body.resourceType),
    resourceId: cleanString(body.resourceId),
    projectId: cleanString(body.projectId),
    taskId: cleanString(body.taskId),
    clientDocumentId: cleanString(body.clientDocumentId),
    sourceDocumentId: cleanString(body.sourceDocumentId),
    sourceResearchItemId: cleanString(body.sourceResearchItemId),
    capabilityScopes: cleanStringArray(body.capabilityScopes),
    audit: normalizeRegistryAudit(body.audit, {
      approvalStatus: cleanString(body.approvalStatus),
      approvalGateTaskId: cleanString(body.approvalGateTaskId),
      riskLevel: cleanString(body.riskLevel),
      lastReviewedAt: cleanIsoString(body.lastReviewedAt, 'lastReviewedAt'),
      lastReviewedBy: cleanString(body.lastReviewedBy),
    }),
    safeMetadata: normalizeSafeMetadata(body.safeMetadata),
    googleCloudProjectId: cleanString(body.googleCloudProjectId),
    oauthClientId: cleanString(body.oauthClientId),
    serviceAccountEmail: cleanString(body.serviceAccountEmail),
    automationIdentity: enumValue(body.automationIdentity, WORKSPACE_AUTOMATION_IDENTITIES, 'tbd', 'automationIdentity'),
    scopes: normalizeScopes(body.scopes),
    capabilities: normalizeCapabilities(body.capabilities),
    credentialRef: {
      secretName: cleanString(credentialRef.secretName),
      envVarName: cleanString(credentialRef.envVarName),
      tokenStorePath: cleanString(credentialRef.tokenStorePath),
      keyPrefix: cleanString(credentialRef.keyPrefix),
    },
    redirectUri: cleanString(body.redirectUri),
    tokenStatus: cleanString(body.tokenStatus) ?? 'unknown',
    reconnectInstructions: cleanString(body.reconnectInstructions),
    allowedOrgIds: cleanStringArray(body.allowedOrgIds),
    restrictedResourceIds: cleanStringArray(body.restrictedResourceIds),
    dataTouched: cleanStringArray(body.dataTouched),
    approvalStatus: cleanString(body.approvalStatus),
    approvalGateTaskId: cleanString(body.approvalGateTaskId),
    riskLevel: enumValue(body.riskLevel, WORKSPACE_CONNECTION_RISK_LEVELS, 'low', 'riskLevel'),
    retentionRule: cleanString(body.retentionRule),
    rollbackPath: cleanString(body.rollbackPath),
    lastReviewedAt: cleanIsoString(body.lastReviewedAt, 'lastReviewedAt'),
    lastReviewedBy: cleanString(body.lastReviewedBy),
    deleted: false,
  }
}

export function buildWorkspaceConnectionUpdate(input: unknown): Partial<WorkspaceConnection> {
  const body = asRecord(input)
  if (body.orgId !== undefined) throw new Error('orgId cannot be changed')
  const normalized = normalizeWorkspaceConnectionInput({ displayName: 'placeholder', ...body }, 'placeholder-org')
  const updates: Partial<WorkspaceConnection> = {}
  for (const key of Object.keys(normalized) as Array<keyof WorkspaceConnection>) {
    if (key === 'orgId' || key === 'deleted') continue
    if (body[key] !== undefined || (key === 'displayName' && body.name !== undefined)) updates[key] = normalized[key] as never
  }
  return updates
}

export function serializeWorkspaceConnection(id: string, data: Record<string, unknown>): WorkspaceConnection & { id: string } {
  return { id, ...(data as unknown as WorkspaceConnection) }
}
