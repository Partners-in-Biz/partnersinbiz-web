export type FolderVisibility = 'admin_only' | 'admin_agents' | 'admin_agents_clients'
export type FolderSourceOfTruth = 'google_drive' | 'vps' | 'local_cowork' | 'mixed'
export type FolderSyncMode = 'full' | 'metadata_only' | 'manual'
export type FolderSyncTarget = 'vps' | 'local_cowork'
export type FolderSyncStatus = 'not_configured' | 'idle' | 'syncing' | 'synced' | 'conflict' | 'failed'
export type FolderAuditStatus = 'unknown' | 'ok' | 'needs_review' | 'permission_risk' | 'conflict'

export interface WorkspaceFolderMapping {
  id: string
  name: string
  parentId: string | null
  resourceType: string
  resourceId: string
  folderType: string
  tags: string[]
  sortOrder: number
  driveFolderId: string
  driveFolderUrl: string
  pathHints: {
    vps: string
    local: string
    notes: string
  }
  visibility: FolderVisibility
  exposeInClientPortal: boolean
  sourceOfTruth: FolderSourceOfTruth
  syncMode: FolderSyncMode
  syncTargets: FolderSyncTarget[]
  syncStatus: FolderSyncStatus
  auditStatus: FolderAuditStatus
  permissionNotes: string
  lastSyncedAt: string | null
  lastAuditAt: string | null
  lastConflictAt: string | null
  updatedAt: string | null
}

const VISIBILITIES = new Set<FolderVisibility>(['admin_only', 'admin_agents', 'admin_agents_clients'])
const SOURCES = new Set<FolderSourceOfTruth>(['google_drive', 'vps', 'local_cowork', 'mixed'])
const SYNC_MODES = new Set<FolderSyncMode>(['full', 'metadata_only', 'manual'])
const SYNC_TARGETS = new Set<FolderSyncTarget>(['vps', 'local_cowork'])
const SYNC_STATUSES = new Set<FolderSyncStatus>(['not_configured', 'idle', 'syncing', 'synced', 'conflict', 'failed'])
const AUDIT_STATUSES = new Set<FolderAuditStatus>(['unknown', 'ok', 'needs_review', 'permission_risk', 'conflict'])

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanNullableString(value: unknown): string | null {
  const cleaned = cleanString(value)
  return cleaned || null
}

function cleanNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function cleanTags(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return Array.from(
    new Set(
      raw
        .map(tag => cleanString(tag).toLowerCase())
        .filter(Boolean),
    ),
  )
}

function cleanEnum<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  return allowed.has(value as T) ? (value as T) : fallback
}

function cleanSyncTargets(value: unknown): FolderSyncTarget[] {
  const raw = Array.isArray(value) ? value : []
  return Array.from(new Set(raw.filter(target => SYNC_TARGETS.has(target as FolderSyncTarget)))) as FolderSyncTarget[]
}

function cleanPathHints(value: unknown): WorkspaceFolderMapping['pathHints'] {
  const hints = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    vps: cleanString(hints.vps),
    local: cleanString(hints.local),
    notes: cleanString(hints.notes),
  }
}

function makeId(name: string, index: number): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug ? `folder-${slug}` : `folder-${index + 1}`
}

export function normalizeWorkspaceFolderMappings(value: unknown): WorkspaceFolderMapping[] {
  const folders = Array.isArray(value) ? value : []
  return folders
    .map((folder, index) => {
      const raw = folder && typeof folder === 'object' ? (folder as Record<string, unknown>) : {}
      const name = cleanString(raw.name)
      if (!name) return null
      const visibility = cleanEnum(raw.visibility, VISIBILITIES, 'admin_agents')

      return {
        id: cleanString(raw.id) || makeId(name, index),
        name,
        parentId: cleanNullableString(raw.parentId),
        resourceType: cleanString(raw.resourceType) || 'client_workspace',
        resourceId: cleanString(raw.resourceId),
        folderType: cleanString(raw.folderType) || 'general',
        tags: cleanTags(raw.tags),
        sortOrder: cleanNumber(raw.sortOrder, index + 1000),
        driveFolderId: cleanString(raw.driveFolderId),
        driveFolderUrl: cleanString(raw.driveFolderUrl),
        pathHints: cleanPathHints(raw.pathHints),
        visibility,
        exposeInClientPortal: raw.exposeInClientPortal === true,
        sourceOfTruth: cleanEnum(raw.sourceOfTruth, SOURCES, 'google_drive'),
        syncMode: cleanEnum(raw.syncMode, SYNC_MODES, 'full'),
        syncTargets: cleanSyncTargets(raw.syncTargets),
        syncStatus: cleanEnum(raw.syncStatus, SYNC_STATUSES, 'not_configured'),
        auditStatus: cleanEnum(raw.auditStatus, AUDIT_STATUSES, 'unknown'),
        permissionNotes: cleanString(raw.permissionNotes),
        lastSyncedAt: cleanNullableString(raw.lastSyncedAt),
        lastAuditAt: cleanNullableString(raw.lastAuditAt),
        lastConflictAt: cleanNullableString(raw.lastConflictAt),
        updatedAt: cleanNullableString(raw.updatedAt),
      }
    })
    .filter((folder): folder is WorkspaceFolderMapping => Boolean(folder))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

export function folderVisibilityLabel(value: FolderVisibility): string {
  switch (value) {
    case 'admin_only': return 'Admin only'
    case 'admin_agents_clients': return 'Admin + agents + clients'
    case 'admin_agents':
    default: return 'Admin + agents'
  }
}

export function folderSyncTargetLabel(value: FolderSyncTarget): string {
  return value === 'local_cowork' ? 'Local Cowork' : 'VPS'
}

export function folderSourceOfTruthLabel(value: FolderSourceOfTruth): string {
  switch (value) {
    case 'google_drive': return 'Google Drive is source of truth'
    case 'local_cowork': return 'Local Cowork is source of truth'
    case 'vps': return 'VPS is source of truth'
    case 'mixed':
    default: return 'Mixed source of truth'
  }
}

export function folderSyncModeLabel(value: FolderSyncMode): string {
  switch (value) {
    case 'metadata_only': return 'Metadata only'
    case 'manual': return 'Manual sync'
    case 'full':
    default: return 'Full sync'
  }
}
