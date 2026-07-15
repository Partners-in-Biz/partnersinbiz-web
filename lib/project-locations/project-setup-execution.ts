import type { ApiUser } from '@/lib/api/types'
import type { OrgWorkspaceRecord } from '@/lib/client-provisioning/workspace-context'
import type { WorkspaceFolder } from '@/lib/workspace-folders/model'
import type {
  LinkProjectLocationInput,
} from './store'
import type { ProjectExecutionLocation, ProjectLocationReplica } from './model'
import type {
  StandardProjectFolderProvisioningInput,
  StandardProjectFolderProvisioningResult,
} from './project-folder-provisioning'

export type ProjectSetupExecutionMode = 'existing_folder' | 'standard' | 'full_client'

export interface ProjectSetupOperationResponse {
  ok: boolean
  status: number
  data?: Record<string, unknown>
  error?: string
}

export type SetupWorkspace = Pick<OrgWorkspaceRecord, 'workspaceId' | 'orgId' | 'vpsPath' | 'localPath'>
export type SetupWorkspaceFolder = Pick<WorkspaceFolder,
  'id' | 'orgId' | 'name' | 'deleted' | 'projectId' | 'resourceType' | 'resourceId' | 'paths'>

export interface ProjectSetupExecutionDependencies {
  createProject(input: Record<string, unknown>): Promise<ProjectSetupOperationResponse>
  createOrganization(input: Record<string, unknown>): Promise<ProjectSetupOperationResponse>
  resumeOrganization(input: {
    organizationId: string
    organizationSlug?: string
    clientName: string
    agentName?: string
    actor: ApiUser
  }): Promise<ProjectSetupOperationResponse>
  getWorkspace(orgId: string, workspaceId?: string): Promise<SetupWorkspace | null>
  getWorkspaceFolder(folderId: string, orgId: string, actor: ApiUser): Promise<SetupWorkspaceFolder | null>
  listExecutionLocations(orgId: string, workspaceId: string, actorUserId: string): Promise<ProjectExecutionLocation[]>
  provisionProjectFolder(input: StandardProjectFolderProvisioningInput): Promise<StandardProjectFolderProvisioningResult>
  linkProjectLocation(input: LinkProjectLocationInput): Promise<ProjectLocationReplica>
  patchProject(projectId: string, patch: Record<string, unknown>): Promise<void>
  patchWorkspaceFolder(folderId: string, patch: Record<string, unknown>): Promise<void>
}

export type ProjectSetupActionStatus = 'completed' | 'pending' | 'failed' | 'blocked'

export interface ProjectSetupExecutionAction {
  type: string
  status: ProjectSetupActionStatus
  error?: string
  [key: string]: unknown
}

export interface ProjectSetupExecutionPlan {
  requestId: string
  mode: ProjectSetupExecutionMode
  state: 'created_sync_pending' | 'location_selection_pending' | 'ready' | 'partial'
  completed: boolean
  syncCompleted: boolean
  actions: ProjectSetupExecutionAction[]
}

export interface ProjectSetupExecutionResult {
  status: 201 | 202 | 207
  projectId?: string
  organizationId?: string
  organizationSlug?: string
  project?: { id: string; name: string; orgId: string; workspaceId?: string }
  folder?: StandardProjectFolderProvisioningResult | {
    workspaceFolderId: string
    relativePaths: Record<string, string>
  }
  replicas: ProjectLocationReplica[]
  plan: ProjectSetupExecutionPlan
}

export interface ProjectSetupExecutionCheckpoint {
  organizationId?: string
  organizationSlug?: string
  organizationReady?: boolean
  projectId?: string
  folder?: ProjectSetupExecutionResult['folder']
  replicas?: ProjectLocationReplica[]
}

export interface ProjectSetupExecutionOptions {
  requestId?: string
  resume?: ProjectSetupExecutionCheckpoint
  checkpoint?: (checkpoint: ProjectSetupExecutionCheckpoint) => Promise<void>
}

export class ProjectSetupExecutionError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'ProjectSetupExecutionError'
  }
}

function clean(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ProjectSetupExecutionError(`${field} is required`)
  return value.trim()
}

function optionalClean(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)))
}

function mode(value: unknown): ProjectSetupExecutionMode {
  if (value !== 'existing_folder' && value !== 'standard' && value !== 'full_client') {
    throw new ProjectSetupExecutionError('mode is invalid')
  }
  return value
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Project setup action failed'
}

