export type LinkedDeviceStatus = 'active' | 'paused' | 'revoked' | 'removed'
export type LinkedDevicePlatform = 'macos' | 'windows' | 'linux'
export type LinkedDeviceArchitecture = 'arm64' | 'x64'
export type LinkedDeviceCapability = 'workspace.execute' | 'workspace.sync'
export type LinkedDeviceKind = 'computer' | 'vps'
export type LinkedDeviceOwnerType = 'user' | 'organization'
export type LinkedDeviceHealthReason =
  | 'hermes_unavailable'
  | 'hermes_binary_missing'
  | 'no_agents_available'
  | 'hermes_update_failed'
export type DeviceGrantStatus = 'active' | 'paused' | 'revoked'
export type DeviceGrantAccessMode = 'owner' | 'organization' | 'selected_users' | 'teams'
export type WorkspaceMappingStatus = 'pending' | 'active' | 'stale' | 'missing' | 'paused' | 'removed'

/** Runtime-v2 heartbeat inventory of Hermes profiles on a linked computer. */
export interface LinkedAvailableProfile {
  profile: string
  orgId: string | null
  agentId: string
  healthy: boolean
  skillsDigest: string | null
  /** Runtime-computed projectionHash of ui_meta + rooms. Absent on runtimes without the projector. */
  projectionHash?: string | null
  /** Observed profile/room meta when hashes differ. Capped at 8 KB on ingest. */
  observedMeta?: Record<string, unknown> | null
}

export interface LinkedDevice {
  deviceId: string
  /** Explicit legacy execution location replaced when this native runtime was adopted. */
  adoptedFromLocationId?: string
  /** Missing on legacy rows, which are ordinary computers. */
  deviceKind?: LinkedDeviceKind
  /** Missing on legacy rows, which are treated as user-owned when ownerUserId exists. */
  ownerType?: LinkedDeviceOwnerType
  ownerUserId?: string
  ownerOrgId?: string
  /** Missing only on legacy rows created before explicit ownership metadata. */
  createdByUserId?: string
  runtimeTargetId: string
  publicKeyFingerprint: string
  label: string
  platform: LinkedDevicePlatform
  architecture: LinkedDeviceArchitecture
  runtimeVersion: string
  /** Healthy Hermes profiles currently reachable over loopback on this device. */
  availableAgentIds?: string[]
  /** Custom profiles that are healthy and have at least one synced LLM provider. */
  credentialReadyAgentIds?: string[]
  /** Managed Hermes profiles reported by runtime v2. Absent on legacy runtimes. */
  availableAgents?: Array<{ orgId: string; agentId: string; profile: string; healthy: boolean }>
  /** Last reported skill-pack digest per Hermes profile name. */
  profileSkillsDigests?: Record<string, string | null>
  hermesVersion?: string
  /** Hermes/runtime pin lane. Missing on legacy rows; treated as stable. */
  releaseChannel?: 'internal' | 'stable'
  healthReason?: LinkedDeviceHealthReason
  capabilities: LinkedDeviceCapability[]
  status: LinkedDeviceStatus
  credentialVersion: number
  createdAt: unknown
  updatedAt: unknown
  lastSeenAt: unknown | null
  pausedAt?: unknown
  revokedAt?: unknown
  removedAt?: unknown
  /** Set when pairing asked to provision agents but the user is not an active org member. */
  provisioningSkippedReason?: string
}

export interface PairingChallenge {
  challengeId: string
  deviceId?: string
  deviceKind?: LinkedDeviceKind
  ownerType?: LinkedDeviceOwnerType
  ownerOrgId?: string
  ownerUserId: string
  /** Explicit legacy project location selected by the actor; never inferred from its label. */
  adoptLocationId?: string
  /** Stable authorization/identity binding revalidated during proof exchange. */
  adoptLocationBinding?: string
  /** Org to provision after exchange. Optional on legacy challenges. */
  orgId?: string
  /** Catalog agent ids to install after pairing. Optional on legacy challenges. */
  agentIds?: string[]
  secretHash: string
  expiresAt: string
  attempts: number
  maxAttempts: number
  createdAt: unknown
  consumedAt?: unknown
  credentialVersion?: number
}

export interface DeviceBrowserIdentity {
  useRealProfile: boolean
  realProfilePin: string | null
  headed: boolean
  autoclose: boolean
  updatedByUserId: string
  updatedAt: unknown
}

export interface LinkedDeviceGrant {
  deviceId: string
  orgId: string
  grantedByUserId: string
  /** Missing on legacy rows; allowedUserIds then retains its historical meaning. */
  accessMode?: DeviceGrantAccessMode
  allowedUserIds: string[]
  allowedTeamIds?: string[]
  capabilities: LinkedDeviceCapability[]
  status: DeviceGrantStatus
  browserIdentity?: DeviceBrowserIdentity
  createdAt: unknown
  updatedAt: unknown
  pausedAt?: unknown
  revokedAt?: unknown
}

export interface LinkedDeviceWorkspaceMapping {
  mappingId: string
  deviceId: string
  orgId: string
  workspaceId: string
  label: string
  status: WorkspaceMappingStatus
  createdAt: unknown
  updatedAt: unknown
  staleAt?: unknown
  removedAt?: unknown
}

export type LinkedComputerAuditAction =
  | 'pairing.created'
  | 'pairing.consumed'
  | 'device.paired'
  | 'device.status_changed'
  | 'grant.changed'
  | 'grant.owner_shared'
  | 'browser.real_profile.enabled'
  | 'browser.real_profile.disabled'
  | 'mapping.changed'
  | 'credential.rotated'
  | 'credential.revoked'

export interface LinkedComputerAuditEvent {
  eventId: string
  action: LinkedComputerAuditAction
  actorUserId: string
  deviceId?: string
  orgId?: string
  mappingId?: string
  challengeId?: string
  fromStatus?: string
  toStatus?: string
  createdAt: unknown
}

export interface ActiveOrgMembership {
  orgId: string
  userId: string
  active: boolean
  role?: string
  teamIds?: string[]
}
