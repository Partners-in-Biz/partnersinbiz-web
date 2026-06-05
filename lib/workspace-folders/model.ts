import type { ApiUser } from '@/lib/api/types'
import { normalizeSafeMetadata } from '@/lib/workspace-os/common'

export const WORKSPACE_FOLDER_COLLECTION = 'workspace_folders'

export const WORKSPACE_FOLDER_VISIBILITIES = [
  'admin_only',
  'admin_agents',
  'admin_agents_clients',
] as const
export type WorkspaceFolderVisibility = (typeof WORKSPACE_FOLDER_VISIBILITIES)[number]

export const WORKSPACE_FOLDER_SOURCE_OF_TRUTH = [
  'google_drive',
  'vps',
  'local',
  'mixed',
] as const
export type WorkspaceFolderSourceOfTruth = (typeof WORKSPACE_FOLDER_SOURCE_OF_TRUTH)[number]

export const WORKSPACE_FOLDER_SYNC_MODES = ['full', 'metadata_only', 'manual'] as const
export type WorkspaceFolderSyncMode = (typeof WORKSPACE_FOLDER_SYNC_MODES)[number]

export const WORKSPACE_FOLDER_SYNC_TARGETS = ['vps', 'local'] as const
export type WorkspaceFolderSyncTarget = (typeof WORKSPACE_FOLDER_SYNC_TARGETS)[number]

export const WORKSPACE_FOLDER_SYNC_STATUSES = [
  'not_configured',
  'pending',
  'syncing',
  'synced',
  'conflict',
  'error',
  'paused',
] as const
export type WorkspaceFolderSyncStatus = (typeof WORKSPACE_FOLDER_SYNC_STATUSES)[number]

export const WORKSPACE_FOLDER_CONFLICT_STATUSES = ['none', 'open', 'resolved', 'ignored'] as const
export type WorkspaceFolderConflictStatus = (typeof WORKSPACE_FOLDER_CONFLICT_STATUSES)[number]

export interface WorkspaceFolder {
  id?: string
  orgId: string
  name: string
  description: string
  resourceType: string | null
  resourceId: string | null
  projectId: string | null
  taskId: string | null
  clientDocumentId: string | null
  connectionId: string | null
  provider: string
  owner: { type: string | null; id: string | null }
  capabilityScopes: string[]
  safeMetadata: Record<string, unknown>
  parentId: string | null
  visibility: WorkspaceFolderVisibility
  tags: string[]
  sortOrder: number
  drive: {
    folderId: string | null
    folderUrl: string | null
  }
  paths: {
    vpsPath: string | null
    localPathHint: string | null
  }
  sourceOfTruth: WorkspaceFolderSourceOfTruth
  syncMode: WorkspaceFolderSyncMode
  syncTargets: WorkspaceFolderSyncTarget[]
  permissions: {
    inheritParent: boolean
    allowedAgentIds: string[]
    allowedRoleIds: string[]
    allowedUserIds: string[]
  }
  syncState: {
    status: WorkspaceFolderSyncStatus
    lastSyncedAt: string | null
    lastAttemptAt: string | null
    error: string | null
    conflictCount: number
  }
  audit: {
    approvalStatus: string | null
    auditStatus: string | null
    riskLevel: string | null
    approvalGateTaskId: string | null
    lastReviewedAt: string | null
    lastReviewedBy: string | null
    conflictStatus: WorkspaceFolderConflictStatus
    lastConflictAt: string | null
    notes: string | null
  }
  deleted: boolean
}

export interface WorkspaceFolderLookupFilters {
  resourceType?: string | null
  resourceId?: string | null
  parentId?: string | null
  tag?: string | null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function cleanRequiredString(value: unknown, field: string): string {
  const trimmed = cleanString(value)
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number], field: string): T[number] {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T[number]
  throw new Error(`Invalid ${field}; expected one of ${allowed.join(' | ')}`)
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    const trimmed = cleanString(item)
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      result.push(trimmed)
    }
  }
  return result
}

function cleanSyncTargets(value: unknown): WorkspaceFolderSyncTarget[] {
  const input = Array.isArray(value) ? value : []
  const result: WorkspaceFolderSyncTarget[] = []
  for (const item of input) {
    if ((WORKSPACE_FOLDER_SYNC_TARGETS as readonly string[]).includes(String(item)) && !result.includes(item as WorkspaceFolderSyncTarget)) {
      result.push(item as WorkspaceFolderSyncTarget)
    }
  }
  return result
}

function cleanSortOrder(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numberValue)) throw new Error('sortOrder must be a finite number')
  return numberValue
}

