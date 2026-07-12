import type { ActiveOrgMembership, LinkedDevice, LinkedDeviceGrant } from './types'

type DeviceAccessView = Pick<LinkedDevice, 'deviceId' | 'ownerUserId' | 'status'>
type GrantAccessView = Pick<LinkedDeviceGrant, 'deviceId' | 'orgId' | 'status' | 'allowedUserIds'>

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
  if (input.device.ownerUserId !== input.actorUserId && !input.grant.allowedUserIds.includes(input.actorUserId)) {
    throw new Error('linked computers: device is not owned or explicitly shared')
  }
}
