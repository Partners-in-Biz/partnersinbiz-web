import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { joinCoworkWorkingPath } from '@/lib/client-provisioning/cowork-working-path'
import { buildClientProvisioningPayload, inferCompanyCoworkDomain } from '@/lib/client-provisioning/provisioner'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import {
  normalizeProjectCodeRoots,
  type ProjectCodeRoot,
  type ProjectFolderMode,
} from '@/lib/projects/code-workspace'

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
  /** Linked-computer Workspace mapping chosen for this session (folder location). */
  mappingId?: string
  mappingLabel?: string
  shareMode: 'private' | 'shared' | 'org'
  ownerUserId: string
  companyId: string | null
  companyName?: string
  /** Optional domain/website hint used when auto-provisioning a missing company Cowork folder. */
  companyDomain?: string
  /** Client org that owns the company Cowork workspace record when distinct from the active chat org. */
  companyLinkedOrgId?: string
  contactIds: string[]
  folderScope?: 'organisation' | 'company' | 'project'
  folderRelativePath?: string
  /** OpenBot-style isolated browser profile on the linked computer / VPS. */
  browserProfileId?: string
  vpsWorkingPath?: string
  localWorkingPath?: string
  projectId?: string
  projectName?: string
  /** standard = projects/{id}; registered = existing shared app folder */
  projectFolderMode?: ProjectFolderMode
  /** True when multiple PiB Projects intentionally share this on-disk tree */
  sharedFolder?: boolean
  /** Related monorepo roots relative to the primary project folder */
  codeRoots?: ProjectCodeRoot[]
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
  mappingId?: string | null
  mappingLabel?: string | null
  shareMode?: ConversationWorkspaceContext['shareMode'] | null
  projectId?: string | null
  projectName?: string | null
  folderRelativePath?: string | null
  browserProfileId?: string | null
  companyId?: string | null
  companyName?: string | null
  companyDomain?: string | null
  companyLinkedOrgId?: string | null
}): Promise<ConversationWorkspaceContext | null> {
  const workspace = input.workspaceId
    ? await getOrgWorkspaceById(input.workspaceId)
    : await getDefaultOrgWorkspace(input.orgId)
  if (!workspace || workspace.orgId !== input.orgId) return null
  const runtimeTarget = (input.runtimeTarget || workspace.defaultRuntimeTarget || 'vps') as WorkspaceRuntimeTarget
  const projectId = cleanString(input.projectId)
  let projectName = cleanString(input.projectName)
  let projectCompanyId = cleanString(input.companyId)
  let projectFolderMode: ProjectFolderMode | undefined
  let sharedFolder = false
  let codeRoots: ProjectCodeRoot[] = []
  if (projectId && !projectId.includes('/')) {
    const projectSnapshot = await adminDb.collection('projects').doc(projectId).get()
    if (projectSnapshot.exists) {
      const project = projectSnapshot.data() ?? {}
      const projectOrgId = cleanString(project.sourceOrgId) || cleanString(project.orgId)
      if (projectOrgId === input.orgId || !projectOrgId) {
        projectCompanyId = projectCompanyId
          || cleanString(project.sourceCompanyId)
          || cleanString(project.companyId)
        if (!projectName) projectName = cleanString(project.name)
        const mode = cleanString(project.projectFolderMode)
        if (mode === 'registered' || mode === 'standard') projectFolderMode = mode
        sharedFolder = project.sharedFolder === true
          || (Array.isArray(project.sharedProjectIds) && project.sharedProjectIds.length > 1)
        codeRoots = normalizeProjectCodeRoots(project.codeRoots)
      }
    }
  }
  let companyWorkspace = projectCompanyId
    ? await getCompanyWorkspaceByCompanyId(projectCompanyId)
    : null
  const explicitCompanyId = cleanString(input.companyId)
  const companyName = cleanString(input.companyName) || companyWorkspace?.orgName || ''
  const companyDomainHint = cleanString(input.companyDomain)
  const companyLinkedOrgId = cleanString(input.companyLinkedOrgId) || cleanString(companyWorkspace?.orgId)
  // Explicit company-root sessions must never fall back to the organisation root.
  // If the Firestore company Workspace link is missing, build a provisional company
  // Cowork identity so create/ensure can provision the folder instead of 404ing.
  if (explicitCompanyId && !companyWorkspace) {
    if (!companyName) return null
    const domain = inferCompanyCoworkDomain({ name: companyName, domain: companyDomainHint })
    const provisionalOrgId = companyLinkedOrgId || input.orgId
    const provisional = buildClientProvisioningPayload({
      clientName: companyName,
      domain,
      orgId: provisionalOrgId,
      companyId: explicitCompanyId,
      platformOwned: input.orgId === PIB_PLATFORM_ORG_ID || provisionalOrgId === PIB_PLATFORM_ORG_ID,
    })
    companyWorkspace = {
      id: provisional.manifest.workspaceId,
      workspaceId: provisional.manifest.workspaceId,
      orgId: provisional.manifest.orgId,
      orgSlug: provisional.manifest.orgSlug,
      orgName: provisional.manifest.orgName,
      agentDomain: provisional.manifest.agentDomain,
      agentName: provisional.manifest.agentName,
      vpsPath: provisional.manifest.vpsPath,
      localPath: provisional.manifest.localPath,
      agentDomainPath: provisional.manifest.agentDomainPath,
      localAgentDomainPath: provisional.manifest.localAgentDomainPath,
      sourceOfTruth: 'vps',
      syncMode: provisional.manifest.syncMode,
      defaultRuntimeTarget: 'vps',
      status: 'active',
      folderVersion: provisional.manifest.folderVersion,
      manifest: provisional.manifest,
      companyId: explicitCompanyId,
      contactIds: provisional.manifest.linked.contactIds,
    }
  }
  // Legacy project rows may still lack a company Workspace link; keep those
  // on their existing organisation project path until their CRM link is repaired.
  const workspaceRoot = companyWorkspace ?? workspace
  const requestedFolderRelativePath = cleanString(input.folderRelativePath)
  const folderRelativePath = projectId
    ? requestedFolderRelativePath || `projects/${projectId}`
    : requestedFolderRelativePath
  if (folderRelativePath) {
    const segments = folderRelativePath.split('/')
    if (folderRelativePath.startsWith('/') || folderRelativePath.startsWith('~')
      || folderRelativePath.includes('\\') || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
      return null
    }
  }
  // Company Cowork sessions keep the active org as the security perspective, but
  // agent knowledge/domain must follow the company folder (e.g. hunt-and-gun), not
  // the Partners platform wiki.
  const agentDomainSource = companyWorkspace ?? workspace
  const mappingId = cleanString(input.mappingId)
  const mappingLabel = cleanString(input.mappingLabel)
  return {
    workspaceId: workspace.workspaceId,
    orgId: workspace.orgId,
    orgSlug: workspace.orgSlug,
    orgName: workspace.orgName,
    agentDomain: agentDomainSource.agentDomain || workspace.agentDomain,
    ...(companyWorkspace ? { companyWorkspaceId: companyWorkspace.workspaceId } : {}),
    vpsPath: workspaceRoot.vpsPath,
    localPath: workspaceRoot.localPath,
    agentDomainPath: agentDomainSource.agentDomainPath || workspace.agentDomainPath,
    localAgentDomainPath: agentDomainSource.localAgentDomainPath || workspace.localAgentDomainPath,
    sourceOfTruth: 'vps',
    runtimeTarget,
    runtimeLabel: input.runtimeLabel?.trim() || workspaceRuntimeLabel(runtimeTarget),
    ...(mappingId ? { mappingId } : {}),
    ...(mappingLabel ? { mappingLabel } : {}),
    shareMode: input.shareMode || 'private',
    ownerUserId: input.ownerUserId,
    companyId: projectCompanyId || workspace.companyId || null,
    ...(companyName ? { companyName } : {}),
    ...(companyDomainHint ? { companyDomain: companyDomainHint } : {}),
    ...(companyLinkedOrgId ? { companyLinkedOrgId } : {}),
    contactIds: Array.isArray(workspace.contactIds) ? workspace.contactIds : [],
    folderScope: projectId ? 'project' : projectCompanyId ? 'company' : 'organisation',
    folderRelativePath,
    ...(cleanString(input.browserProfileId) ? { browserProfileId: cleanString(input.browserProfileId) } : {}),
    vpsWorkingPath: joinCoworkWorkingPath(workspaceRoot.vpsPath, folderRelativePath),
    localWorkingPath: joinCoworkWorkingPath(workspaceRoot.localPath, folderRelativePath),
    ...(projectId ? { projectId } : {}),
    ...(projectName ? { projectName } : {}),
    ...(projectFolderMode ? { projectFolderMode } : {}),
    ...(sharedFolder ? { sharedFolder: true } : {}),
    ...(codeRoots.length > 0 ? { codeRoots } : {}),
  }
}