function cleanNonNegativeInteger(value: unknown, field: string): number {
  if (value === undefined || value === null || value === '') return 0
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(numberValue) || numberValue < 0) throw new Error(`${field} must be a non-negative integer`)
  return numberValue
}

function cleanHttpUrl(value: unknown, field: string): string | null {
  const trimmed = cleanString(value)
  if (!trimmed) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`${field} must be an http(s) URL`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error(`${field} must be an http(s) URL`)
  return trimmed
}

function cleanAbsolutePath(value: unknown, field: string): string | null {
  const trimmed = cleanString(value)
  if (!trimmed) return null
  if (!trimmed.startsWith('/')) throw new Error(`${field} must be an absolute path`)
  if (trimmed.includes('..')) throw new Error(`${field} must not contain .. segments`)
  return trimmed
}

function cleanLocalPathHint(value: unknown): string | null {
  const trimmed = cleanString(value)
  if (!trimmed) return null
  if (trimmed.includes('\0')) throw new Error('localPathHint must not contain null bytes')
  return trimmed
}

function assertNoRawSecrets(input: unknown): void {
  const forbidden = new Set(['clientSecret', 'client_secret', 'refreshToken', 'refresh_token', 'accessToken', 'access_token', 'privateKey', 'private_key', 'serviceAccountJson', 'keyJson', 'password', 'secret'])
  const visit = (value: unknown, path: string[] = []) => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (forbidden.has(key)) throw new Error(`raw secrets are not allowed in workspace folder registry (${[...path, key].join('.')})`)
      visit(child, [...path, key])
    }
  }
  visit(input)
}