function setupRequestId(setupMode: ProjectSetupExecutionMode, projectName: string): string {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'
  return `setup:${setupMode}:${slug}`
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/g, '')
}

function registeredRelativePath(rootValue: string, childValue: string, label: string): string {
  const root = normalizePath(rootValue)
  const child = normalizePath(childValue)
  if (!root || !child || child === root || !child.startsWith(`${root}/`)) {
    throw new ProjectSetupExecutionError(`${label} must stay inside the registered Workspace`)
  }
  const relative = child.slice(root.length + 1)
  const segments = relative.split('/')
  if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..')
    || /[\u0000-\u001f]/.test(relative)) {
    throw new ProjectSetupExecutionError(`${label} is unsafe`)
  }
  return relative
}

function existingFolderRelativePath(
  folder: SetupWorkspaceFolder,
  workspace: SetupWorkspace,
  location: ProjectExecutionLocation,
): string {
  if (location.kind === 'vps') {
    if (!folder.paths.vpsPath) throw new ProjectSetupExecutionError('The registered folder has no VPS path')
    return registeredRelativePath(workspace.vpsPath, folder.paths.vpsPath, 'Registered VPS folder')
  }
  if (!folder.paths.localPathHint) throw new ProjectSetupExecutionError('The registered folder has no computer path')
  return registeredRelativePath(workspace.localPath, folder.paths.localPathHint, 'Registered computer folder')
}

function locationMapping(location: ProjectExecutionLocation, orgId: string, workspaceId: string): string {
  const mapping = location.mappings.find((candidate) => (
    candidate.orgId === orgId
    && candidate.workspaceId === workspaceId
    && candidate.status === 'active'
  ))
  if (!mapping) throw new ProjectSetupExecutionError(
    `${location.label} is not mapped to this organisation Workspace`,
    403,
  )
  return mapping.mappingId
}

async function selectedLocations(input: {
  locationIds: string[]
  orgId: string
  workspaceId: string
  actorUserId: string
}, dependencies: ProjectSetupExecutionDependencies): Promise<ProjectExecutionLocation[]> {
  const available = await dependencies.listExecutionLocations(input.orgId, input.workspaceId, input.actorUserId)
  const byId = new Map<string, ProjectExecutionLocation>()
  for (const candidate of available) {
    byId.set(candidate.locationId, candidate)
    byId.set(candidate.runtimeTargetId, candidate)
    if (candidate.legacyCompatibilityTargetId) byId.set(candidate.legacyCompatibilityTargetId, candidate)
  }
  return input.locationIds.map((locationId) => {
    const selected = byId.get(locationId)
    if (!selected) throw new ProjectSetupExecutionError(`Execution location is not available: ${locationId}`, 403)
    if (selected.status !== 'active' || selected.verificationStatus !== 'verified') {
      throw new ProjectSetupExecutionError(`Execution location is not verified: ${locationId}`, 403)
    }
    if (selected.availability !== 'online') {
      throw new ProjectSetupExecutionError('Computer unavailable', 409)
    }
    locationMapping(selected, input.orgId, input.workspaceId)
    return selected
  })
}

function requireOperationId(operation: string, response: ProjectSetupOperationResponse): string {
  const id = optionalClean(response.data?.id)
  if (!response.ok || !id) {
    throw new ProjectSetupExecutionError(
      response.error || `${operation} failed`,
      response.status >= 400 ? response.status : 500,
    )
  }
  return id
}

function partialPlan(input: {
  setupMode: ProjectSetupExecutionMode
  projectName: string
  actions: ProjectSetupExecutionAction[]
  requestId?: string
}): ProjectSetupExecutionPlan {
  return {
    requestId: input.requestId ?? setupRequestId(input.setupMode, input.projectName),
    mode: input.setupMode,
    state: 'partial',
    completed: false,
    syncCompleted: false,
    actions: input.actions,
  }
}

async function createProject(
  projectName: string,
  orgId: string,
  input: Record<string, unknown>,
  dependencies: ProjectSetupExecutionDependencies,
): Promise<string> {
  const response = await dependencies.createProject({
    name: projectName,
    orgId,
    ...(optionalClean(input.companyId) ? { sourceCompanyId: optionalClean(input.companyId) } : {}),
    ...(optionalClean(input.description) ? { description: optionalClean(input.description) } : {}),
    ...(optionalClean(input.status) ? { status: optionalClean(input.status) } : {}),
  })
  return requireOperationId('Project creation', response)
}

