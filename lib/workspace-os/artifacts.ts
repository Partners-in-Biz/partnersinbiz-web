import type { ApiUser } from '@/lib/api/types'
import { WORKSPACE_FOLDER_VISIBILITIES, type WorkspaceFolderVisibility } from '@/lib/workspace-folders/model'
import { asRecord, cleanHttpUrl, cleanRequiredString, cleanString, cleanStringArray, enumValue, slugify } from './common'

export const WORKSPACE_ARTIFACT_COLLECTION = 'workspace_artifacts'
export const WORKSPACE_ARTIFACT_TYPES = ['drive_folder', 'drive_file', 'google_doc', 'google_sheet', 'export', 'shortcut'] as const
export const WORKSPACE_ARTIFACT_STATUSES = ['draft', 'internal_review', 'approved', 'client_visible', 'archived'] as const
export const WORKSPACE_ACL_ALIGNMENT_STATUSES = ['aligned', 'broader_than_pib', 'narrower_than_pib', 'unknown'] as const

export type WorkspaceArtifactType = (typeof WORKSPACE_ARTIFACT_TYPES)[number]
export type WorkspaceArtifactLifecycleStatus = (typeof WORKSPACE_ARTIFACT_STATUSES)[number]
export type WorkspaceAclAlignmentStatus = (typeof WORKSPACE_ACL_ALIGNMENT_STATUSES)[number]

export interface WorkspaceArtifact {
  id?: string
  orgId: string
  artifactKey: string | null
  title: string
  artifactType: WorkspaceArtifactType
  mimeType: string | null
  google: { fileId: string | null; folderId: string | null; driveId: string | null; url: string | null; webViewLink: string | null; webContentLink: string | null; parents: string[] }
  workspaceFolderId: string | null
  connectionId: string | null
  resourceType: string | null
  resourceId: string | null
  projectId: string | null
  taskId: string | null
  clientDocumentId: string | null
  sourceDocumentId: string | null
  sourceDocumentSectionId: string | null
  sourceSpecVersion: string | null
  sourceResearchItemId: string | null
  approvalGateTaskId: string | null
  agentId: string | null
  visibility: WorkspaceFolderVisibility
  lifecycleStatus: WorkspaceArtifactLifecycleStatus
  piBCanonicalUrl: string | null
  sourceTemplateArtifactId: string | null
  naming: { conventionVersion: string | null; generatedName: string | null; versionLabel: string | null }
  permissions: { externalShared: boolean; anyoneWithLink: boolean; domainShared: boolean; aclAlignmentStatus: WorkspaceAclAlignmentStatus; lastCheckedAt: string | null; allowedAgentIds: string[] }
  sync: { sourceOfTruth: 'google_drive'; syncMode: 'full' | 'metadata_only' | 'manual'; syncStatus: string; lastSyncedAt: string | null; conflictStatus: string | null }
  deleted: boolean
}

