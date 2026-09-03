import type { ActiveOrgMembership, DeviceGrantAccessMode, LinkedDevice, LinkedDeviceGrant } from './types'
import { isActiveOrgMembershipRow } from '@/lib/orgMembers/active-membership'

export { isActiveOrgMembershipRow }

type DeviceAccessView = Pick<LinkedDevice, 'deviceId' | 'ownerType' | 'ownerUserId' | 'ownerOrgId' | 'createdByUserId' | 'status'>
type GrantAccessView = Pick<LinkedDeviceGrant, 'deviceId' | 'orgId' | 'status' | 'accessMode' | 'allowedUserIds' | 'allowedTeamIds'>

export function linkedDeviceOwnerType(device: Pick<LinkedDevice, 'ownerType' | 'ownerUserId' | 'ownerOrgId'>): 'user' | 'organization' {
  if (device.ownerType === 'organization' && device.ownerOrgId) return 'organization'
  if ((device.ownerType === 'user' || device.ownerType == null) && device.ownerUserId) return 'user'
  throw new Error('linked computers: invalid device ownership')
}

export function linkedDeviceActorUserId(device: Pick<LinkedDevice, 'ownerType' | 'ownerUserId' | 'ownerOrgId' | 'createdByUserId'>): string {
  return linkedDeviceOwnerType(device) === 'user' ? String(device.ownerUserId) : String(device.createdByUserId ?? '')
}

export function effectiveGrantAccessMode(grant: Pick<LinkedDeviceGrant, 'accessMode' | 'allowedUserIds' | 'allowedTeamIds'>): DeviceGrantAccessMode {
  if (grant.accessMode === 'owner' || grant.accessMode === 'organization' || grant.accessMode === 'selected_users' || grant.accessMode === 'teams') return grant.accessMode
  return Array.isArray(grant.allowedUserIds) && grant.allowedUserIds.length > 0 ? 'selected_users' : 'owner'
}

export function assertActiveMembership(membership: ActiveOrgMembership, orgId: string, userId: string): void {
  if (!membership.active || membership.orgId !== orgId || membership.userId !== userId) {
    throw new Error('linked computers: active membership required')
  }
}

export function assertGrantAdministrator(membership: ActiveOrgMembership, orgId: string, userId: string): void {
  assertActiveMembership(membership, orgId, userId)
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    throw new Error('linked computers: organisation administrator required')
  }
}

export function assertDeviceManager(input: {
  actorUserId: string
  device: Pick<LinkedDevice, 'ownerType' | 'ownerUserId' | 'ownerOrgId'>
  ownerOrgMembership?: ActiveOrgMembership
}): void {
  if (linkedDeviceOwnerType(input.device) === 'user') {
    if (input.device.ownerUserId !== input.actorUserId) throw new Error('linked computers: device owner required')
    return
  }
  const orgId = String(input.device.ownerOrgId)
  assertGrantAdministrator(input.ownerOrgMembership ?? { orgId, userId: input.actorUserId, active: false }, orgId, input.actorUserId)
}

export function assertDeviceOrgAccess(input: {
  actorUserId: string
  orgId: string
  device: DeviceAccessView
  grant: GrantAccessView
  membership: ActiveOrgMembership
}): void {
  assertActiveMembership(input.membership, input.orgId, input.actorUserId)
  if (input.grant.orgId !== input.orgId || input.grant.deviceId !== input.device.deviceId) {
    throw new Error('linked computers: tenant scope mismatch')
  }
  if (input.device.status !== 'active' || input.grant.status !== 'active') {
    throw new Error('linked computers: device grant is not active')
  }
  const ownerType = linkedDeviceOwnerType(input.device)
  const personallyOwned = ownerType === 'user' && input.device.ownerUserId === input.actorUserId
  const organizationManager = ownerType === 'organization'
    && input.device.ownerOrgId === input.orgId
    && (input.membership.role === 'owner' || input.membership.role === 'admin')
  const accessMode = effectiveGrantAccessMode(input.grant)
  const teamIds = input.membership.teamIds ?? []
  const allowedTeamIds = input.grant.allowedTeamIds ?? []
  const teamMatch = accessMode === 'teams' && (
    input.grant.allowedUserIds.includes(input.actorUserId)
    || teamIds.some((id) => allowedTeamIds.includes(id))
  )
  const permitted = personallyOwned || organizationManager || accessMode === 'organization'
    || (accessMode === 'selected_users' && input.grant.allowedUserIds.includes(input.actorUserId))
    || teamMatch
  if (!permitted) {
    throw new Error('linked computers: device is not owned or explicitly shared')
  }
}