export async function executeProjectSetup(
  input: Record<string, unknown>,
  actor: ApiUser,
  dependencies: ProjectSetupExecutionDependencies,
  options: ProjectSetupExecutionOptions = {},
): Promise<ProjectSetupExecutionResult> {
  const setupMode = mode(input.mode)
  const projectName = clean(input.projectName, 'projectName')
  const requestId = options.requestId ?? setupRequestId(setupMode, projectName)
  const actions: ProjectSetupExecutionAction[] = []
  let progress: ProjectSetupExecutionCheckpoint = {
    ...(options.resume ?? {}),
    ...(options.resume?.replicas ? { replicas: [...options.resume.replicas] } : {}),
  }
  const saveCheckpoint = async (patch: Partial<ProjectSetupExecutionCheckpoint>) => {
    progress = { ...progress, ...patch }
    await options.checkpoint?.(progress)
  }
  let organizationId = optionalClean(progress.organizationId)
  let organizationSlug = optionalClean(progress.organizationSlug)
  let orgId = optionalClean(input.orgId)
  let requestedWorkspaceId = optionalClean(input.workspaceId)

  if (setupMode === 'full_client') {
    if (actor.role !== 'admin') throw new ProjectSetupExecutionError('admin role required for full_client setup', 403)
    const clientName = clean(input.clientName, 'clientName')
    const domainSlug = optionalClean(input.domainSlug)
    const agentName = optionalClean(input.agentName)
    if (domainSlug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(domainSlug)) {
      throw new ProjectSetupExecutionError('domainSlug must be kebab-case')
    }

    let orgResponse: ProjectSetupOperationResponse | null = null
    if (organizationId && progress.organizationReady !== true) {
      orgResponse = await dependencies.resumeOrganization({
        organizationId,
        ...(organizationSlug ? { organizationSlug } : {}),
        clientName,
        ...(agentName ? { agentName } : {}),
        actor,
      })
    } else if (!organizationId) {
      orgResponse = await dependencies.createOrganization({
        name: clientName,
        provisionWorkspace: true,
        ...(domainSlug ? { domainSlug } : {}),
        ...(agentName ? { agentName } : {}),
      })
    }

    if (orgResponse) {
      organizationId = optionalClean(orgResponse.data?.id) ?? organizationId
      organizationSlug = optionalClean(orgResponse.data?.slug) ?? organizationSlug ?? domainSlug
      if (organizationId) {
        await saveCheckpoint({
          organizationId,
          ...(organizationSlug ? { organizationSlug } : {}),
          organizationReady: orgResponse.ok,
        })
      }
      if (!orgResponse.ok || !organizationId) {
        actions.push({
          type: 'create_client_organization',
          status: 'failed',
          error: orgResponse.error || 'Client organisation provisioning failed',
        })
        if (organizationId) {
          return {
            status: 207,
            organizationId,
            ...(organizationSlug ? { organizationSlug } : {}),
            replicas: progress.replicas ?? [],
            plan: partialPlan({ setupMode, projectName, actions, requestId }),
          }
        }
        throw new ProjectSetupExecutionError(
          orgResponse.error || 'Client organisation provisioning failed',
          orgResponse.status >= 400 ? orgResponse.status : 500,
        )
      }
    }

    if (!organizationId) throw new ProjectSetupExecutionError('Client organisation provisioning failed', 500)
    orgId = organizationId
    requestedWorkspaceId = organizationSlug
    actions.push({
      type: 'create_client_organization', status: 'completed', organizationId,
      ...(organizationSlug ? { organizationSlug } : {}),
      ...(orgResponse ? {} : { resumed: true }),
    })
  }

  if (!orgId) throw new ProjectSetupExecutionError('orgId is required')
  const workspace = await dependencies.getWorkspace(orgId, requestedWorkspaceId)
  if (!workspace || workspace.orgId !== orgId) {
    if (organizationId) {
      actions.push({ type: 'resolve_workspace', status: 'failed', error: 'Provisioned Workspace was not registered' })
      return {
        status: 207,
        organizationId,
        ...(organizationSlug ? { organizationSlug } : {}),
        replicas: progress.replicas ?? [],
        plan: partialPlan({ setupMode, projectName, actions, requestId }),
      }
    }
    throw new ProjectSetupExecutionError('Workspace not found', 404)
  }

  const locationIds = uniqueStrings([
    ...uniqueStrings(input.locationIds),
    ...(optionalClean(input.locationId) ? [optionalClean(input.locationId)!] : []),
  ])
  if (setupMode !== 'full_client' && locationIds.length === 0) {
    throw new ProjectSetupExecutionError('At least one execution location is required')
  }

  const locations = locationIds.length > 0
    ? await selectedLocations({
        locationIds,
        orgId,
        workspaceId: workspace.workspaceId,
        actorUserId: actor.uid,
      }, dependencies)
    : []
  const organisationVps = locations.find((location) => location.kind === 'vps'
    && location.owner.type === 'organization' && location.owner.orgId === orgId)
  if (setupMode === 'standard' && !organisationVps) {
    throw new ProjectSetupExecutionError(
      'Standard projects require a verified online organisation VPS location',
      409,
    )
  }
  // Standard folders are provisioned on the organisation VPS. Registered
  // folders already prove their selected root, so their first preferred
  // location may become authoritative when no organisation VPS is selected.
  const canonicalLocationId = organisationVps?.locationId
    ?? (setupMode === 'existing_folder' ? locations[0]?.locationId : undefined)

  let registeredFolder: SetupWorkspaceFolder | null = null
  const relativePaths = new Map<string, string>()
  if (setupMode === 'existing_folder') {
    const workspaceFolderId = clean(input.workspaceFolderId, 'workspaceFolderId')
    registeredFolder = await dependencies.getWorkspaceFolder(workspaceFolderId, orgId, actor)
    if (!registeredFolder || registeredFolder.deleted || registeredFolder.orgId !== orgId) {
      throw new ProjectSetupExecutionError('Registered Workspace folder not found', 404)
    }
    const resumedProjectId = optionalClean(progress.projectId)
    const linkedToDifferentProject = Boolean(registeredFolder.projectId && registeredFolder.projectId !== resumedProjectId)
    const claimedByDifferentProject = registeredFolder.resourceType === 'project'
      && (!resumedProjectId || registeredFolder.projectId !== resumedProjectId)
    if (linkedToDifferentProject || claimedByDifferentProject) {
      throw new ProjectSetupExecutionError('Registered Workspace folder is already linked', 409)
    }
    // Resolve every path exclusively from the server-side registry before any project is created.
    for (const location of locations) {
      relativePaths.set(location.locationId, existingFolderRelativePath(registeredFolder, workspace, location))
    }
    actions.push({
      type: 'confirm_existing_folder',
      status: 'completed',
      workspaceFolderId,
    })
  }

  let projectId = optionalClean(progress.projectId)
  if (!projectId) {
    try {
      projectId = await createProject(projectName, orgId, input, dependencies)
      await saveCheckpoint({ projectId })
    } catch (error) {
      if (!organizationId) throw error
      actions.push({ type: 'create_project_record', status: 'failed', error: message(error) })
      return {
        status: 207,
        organizationId,
        ...(organizationSlug ? { organizationSlug } : {}),
        replicas: progress.replicas ?? [],
        plan: partialPlan({ setupMode, projectName, actions, requestId }),
      }
    }
  }
  actions.push({
    type: 'create_project_record', status: 'completed', projectId,
    ...(options.resume?.projectId ? { resumed: true } : {}),
  })

  let folder: ProjectSetupExecutionResult['folder'] = progress.folder
  let folderReady = Boolean(folder)
  if (setupMode === 'existing_folder' && registeredFolder?.id) {
    folder = {
      workspaceFolderId: registeredFolder.id,
      relativePaths: Object.fromEntries(relativePaths),
    }
    folderReady = true
    await saveCheckpoint({ folder })
  } else if (!folder) {
    try {
      folder = await dependencies.provisionProjectFolder({
        projectId,
        orgId,
        workspaceId: workspace.workspaceId,
        workspacePath: workspace.vpsPath,
      })
      folderReady = true
      await saveCheckpoint({ folder })
      actions.push({ type: 'create_standard_project_folder', status: 'completed', relativePath: folder.relativePath })
      for (const location of locations) relativePaths.set(location.locationId, folder.relativePath)
    } catch (error) {
      folderReady = false
      actions.push({ type: 'create_standard_project_folder', status: 'failed', error: message(error) })
    }
  } else if ('relativePath' in folder) {
    folderReady = true
    for (const location of locations) relativePaths.set(location.locationId, folder.relativePath)
    actions.push({
      type: 'create_standard_project_folder', status: 'completed', relativePath: folder.relativePath, resumed: true,
    })
  }

  const errors: string[] = []
  if (!folderReady) errors.push('folder provisioning failed')
  const selectedLocationIds = new Set(locations.map(location => location.locationId))
  const replicas: ProjectLocationReplica[] = (progress.replicas ?? []).filter(replica => (
    replica.projectId === projectId
      && replica.orgId === orgId
      && replica.workspaceId === workspace.workspaceId
      && selectedLocationIds.has(replica.locationId)
      && replica.active === true
  ))
  if (folderReady) {
    for (const location of locations) {
      const resumedReplica = replicas.find(replica => replica.locationId === location.locationId)
      if (resumedReplica) {
        actions.push({
          type: 'link_project_location', status: 'completed', locationId: location.locationId,
          replicaId: resumedReplica.replicaId, syncStatus: resumedReplica.syncStatus, resumed: true,
        })
        continue
      }
      try {
        const replica = await dependencies.linkProjectLocation({
          projectId,
          orgId,
          workspaceId: workspace.workspaceId,
          locationId: location.locationId,
          mappingId: locationMapping(location, orgId, workspace.workspaceId),
          actorUserId: actor.uid,
          relativePath: relativePaths.get(location.locationId) ?? `projects/${projectId}`,
          isCanonical: location.locationId === canonicalLocationId,
        })
        replicas.push(replica)
        await saveCheckpoint({ replicas: [...replicas] })
        actions.push({
          type: 'link_project_location',
          status: 'completed',
          locationId: location.locationId,
          replicaId: replica.replicaId,
          syncStatus: replica.syncStatus,
        })
      } catch (error) {
        const errorMessage = message(error)
        errors.push(errorMessage)
        actions.push({ type: 'link_project_location', status: 'failed', locationId: location.locationId, error: errorMessage })
      }
    }
  } else {
    actions.push({ type: 'link_project_location', status: 'blocked', reason: 'project folder was not provisioned' })
  }

  try {
    await dependencies.patchProject(projectId, {
      workspaceId: workspace.workspaceId,
      projectFolderMode: setupMode === 'existing_folder' ? 'registered' : 'standard',
      projectFolderRelativePath: setupMode === 'existing_folder'
        ? (relativePaths.values().next().value ?? null)
        : `projects/${projectId}`,
      workspaceFolderId: registeredFolder?.id ?? null,
      executionLocationIds: replicas.map((replica) => replica.locationId),
      canonicalLocationId: canonicalLocationId ?? null,
      setupState: errors.length > 0 ? 'partial' : locationIds.length > 0 ? 'sync_pending' : 'location_selection_pending',
    })
    actions.push({ type: 'record_project_setup', status: 'completed' })
  } catch (error) {
    const errorMessage = message(error)
    errors.push(errorMessage)
    actions.push({ type: 'record_project_setup', status: 'failed', error: errorMessage })
  }

  if (registeredFolder?.id) {
    try {
      await dependencies.patchWorkspaceFolder(registeredFolder.id, {
        projectId,
      })
      actions.push({ type: 'link_workspace_folder_record', status: 'completed', workspaceFolderId: registeredFolder.id })
    } catch (error) {
      const errorMessage = message(error)
      errors.push(errorMessage)
      actions.push({ type: 'link_workspace_folder_record', status: 'failed', error: errorMessage })
    }
  }

  const syncCompleted = replicas.length > 0
    && replicas.every((replica) => replica.isCanonical === true || replica.syncStatus === 'synced')
  actions.push({
    type: 'verify_initial_sync',
    status: syncCompleted ? 'completed' : 'pending',
    requiredEvidence: ['folder manifest', 'location heartbeat', 'revision match'],
  })

  const locationSelectionPending = setupMode === 'full_client' && locationIds.length === 0
  const hasErrors = errors.length > 0
  const plan: ProjectSetupExecutionPlan = {
    requestId,
    mode: setupMode,
    state: hasErrors
      ? 'partial'
      : locationSelectionPending
        ? 'location_selection_pending'
        : syncCompleted
          ? 'ready'
          : 'created_sync_pending',
    // A created project is not fully set up until its initial replica state is
    // actually verified. Folder creation and replica records alone are not
    // proof that bytes have reached every selected machine.
    completed: !hasErrors && !locationSelectionPending && syncCompleted,
    syncCompleted,
    actions,
  }

  return {
    status: hasErrors ? 207 : locationSelectionPending || !syncCompleted ? 202 : 201,
    projectId,
    ...(organizationId ? { organizationId } : {}),
    ...(organizationSlug ? { organizationSlug } : {}),
    project: { id: projectId, name: projectName, orgId, workspaceId: workspace.workspaceId },
    ...(folder ? { folder } : {}),
    replicas,
    plan,
  }
}
