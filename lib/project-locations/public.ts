import {
  projectReplicaRuntimeUnavailableReason,
  type ProjectLocationReplica,
  type ProjectReplicaRuntimeUnavailableReason,
} from './model'

export interface PublicProjectLocationReplica {
  replicaId: string
  locationId: string
  label: string
  kind: ProjectLocationReplica['locationKind']
  platform: ProjectLocationReplica['locationPlatform']
  workspaceId: string
  availability: ProjectLocationReplica['availability']
  syncStatus: ProjectLocationReplica['syncStatus']
  visibility: ProjectLocationReplica['locationVisibility']
  canonical: boolean
  selectable: boolean
  authenticatedRuntime: boolean
  unavailableReason?: ProjectReplicaRuntimeUnavailableReason
}

/** Browser-safe project location view: no paths, mappings, owners, or sync diagnostics. */
export function publicProjectLocationReplica(replica: ProjectLocationReplica): PublicProjectLocationReplica {
  const unavailableReason = projectReplicaRuntimeUnavailableReason(replica)
  return {
    replicaId: replica.replicaId,
    locationId: replica.locationId,
    label: replica.locationLabel,
    kind: replica.locationKind,
    platform: replica.locationPlatform,
    workspaceId: replica.workspaceId,
    availability: replica.availability,
    syncStatus: replica.syncStatus,
    visibility: replica.locationVisibility,
    canonical: replica.isCanonical === true,
    selectable: !unavailableReason,
    authenticatedRuntime: replica.locationId.startsWith('linked-device:'),
    ...(unavailableReason ? { unavailableReason } : {}),
  }
}
