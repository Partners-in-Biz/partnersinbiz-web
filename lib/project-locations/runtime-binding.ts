import { linkedDeviceProjectLocationId } from '@/lib/linked-computers/runtime-targets'
import { listProjectLocations } from './store'
import { projectReplicaRuntimeUnavailableReason, type ProjectLocationReplica } from './model'

export type ProjectRuntimeIdentity =
  | { kind: 'execution-location'; locationId: string }
  | { kind: 'linked-computer'; deviceId: string }

export interface RequireProjectRuntimeReplicaInput {
  projectId: string
  orgId: string
  workspaceId: string
  actorUserId: string
  runtime: ProjectRuntimeIdentity
}

interface RequireProjectRuntimeReplicaOptions {
  listLocations?: typeof listProjectLocations
}

/**
 * Project sessions may execute only on a location explicitly linked to that
 * project. Workspace-level device access alone is intentionally insufficient.
 */
export async function requireProjectRuntimeReplica(
  input: RequireProjectRuntimeReplicaInput,
  options: RequireProjectRuntimeReplicaOptions = {},
): Promise<ProjectLocationReplica> {
  const locationId = input.runtime.kind === 'execution-location'
    ? input.runtime.locationId
    : linkedDeviceProjectLocationId(input.runtime.deviceId)
  const replicas = await (options.listLocations ?? listProjectLocations)(
    input.projectId,
    input.orgId,
    input.actorUserId,
  )
  const replica = replicas.find((candidate) => candidate.active
    && candidate.workspaceId === input.workspaceId
    && candidate.locationId === locationId)
  if (!replica) throw new Error('Project is not linked to this computer')
  const unavailableReason = projectReplicaRuntimeUnavailableReason(replica)
  if (unavailableReason === 'computer_offline') throw new Error('Computer unavailable')
  if (unavailableReason === 'project_sync_pending') {
    throw new Error('Project files are not ready on this computer')
  }
  return replica
}
