import { callAgentPath } from '@/lib/agents/team'

export interface StandardProjectFolderProvisioningInput {
  projectId: string
  orgId: string
  workspaceId: string
  workspacePath: string
}

export interface StandardProjectFolderProvisioningResult {
  projectId: string
  relativePath: string
  folderStatus: 'provisioned'
  syncStatus: 'pending'
  manifestWritten: boolean
  manifestPreserved: boolean
  directoriesCreated: string[]
  directoriesPreserved: string[]
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function detail(value: unknown): string {
  const data = record(value)
  return typeof data.detail === 'string' && data.detail.trim()
    ? data.detail.trim()
    : JSON.stringify(value).slice(0, 500)
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

export async function provisionStandardProjectFolder(
  input: StandardProjectFolderProvisioningInput,
): Promise<StandardProjectFolderProvisioningResult> {
  const upstream = await callAgentPath('pip', '/admin/project-folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, { runtimeTarget: 'vps' })

  if (!upstream.response.ok) {
    throw new Error(`Project folder provisioning failed: ${detail(upstream.data)}`)
  }

  const data = record(upstream.data)
  const expectedRelativePath = `projects/${input.projectId}`
  if (data.projectId !== input.projectId
    || data.relativePath !== expectedRelativePath
    || data.folderStatus !== 'provisioned') {
    throw new Error('Project folder provisioning returned invalid proof')
  }

  return {
    projectId: input.projectId,
    relativePath: expectedRelativePath,
    folderStatus: 'provisioned',
    // Folder creation is not evidence that other machines have synced.
    syncStatus: 'pending',
    manifestWritten: data.manifestWritten === true,
    manifestPreserved: data.manifestPreserved === true,
    directoriesCreated: stringList(data.directoriesCreated),
    directoriesPreserved: stringList(data.directoriesPreserved),
  }
}
