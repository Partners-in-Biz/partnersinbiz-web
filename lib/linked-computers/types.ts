export type LinkedDeviceStatus = 'active' | 'paused' | 'revoked' | 'removed'
export type LinkedDevicePlatform = 'macos' | 'windows'
export type LinkedDeviceArchitecture = 'arm64' | 'x64'
export type LinkedDeviceCapability = 'workspace.execute'
export type DeviceGrantStatus = 'active' | 'paused' | 'revoked'
export type WorkspaceMappingStatus = 'pending' | 'active' | 'stale' | 'missing' | 'paused' | 'removed'

export interface LinkedDevice {
  deviceId: string
  ownerUserId: string
  runtimeTargetId: string
  publicKeyFingerprint: string
  label: string
  platform: LinkedDevicePlatform
  architecture: LinkedDeviceArchitecture
  runtimeVersion: string
  capabilities: LinkedDeviceCapability[]
  status: LinkedDeviceStatus
  credentialVersion: number
  createdAt: unknown
  updatedAt: unknown
  lastSeenAt: unknown | null
  pausedAt?: unknown
  revokedAt?: unknown
  removedAt?: unknown
}

export interface PairingChallenge {
  challengeId: string
  deviceId: string
  ownerUserId: string
  secretHash: string
  expiresAt: string
  attempts: number
  maxAttempts: number
  createdAt: unknown
  consumedAt?: unknown
}

export interface LinkedDeviceGrant {
  deviceId: string
  orgId: string
  grantedByUserId: string
  allowedUserIds: string[]
  capabilities: LinkedDeviceCapability[]
  status: DeviceGrantStatus
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
}
