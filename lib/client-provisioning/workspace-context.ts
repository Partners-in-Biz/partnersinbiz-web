import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'

export type WorkspaceRuntimeTarget = 'vps' | 'local' | 'auto' | string

export type WorkspaceDispatchFailureCode =
  | 'workspace_context_invalid'
  | 'workspace_root_invalid'
  | 'workspace_directory_missing'
  | 'workspace_directory_outside_root'
  | 'workspace_directory_symlink'
  | 'workspace_project_missing'
  | 'workspace_project_archived'

export type OrgWorkspaceManifest = {
  schemaVersion: 1
  workspaceId: string
  orgId: string
  orgSlug: string
  orgName: string
  agentDomain: string
  agentName: string
  vpsPath: string
  localPath: string
  agentDomainPath: string
  localAgentDomainPath: string
  sourceOfTruth: 'vps'
  syncMode: 'git-private-repo' | 'vps-only' | 'hybrid'
  defaultRuntimeTarget: 'vps'
  folderVersion: number
  folders: string[]
  linked: {
    companyId: string | null
    contactIds: string[]
  }
  createdBy: 'client_provisioning'
}

export type OrgWorkspaceRecord = {
  id: string
  workspaceId: string
  orgId: string
  orgSlug: string
  orgName: string
  agentDomain: string
  agentName: string
  vpsPath: string
  localPath: string
  agentDomainPath: string
  localAgentDomainPath: string
  sourceOfTruth: 'vps'
  syncMode: OrgWorkspaceManifest['syncMode']
  defaultRuntimeTarget: 'vps'
  status: 'active' | 'archived' | 'needs_repair'
  folderVersion: number
  manifest: OrgWorkspaceManifest
  companyId: string | null
  contactIds: string[]
  createdAt?: unknown
  updatedAt?: unknown
  lastProvisionedAt?: unknown
  lastBackfilledAt?: unknown
}

export type ConversationWorkspaceContext = {
  workspaceId: string
  /** Company Cowork folder identity; does not grant access to a linked organisation. */
  companyWorkspaceId?: string
  orgId: string
  orgSlug: string
  orgName: string
  agentDomain: string
  vpsPath: string
  localPath: string
  agentDomainPath: string
  localAgentDomainPath: string
  sourceOfTruth: 'vps'
  runtimeTarget: WorkspaceRuntimeTarget
  runtimeLabel: string
  shareMode: 'private' | 'shared' | 'org'
  ownerUserId: string
  companyId: string | null
  companyName?: string
  contactIds: string[]
  folderScope?: 'organisation' | 'company' | 'project'
  folderRelativePath?: string
  vpsWorkingPath?: string
  localWorkingPath?: string
  projectId?: string
  projectName?: string
}

export const ORG_WORKSPACES_COLLECTION = 'org_workspaces'

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function workspaceRuntimeLabel(runtimeTarget: WorkspaceRuntimeTarget): string {
  if (runtimeTarget === 'local') return 'Local'
  if (runtimeTarget === 'vps') return 'VPS'
  if (runtimeTarget === 'auto') return 'Auto'
  return runtimeTarget ? runtimeTarget : 'VPS'
}

export function workspaceRecordFromManifest(manifest: OrgWorkspaceManifest): Omit<OrgWorkspaceRecord, 'id'> {
  return {
    workspaceId: manifest.workspaceId,
    orgId: manifest.orgId,
    orgSlug: manifest.orgSlug,
    orgName: manifest.orgName,
    agentDomain: manifest.agentDomain,
    agentName: manifest.agentName,
    vpsPath: manifest.vpsPath,
    localPath: manifest.localPath,
    agentDomainPath: manifest.agentDomainPath,
    localAgentDomainPath: manifest.localAgentDomainPath,
    sourceOfTruth: 'vps',
    syncMode: manifest.syncMode,
    defaultRuntimeTarget: 'vps',
    status: 'active',
    folderVersion: manifest.folderVersion,
    manifest,
    companyId: manifest.linked.companyId,
    contactIds: manifest.linked.contactIds,
    updatedAt: FieldValue.serverTimestamp(),
    lastProvisionedAt: FieldValue.serverTimestamp(),
  }
}

export async function upsertOrgWorkspace(manifest: OrgWorkspaceManifest): Promise<OrgWorkspaceRecord> {
  const ref = adminDb.collection(ORG_WORKSPACES_COLLECTION).doc(manifest.workspaceId)
  const data = workspaceRecordFromManifest(manifest)
  const existing = await ref.get()
  await ref.set({
    ...data,
    ...(!existing.exists ? { createdAt: FieldValue.serverTimestamp() } : {}),
  }, { merge: true })
  return { id: ref.id, ...data } as OrgWorkspaceRecord
}

export async function getOrgWorkspaceById(workspaceId: string): Promise<OrgWorkspaceRecord | null> {
  const cleanWorkspaceId = cleanString(workspaceId)
  if (!cleanWorkspaceId) return null
  const doc = await adminDb.collection(ORG_WORKSPACES_COLLECTION).doc(cleanWorkspaceId).get()
  if (!doc.exists) return null
  return { id: doc.id, ...doc.data() } as OrgWorkspaceRecord
}

