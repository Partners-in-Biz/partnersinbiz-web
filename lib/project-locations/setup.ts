export type ProjectSetupMode = 'existing_folder' | 'standard' | 'full_client'

export interface ProjectSetupPlan {
  requestId: string
  mode: ProjectSetupMode
  state: string
  completed: false
  syncCompleted: false
  actions: Array<{ type: string; [key: string]: unknown }>
}

function clean(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)))
}

function action(type: string, details: Record<string, unknown> = {}) {
  return { type, status: 'required', ...details }
}

export function buildProjectSetupPlan(input: Record<string, unknown>, actor: { actorUserId: string; actorRole: 'admin' | 'client' | 'ai' }): ProjectSetupPlan {
  const mode = input.mode
  if (mode !== 'existing_folder' && mode !== 'standard' && mode !== 'full_client') throw new Error('mode is invalid')
  const projectName = clean(input.projectName, 'projectName')
  const requestId = `setup:${mode}:${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  const base: Pick<ProjectSetupPlan, 'requestId' | 'mode' | 'completed' | 'syncCompleted'> = {
    requestId,
    mode,
    completed: false,
    syncCompleted: false,
  }

  if (mode === 'existing_folder') {
    const orgId = clean(input.orgId, 'orgId')
    const workspaceId = clean(input.workspaceId, 'workspaceId')
    const locationId = clean(input.locationId, 'locationId')
    const mappingId = clean(input.mappingId, 'mappingId')
    return {
      ...base,
      state: 'awaiting_mapping_confirmation',
      actions: [
        action('confirm_existing_folder', { locationId, mappingId }),
        action('create_project_record', { orgId, projectName }),
        action('link_project_location', { locationId, mappingId, workspaceId }),
        action('verify_initial_sync', { requiredEvidence: ['location heartbeat', 'working directory proof', 'revision match'] }),
      ],
    }
  }

  if (mode === 'standard') {
    const orgId = clean(input.orgId, 'orgId')
    const workspaceId = clean(input.workspaceId, 'workspaceId')
    const locationIds = stringArray(input.locationIds)
    return {
      ...base,
      state: 'awaiting_standard_provisioning',
      actions: [
        ...(locationIds.length ? [] : [action('select_project_locations')]),
        action('create_standard_project_folder', { orgId, workspaceId, locationIds, folderTemplate: 'client-manager-standard' }),
        action('create_project_record', { orgId, projectName }),
        action('link_project_location', { locationIds, workspaceId }),
        action('verify_initial_sync', { requiredEvidence: ['folder manifest', 'location heartbeat', 'revision match'] }),
      ],
    }
  }

  if (actor.actorRole !== 'admin') throw new Error('admin role required for full_client setup')
  const clientName = clean(input.clientName, 'clientName')
  const domainSlug = clean(input.domainSlug, 'domainSlug')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(domainSlug)) throw new Error('domainSlug must be kebab-case')
  return {
    ...base,
    state: 'awaiting_client_provisioning',
    actions: [
      action('create_client_organization', { endpoint: '/api/v1/organizations', clientName, domainSlug }),
      action('provision_client_workspace', { contract: 'client-manager/full-cowork-space', domainSlug }),
      action('create_project_record', { projectName, orgIdSource: 'created_client_organization' }),
      action('link_project_location', { locationSource: 'selected_after_workspace_provisioning' }),
      action('verify_initial_sync', { requiredEvidence: ['org id', 'workspace manifest', 'location heartbeat', 'revision match'] }),
    ],
  }
}
