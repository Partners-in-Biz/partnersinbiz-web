import { assertDeviceOrgAccess } from '@/lib/linked-computers/policy'

const device = {
  deviceId: 'device-a',
  ownerType: 'user' as const,
  ownerUserId: 'owner-a',
  status: 'active' as const,
}

describe('assertDeviceOrgAccess teams grants', () => {
  it('permits a team member on a teams grant', () => {
    expect(() => assertDeviceOrgAccess({
      actorUserId: 'member-a',
      orgId: 'org-a',
      device,
      grant: {
        deviceId: 'device-a',
        orgId: 'org-a',
        status: 'active',
        accessMode: 'teams',
        allowedUserIds: [],
        allowedTeamIds: ['org-a_sales'],
      },
      membership: { orgId: 'org-a', userId: 'member-a', active: true, teamIds: ['org-a_sales'] },
    })).not.toThrow()
  })

  it('denies a non-member on a teams grant', () => {
    expect(() => assertDeviceOrgAccess({
      actorUserId: 'member-b',
      orgId: 'org-a',
      device,
      grant: {
        deviceId: 'device-a',
        orgId: 'org-a',
        status: 'active',
        accessMode: 'teams',
        allowedUserIds: [],
        allowedTeamIds: ['org-a_sales'],
      },
      membership: { orgId: 'org-a', userId: 'member-b', active: true, teamIds: ['org-a_ops'] },
    })).toThrow('not owned or explicitly shared')
  })

  it('permits an individually listed user on a teams grant', () => {
    expect(() => assertDeviceOrgAccess({
      actorUserId: 'listed-a',
      orgId: 'org-a',
      device,
      grant: {
        deviceId: 'device-a',
        orgId: 'org-a',
        status: 'active',
        accessMode: 'teams',
        allowedUserIds: ['listed-a'],
        allowedTeamIds: ['org-a_sales'],
      },
      membership: { orgId: 'org-a', userId: 'listed-a', active: true, teamIds: [] },
    })).not.toThrow()
  })

  it('still permits organization mode', () => {
    expect(() => assertDeviceOrgAccess({
      actorUserId: 'member-a',
      orgId: 'org-a',
      device,
      grant: {
        deviceId: 'device-a',
        orgId: 'org-a',
        status: 'active',
        accessMode: 'organization',
        allowedUserIds: [],
      },
      membership: { orgId: 'org-a', userId: 'member-a', active: true },
    })).not.toThrow()
  })

  it('still permits selected_users', () => {
    expect(() => assertDeviceOrgAccess({
      actorUserId: 'listed-a',
      orgId: 'org-a',
      device,
      grant: {
        deviceId: 'device-a',
        orgId: 'org-a',
        status: 'active',
        accessMode: 'selected_users',
        allowedUserIds: ['listed-a'],
      },
      membership: { orgId: 'org-a', userId: 'listed-a', active: true },
    })).not.toThrow()
  })
})