export async function getDefaultOrgWorkspace(orgId: string): Promise<OrgWorkspaceRecord | null> {
  const cleanOrgId = cleanString(orgId)
  if (!cleanOrgId) return null
  const snap = await adminDb.collection(ORG_WORKSPACES_COLLECTION)
    .where('orgId', '==', cleanOrgId)
    .where('status', '==', 'active')
    .limit(1)
    .get()
  const doc = snap.docs[0]
  return doc ? ({ id: doc.id, ...doc.data() } as OrgWorkspaceRecord) : null
}

export async function getCompanyWorkspaceByCompanyId(companyId: string): Promise<OrgWorkspaceRecord | null> {
  const cleanCompanyId = cleanString(companyId)
  if (!cleanCompanyId) return null
  const snap = await adminDb.collection(ORG_WORKSPACES_COLLECTION)
    .where('companyId', '==', cleanCompanyId)
    .where('status', '==', 'active')
    .limit(2)
    .get()
  if (snap.docs.length !== 1) return null
  const doc = snap.docs[0]
  return { id: doc.id, ...doc.data() } as OrgWorkspaceRecord
}

export async function resolveConversationWorkspaceContext(input: {
  orgId: string
  workspaceId?: string | null
  ownerUserId: string
  runtimeTarget?: WorkspaceRuntimeTarget | null
  runtimeLabel?: string | null
  shareMode?: ConversationWorkspaceContext['shareMode'] | null
  projectId?: string | null
  projectName?: string | null
  folderRelativePath?: string | null
  companyId?: string | null
  companyName?: string | null
}): Promise<ConversationWorkspaceContext | null> {
  const workspace = input.workspaceId
    ? await getOrgWorkspaceById(input.workspaceId)
    : await getDefaultOrgWorkspace(input.orgId)
  if (!workspace || workspace.orgId !== input.orgId) return null
  const runtimeTarget = (input.runtimeTarget || workspace.defaultRuntimeTarget || 'vps') as WorkspaceRuntimeTarget
  const projectId = cleanString(input.projectId)
  const projectName = cleanString(input.projectName)
  let projectCompanyId = cleanString(input.companyId)
  if (projectId && !projectId.includes('/')) {
    const projectSnapshot = await adminDb.collection('projects').doc(projectId).get()
    if (projectSnapshot.exists) {
      const project = projectSnapshot.data() ?? {}
      const projectOrgId = cleanString(project.sourceOrgId) || cleanString(project.orgId)
      if (projectOrgId === input.orgId) {
        projectCompanyId = cleanString(project.sourceCompanyId) || cleanString(project.companyId)
      }
    }
  }
  const companyWorkspace = projectCompanyId
    ? await getCompanyWorkspaceByCompanyId(projectCompanyId)
    : null
  // A company-root session must never fall back to the organisation root.
  // Legacy project rows may still lack a company Workspace link; keep those
  // on their existing organisation project path until their CRM link is repaired.
  if (cleanString(input.companyId) && !companyWorkspace) return null
  const companyName = cleanString(input.companyName) || companyWorkspace?.orgName || ''
  const workspaceRoot = companyWorkspace ?? workspace
  const requestedFolderRelativePath = cleanString(input.folderRelativePath)
  const folderRelativePath = projectId
    ? requestedFolderRelativePath || `projects/${projectId}`
    : ''
  if (folderRelativePath) {
    const segments = folderRelativePath.split('/')
    if (folderRelativePath.startsWith('/') || folderRelativePath.startsWith('~')
      || folderRelativePath.includes('\\') || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
      return null
    }
  }
  return {
    workspaceId: workspace.workspaceId,
    orgId: workspace.orgId,
    orgSlug: workspace.orgSlug,
    orgName: workspace.orgName,
    agentDomain: workspace.agentDomain,
    ...(companyWorkspace ? { companyWorkspaceId: companyWorkspace.workspaceId } : {}),
    vpsPath: workspaceRoot.vpsPath,
    localPath: workspaceRoot.localPath,
    agentDomainPath: workspace.agentDomainPath,
    localAgentDomainPath: workspace.localAgentDomainPath,
    sourceOfTruth: 'vps',
    runtimeTarget,
    runtimeLabel: input.runtimeLabel?.trim() || workspaceRuntimeLabel(runtimeTarget),
    shareMode: input.shareMode || 'private',
    ownerUserId: input.ownerUserId,
    companyId: projectCompanyId || workspace.companyId || null,
    ...(companyName ? { companyName } : {}),
    contactIds: Array.isArray(workspace.contactIds) ? workspace.contactIds : [],
    folderScope: projectId ? 'project' : projectCompanyId ? 'company' : 'organisation',
    folderRelativePath,
    vpsWorkingPath: folderRelativePath ? `${workspaceRoot.vpsPath}/${folderRelativePath}` : workspaceRoot.vpsPath,
    localWorkingPath: folderRelativePath ? `${workspaceRoot.localPath}/${folderRelativePath}` : workspaceRoot.localPath,
    ...(projectId ? { projectId } : {}),
    ...(projectName ? { projectName } : {}),
  }
}