function cleanIsoString(value: unknown, field: string): string | null {
  const trimmed = cleanString(value)
  if (!trimmed) return null
  const parsed = Date.parse(trimmed)
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be an ISO date string`)
  return trimmed
}

export function normalizeWorkspaceFolderInput(input: unknown, orgId: string): WorkspaceFolder {
  assertNoRawSecrets(input)
  const body = asRecord(input)
  const permissions = asRecord(body.permissions)
  const syncState = asRecord(body.syncState)
  const audit = asRecord(body.audit)

  return {
    orgId: cleanRequiredString(orgId, 'orgId'),
    name: cleanRequiredString(body.name, 'name'),
    description: cleanString(body.description) ?? '',
    resourceType: cleanString(body.resourceType),
    resourceId: cleanString(body.resourceId),
    projectId: cleanString(body.projectId),
    taskId: cleanString(body.taskId),
    clientDocumentId: cleanString(body.clientDocumentId),
    connectionId: cleanString(body.connectionId),
    provider: cleanString(body.provider) ?? 'google_workspace',
    owner: {
      type: cleanString(asRecord(body.owner).type) ?? (cleanString(body.ownerAgentId) ? 'agent' : cleanString(body.ownerUserId) ? 'user' : null),
      id: cleanString(asRecord(body.owner).id) ?? cleanString(body.ownerAgentId) ?? cleanString(body.ownerUserId),
    },
    capabilityScopes: cleanStringArray(body.capabilityScopes),
    safeMetadata: normalizeSafeMetadata(body.safeMetadata),
    parentId: cleanString(body.parentId),
    visibility: enumValue(body.visibility, WORKSPACE_FOLDER_VISIBILITIES, 'admin_agents', 'visibility'),
    tags: cleanStringArray(body.tags),
    sortOrder: cleanSortOrder(body.sortOrder),
    drive: {
      folderId: cleanString(body.driveFolderId ?? asRecord(body.drive).folderId),
      folderUrl: cleanHttpUrl(body.driveFolderUrl ?? asRecord(body.drive).folderUrl, 'driveFolderUrl'),
    },
    paths: {
      vpsPath: cleanAbsolutePath(body.vpsPath ?? asRecord(body.paths).vpsPath, 'vpsPath'),
      localPathHint: cleanLocalPathHint(body.localPathHint ?? asRecord(body.paths).localPathHint),
    },
    sourceOfTruth: enumValue(body.sourceOfTruth, WORKSPACE_FOLDER_SOURCE_OF_TRUTH, 'google_drive', 'sourceOfTruth'),
    syncMode: enumValue(body.syncMode, WORKSPACE_FOLDER_SYNC_MODES, 'full', 'syncMode'),
    syncTargets: cleanSyncTargets(body.syncTargets),
    permissions: {
      inheritParent: permissions.inheritParent !== false,
      allowedAgentIds: cleanStringArray(permissions.allowedAgentIds),
      allowedRoleIds: cleanStringArray(permissions.allowedRoleIds),
      allowedUserIds: cleanStringArray(permissions.allowedUserIds),
    },
    syncState: {
      status: enumValue(syncState.status, WORKSPACE_FOLDER_SYNC_STATUSES, 'not_configured', 'syncState.status'),
      lastSyncedAt: cleanIsoString(syncState.lastSyncedAt, 'syncState.lastSyncedAt'),
      lastAttemptAt: cleanIsoString(syncState.lastAttemptAt, 'syncState.lastAttemptAt'),
      error: cleanString(syncState.error),
      conflictCount: cleanNonNegativeInteger(syncState.conflictCount, 'syncState.conflictCount'),
    },
    audit: {
      approvalStatus: cleanString(audit.approvalStatus) ?? cleanString(body.approvalStatus),
      auditStatus: cleanString(audit.auditStatus) ?? cleanString(body.auditStatus) ?? 'unknown',
      riskLevel: cleanString(audit.riskLevel) ?? cleanString(body.riskLevel),
      approvalGateTaskId: cleanString(audit.approvalGateTaskId) ?? cleanString(body.approvalGateTaskId),
      lastReviewedAt: cleanIsoString(audit.lastReviewedAt ?? body.lastReviewedAt, 'audit.lastReviewedAt'),
      lastReviewedBy: cleanString(audit.lastReviewedBy) ?? cleanString(body.lastReviewedBy),
      conflictStatus: enumValue(audit.conflictStatus, WORKSPACE_FOLDER_CONFLICT_STATUSES, 'none', 'audit.conflictStatus'),
      lastConflictAt: cleanIsoString(audit.lastConflictAt, 'audit.lastConflictAt'),
      notes: cleanString(audit.notes),
    },
    deleted: false,
  }
}

export function buildWorkspaceFolderUpdate(input: unknown): Partial<WorkspaceFolder> {
  const body = asRecord(input)
  const normalized = normalizeWorkspaceFolderInput({ name: 'placeholder', ...body }, 'placeholder-org')
  const updates: Partial<WorkspaceFolder> = {}
  const updatableKeys: Array<keyof WorkspaceFolder> = [
    'description',
    'resourceType',
    'resourceId',
    'projectId',
    'taskId',
    'clientDocumentId',
    'connectionId',
    'provider',
    'owner',
    'capabilityScopes',
    'safeMetadata',
    'parentId',
    'visibility',
    'tags',
    'sortOrder',
    'drive',
    'paths',
    'sourceOfTruth',
    'syncMode',
    'syncTargets',
    'permissions',
    'syncState',
    'audit',
  ]
  if (body.name !== undefined) updates.name = normalized.name
  for (const key of updatableKeys) {
    if (body[key] !== undefined || key === 'drive' && (body.driveFolderId !== undefined || body.driveFolderUrl !== undefined) || key === 'paths' && (body.vpsPath !== undefined || body.localPathHint !== undefined)) {
      updates[key] = normalized[key] as never
    }
  }
  return updates
}

export function canReadWorkspaceFolder(folder: Pick<WorkspaceFolder, 'orgId' | 'visibility' | 'permissions'>, user: ApiUser): boolean {
  if (user.role === 'client') {
    const clientOrgIds = user.orgIds?.length ? user.orgIds : (user.orgId ? [user.orgId] : [])
    return clientOrgIds.includes(folder.orgId) && folder.visibility === 'admin_agents_clients'
  }
  if (user.role === 'admin') return true
  if (user.role === 'ai') {
    if (folder.visibility === 'admin_only') return false
    const allowedAgents = folder.permissions?.allowedAgentIds ?? []
    const agentId = user.agentId ?? user.uid.replace(/^agent:/, '')
    return allowedAgents.length === 0 || allowedAgents.includes(agentId)
  }
  return false
}

export function workspaceFolderMatchesLookup(folder: WorkspaceFolder, filters: WorkspaceFolderLookupFilters): boolean {
  if (filters.resourceType && folder.resourceType !== filters.resourceType) return false
  if (filters.resourceId && folder.resourceId !== filters.resourceId) return false
  if (filters.parentId !== undefined && filters.parentId !== null && folder.parentId !== filters.parentId) return false
  if (filters.tag && !folder.tags.includes(filters.tag)) return false
  return true
}

export function serializeWorkspaceFolder(id: string, data: Record<string, unknown>): WorkspaceFolder & { id: string } {
  return { id, ...(data as unknown as WorkspaceFolder) }
}
