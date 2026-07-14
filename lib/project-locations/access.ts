import type { PublicRuntimeTargetPresence } from '@/lib/agents/runtime-targets'
import type { ProjectExecutionLocation } from './model'

export type ExecutionLocationUnavailableReason =
  | 'location_inactive'
  | 'location_unverified'
  | 'computer_offline'
  | 'transport_unavailable'

export interface ExecutionLocationMembership {
  active: boolean
  role?: string
}

export type PublicExecutionLocationPresence = PublicRuntimeTargetPresence & {
  locationId: string
  kind: ProjectExecutionLocation['kind']
  platform: ProjectExecutionLocation['platform']
  ownerType: ProjectExecutionLocation['owner']['type']
  visibility: ProjectExecutionLocation['visibility']
  unavailableReason?: ExecutionLocationUnavailableReason
}

export type BoundRuntimeTargetPresence = PublicRuntimeTargetPresence & {
  transportIdentity?: string
}

export function canAccessExecutionLocation(input: {
  location: ProjectExecutionLocation
  userId: string
  orgId: string
  workspaceId: string
  membership: ExecutionLocationMembership
}): boolean {
  const { location } = input
  if (!input.membership.active || location.status !== 'active' || location.verificationStatus !== 'verified') return false
  if (!location.allowedOrgIds.includes(input.orgId)) return false
  if (!location.mappings.some((mapping) => (
    mapping.orgId === input.orgId
    && mapping.workspaceId === input.workspaceId
    && mapping.status === 'active'
  ))) return false

  if (location.visibility === 'organization') return true
  if (location.owner.type === 'user') return location.owner.userId === input.userId
  return location.owner.orgId === input.orgId && ['owner', 'admin'].includes(input.membership.role ?? '')
}

export function executionLocationPresence(
  location: ProjectExecutionLocation,
  transport?: BoundRuntimeTargetPresence,
): PublicExecutionLocationPresence {
  let unavailableReason: ExecutionLocationUnavailableReason | undefined
  if (location.status !== 'active') unavailableReason = 'location_inactive'
  else if (location.verificationStatus !== 'verified') unavailableReason = 'location_unverified'
  else if (location.availability !== 'online') unavailableReason = 'computer_offline'
  else if (!location.transportIdentity || !transport?.transportIdentity
    || location.transportIdentity !== transport.transportIdentity) unavailableReason = 'transport_unavailable'
  else if (!transport?.selectable) unavailableReason = transport && (!transport.isFresh || !transport.isHealthy)
    ? 'computer_offline'
    : 'transport_unavailable'

  return {
    id: location.runtimeTargetId,
    label: location.label,
    ...(transport?.hostId ? { hostId: transport.hostId } : {}),
    enabled: location.status === 'active' && (transport?.enabled ?? false),
    isLocal: location.kind === 'computer',
    isFresh: location.availability === 'online' && (transport?.isFresh ?? false),
    isHealthy: location.availability === 'online' && (transport?.isHealthy ?? false),
    selectable: !unavailableReason,
    lastSeenAt: transport?.lastSeenAt ?? null,
    ageSeconds: transport?.ageSeconds ?? null,
    lastHealthStatus: transport?.lastHealthStatus ?? (location.availability === 'online' ? null : 'offline'),
    locationId: location.locationId,
    kind: location.kind,
    platform: location.platform,
    ownerType: location.owner.type,
    visibility: location.visibility,
    ...(unavailableReason ? { unavailableReason } : {}),
  }
}