function extractGoogleFileId(url: string | null, explicit: string | null): string | null {
  if (explicit) return explicit
  if (!url) return null
  const patterns = [/\/document\/d\/([^/]+)/, /\/spreadsheets\/d\/([^/]+)/, /\/file\/d\/([^/]+)/, /\/folders\/([^/?#]+)/, /[?&]id=([^&#]+)/]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match?.[1]) return decodeURIComponent(match[1])
  }
  return null
}

export function normalizeWorkspaceArtifactInput(input: unknown, orgId: string): WorkspaceArtifact {
  const body = asRecord(input)
  const googleBody = asRecord(body.google)
  const permissions = asRecord(body.permissions)
  const sync = asRecord(body.sync)
  const naming = asRecord(body.naming)
  const googleUrl = cleanHttpUrl(body.googleUrl ?? googleBody.url ?? googleBody.webViewLink, 'googleUrl')
  const fileId = extractGoogleFileId(googleUrl, cleanString(body.googleFileId ?? googleBody.fileId))
  const artifactKey = cleanString(body.artifactKey)
  return {
    orgId: cleanRequiredString(orgId, 'orgId'),
    artifactKey: artifactKey ? slugify(artifactKey) : null,
    title: cleanRequiredString(body.title ?? body.name, 'title'),
    artifactType: enumValue(body.artifactType ?? body.type, WORKSPACE_ARTIFACT_TYPES, 'drive_file', 'artifactType'),
    mimeType: cleanString(body.mimeType),
    google: {
      fileId,
      folderId: cleanString(body.googleFolderId ?? googleBody.folderId),
      driveId: cleanString(body.googleDriveId ?? googleBody.driveId),
      url: googleUrl,
      webViewLink: cleanHttpUrl(googleBody.webViewLink, 'google.webViewLink') ?? googleUrl,
      webContentLink: cleanHttpUrl(googleBody.webContentLink, 'google.webContentLink'),
      parents: cleanStringArray(googleBody.parents),
    },
    workspaceFolderId: cleanString(body.workspaceFolderId),
    connectionId: cleanString(body.connectionId),
    resourceType: cleanString(body.resourceType),
    resourceId: cleanString(body.resourceId),
    projectId: cleanString(body.projectId),
    taskId: cleanString(body.taskId),
    clientDocumentId: cleanString(body.clientDocumentId),
    sourceDocumentId: cleanString(body.sourceDocumentId),
    sourceDocumentSectionId: cleanString(body.sourceDocumentSectionId),
    sourceSpecVersion: cleanString(body.sourceSpecVersion),
    sourceResearchItemId: cleanString(body.sourceResearchItemId),
    approvalGateTaskId: cleanString(body.approvalGateTaskId),
    agentId: cleanString(body.agentId),
    visibility: enumValue(body.visibility, WORKSPACE_FOLDER_VISIBILITIES, 'admin_agents', 'visibility'),
    lifecycleStatus: enumValue(body.lifecycleStatus, WORKSPACE_ARTIFACT_STATUSES, 'draft', 'lifecycleStatus'),
    piBCanonicalUrl: cleanHttpUrl(body.piBCanonicalUrl, 'piBCanonicalUrl'),
    sourceTemplateArtifactId: cleanString(body.sourceTemplateArtifactId),
    naming: {
      conventionVersion: cleanString(naming.conventionVersion),
      generatedName: cleanString(naming.generatedName),
      versionLabel: cleanString(naming.versionLabel),
    },
    permissions: {
      externalShared: permissions.externalShared === true,
      anyoneWithLink: permissions.anyoneWithLink === true,
      domainShared: permissions.domainShared === true,
      aclAlignmentStatus: enumValue(permissions.aclAlignmentStatus, WORKSPACE_ACL_ALIGNMENT_STATUSES, 'unknown', 'permissions.aclAlignmentStatus'),
      lastCheckedAt: cleanString(permissions.lastCheckedAt),
      allowedAgentIds: cleanStringArray(permissions.allowedAgentIds),
    },
    sync: {
      sourceOfTruth: 'google_drive',
      syncMode: enumValue(sync.syncMode, ['full', 'metadata_only', 'manual'] as const, 'metadata_only', 'sync.syncMode'),
      syncStatus: cleanString(sync.syncStatus) ?? 'not_configured',
      lastSyncedAt: cleanString(sync.lastSyncedAt),
      conflictStatus: cleanString(sync.conflictStatus) ?? 'none',
    },
    deleted: false,
  }
}

export function canReadWorkspaceArtifact(artifact: Pick<WorkspaceArtifact, 'orgId' | 'visibility' | 'lifecycleStatus' | 'permissions'>, user: ApiUser): boolean {
  if (user.role === 'admin') return true
  if (user.role === 'client') {
    const orgIds = user.orgIds?.length ? user.orgIds : (user.orgId ? [user.orgId] : [])
    return orgIds.includes(artifact.orgId) && artifact.visibility === 'admin_agents_clients' && artifact.lifecycleStatus === 'client_visible'
  }
  if (user.role === 'ai') {
    if (artifact.visibility === 'admin_only') return false
    const allowed = artifact.permissions?.allowedAgentIds ?? []
    const agentId = user.agentId ?? user.uid.replace(/^agent:/, '')
    return allowed.length === 0 || allowed.includes(agentId)
  }
  return false
}

export interface WorkspaceArtifactLookupFilters {
  resourceType?: string | null
  resourceId?: string | null
  projectId?: string | null
  taskId?: string | null
  workspaceFolderId?: string | null
  type?: string | null
  visibility?: string | null
  status?: string | null
  q?: string | null
}

export function workspaceArtifactMatchesLookup(artifact: WorkspaceArtifact, filters: WorkspaceArtifactLookupFilters): boolean {
  if (filters.resourceType && artifact.resourceType !== filters.resourceType) return false
  if (filters.resourceId && artifact.resourceId !== filters.resourceId) return false
  if (filters.projectId && artifact.projectId !== filters.projectId) return false
  if (filters.taskId && artifact.taskId !== filters.taskId) return false
  if (filters.workspaceFolderId && artifact.workspaceFolderId !== filters.workspaceFolderId) return false
  if (filters.type && artifact.artifactType !== filters.type) return false
  if (filters.visibility && artifact.visibility !== filters.visibility) return false
  if (filters.status && artifact.lifecycleStatus !== filters.status) return false
  if (filters.q && !artifact.title.toLowerCase().includes(filters.q.toLowerCase())) return false
  return true
}

export function buildWorkspaceArtifactUpdate(input: unknown): Partial<WorkspaceArtifact> {
  const body = asRecord(input)
  if (body.orgId !== undefined) throw new Error('orgId cannot be changed')
  const normalized = normalizeWorkspaceArtifactInput({ title: 'placeholder', ...body }, 'placeholder-org')
  const updates: Partial<WorkspaceArtifact> = {}
  for (const key of Object.keys(normalized) as Array<keyof WorkspaceArtifact>) {
    if (key === 'orgId' || key === 'deleted') continue
    if (body[key] !== undefined || (key === 'google' && (body.googleUrl !== undefined || body.googleFileId !== undefined || body.googleFolderId !== undefined || body.googleDriveId !== undefined)) || (key === 'title' && body.name !== undefined)) {
      updates[key] = normalized[key] as never
    }
  }
  return updates
}

export function serializeWorkspaceArtifact(id: string, data: Record<string, unknown>): WorkspaceArtifact & { id: string } {
  return { id, ...(data as unknown as WorkspaceArtifact) }
}
