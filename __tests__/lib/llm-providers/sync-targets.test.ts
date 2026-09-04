/**
 * @jest-environment node
 */

const store = new Map<string, Record<string, unknown>>()

const mockGetHermesProfileLink = jest.fn()

jest.mock('@/lib/hermes/server', () => ({
  getHermesProfileLink: (...args: unknown[]) => mockGetHermesProfileLink(...args),
}))

function matches(row: Record<string, unknown>, field: string, op: string, value: unknown): boolean {
  if (op === '==') return row[field] === value
  if (op === 'in') return Array.isArray(value) && value.includes(row[field])
  return true
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      const query = (filters: Array<[string, string, unknown]> = []) => ({
        where: (field: string, op: string, value: unknown) => query([...filters, [field, op, value]]),
        get: async () => ({
          docs: [...store.entries()]
            .filter(([key, row]) => key.startsWith(`${name}/`) && filters.every(([field, op, value]) => matches(row, field, op, value)))
            .map(([key, row]) => ({
              id: key.slice(name.length + 1),
              data: () => row,
            })),
        }),
      })
      return {
        ...query(),
        doc: (id: string) => {
          const key = `${name}/${id}`
          return {
            id,
            get: async () => {
              const data = store.get(key)
              return { exists: Boolean(data), id, data: () => data }
            },
          }
        },
      }
    },
  },
}))

import {
  orgShareAllowsDevice,
  resolveOrgLlmSyncTargets,
  resolveOrgShareLinkedComputerTargets,
} from '@/lib/llm-providers/sync-targets'
import type { LinkedDevice } from '@/lib/linked-computers/types'

function seed(path: string, data: Record<string, unknown>) {
  store.set(path, data)
}

function vpsDevice(id: string, availableAgentIds: string[]) {
  seed(`linked_devices/${id}`, {
    deviceKind: 'vps',
    ownerType: 'organization',
    ownerOrgId: 'org-1',
    runtimeTargetId: `linked-device:${id}`,
    status: 'active',
    label: 'Shared VPS',
    availableAgentIds,
  })
}

function memberPolicy(runtimeTargetId: string, agentIds: string[]) {
  return {
    preset: 'custom',
    modules: {},
    recordScopes: {},
    agentRuntimeAccess: { [runtimeTargetId]: agentIds },
  }
}

function seedActiveMember(uid: string, runtimeTargetId: string, agentIds: string[] = ['pip']) {
  seed(`orgMembers/org-1_${uid}`, {
    orgId: 'org-1',
    uid,
    userId: uid,
    role: 'member',
    status: 'active',
    accessPolicy: memberPolicy(runtimeTargetId, agentIds),
  })
}

describe('organisation LLM sync targets', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    store.clear()
    mockGetHermesProfileLink.mockResolvedValue({
      enabled: true,
      baseUrl: 'https://vps.example',
      apiKey: 'secret',
      profile: 'pip',
    })
  })

  it('uses the linked VPS target instead of duplicating its legacy profile link', async () => {
    vpsDevice('vps-1', ['pip', 'theo'])

    const result = await resolveOrgLlmSyncTargets('org-1')

    expect(result.targets.map((target) => [target.kind, target.agentId])).toEqual([
      ['org_linked_vps', 'pip'],
      ['org_linked_vps', 'theo'],
    ])
  })

  it('retains a legacy profile link when no linked VPS covers that profile', async () => {
    vpsDevice('vps-1', ['theo'])

    const result = await resolveOrgLlmSyncTargets('org-1')

    expect(result.targets.map((target) => [target.kind, target.agentId])).toEqual([
      ['org_hermes_link', 'pip'],
      ['org_linked_vps', 'theo'],
    ])
  })
})

describe('organisation share linked-computer targets', () => {
  beforeEach(() => {
    store.clear()
  })

  it('admins mode resolves no member machines', async () => {
    seedActiveMember('u1', 'linked-device:mac-1')
    seed('linked_devices/mac-1', {
      ownerType: 'user',
      ownerUserId: 'u1',
      status: 'active',
      label: 'Pat Mac',
      runtimeTargetId: 'linked-device:mac-1',
      availableAgents: [{ orgId: 'org-1', agentId: 'pip', profile: 'acme--pip', healthy: true }],
    })
    seed('linked_device_grants/org-1_mac-1', { status: 'active', orgId: 'org-1', deviceId: 'mac-1' })

    const result = await resolveOrgShareLinkedComputerTargets({
      connection: { orgId: 'org-1', shareTargets: { mode: 'admins', teamIds: [], userIds: [], agentIds: [], requireActiveDeviceGrant: true } },
    })

    expect(result).toEqual({ targets: [], memberCount: 0 })
  })

  it('teams mode resolves only team members\' user-owned devices with active grants', async () => {
    seed('org_teams/team-sales', {
      orgId: 'org-1',
      status: 'active',
      memberUserIds: ['u-team'],
    })
    seedActiveMember('u-team', 'linked-device:mac-team')
    seedActiveMember('u-other', 'linked-device:mac-other')

    seed('linked_devices/mac-team', {
      ownerType: 'user',
      ownerUserId: 'u-team',
      status: 'active',
      label: 'Team Mac',
      runtimeTargetId: 'linked-device:mac-team',
      availableAgents: [{ orgId: 'org-1', agentId: 'pip', profile: 'acme--pip', healthy: true }],
    })
    seed('linked_devices/mac-other', {
      ownerType: 'user',
      ownerUserId: 'u-other',
      status: 'active',
      label: 'Other Mac',
      runtimeTargetId: 'linked-device:mac-other',
      availableAgents: [{ orgId: 'org-1', agentId: 'pip', profile: 'acme--pip', healthy: true }],
    })
    seed('linked_device_grants/org-1_mac-team', { status: 'active', orgId: 'org-1', deviceId: 'mac-team' })
    seed('linked_device_grants/org-1_mac-other', { status: 'active', orgId: 'org-1', deviceId: 'mac-other' })

    const result = await resolveOrgShareLinkedComputerTargets({
      connection: {
        orgId: 'org-1',
        shareTargets: {
          mode: 'teams',
          teamIds: ['team-sales'],
          userIds: [],
          agentIds: [],
          requireActiveDeviceGrant: true,
        },
      },
    })

    expect(result.memberCount).toBe(1)
    expect(result.targets).toEqual([expect.objectContaining({
      kind: 'member_linked_computer',
      agentId: 'acme--pip',
      deviceId: 'mac-team',
      memberUserId: 'u-team',
      runtimeTargetId: 'linked-device:mac-team',
      label: 'Team Mac · acme--pip',
    })])
  })

  it('ignores availableAgents of another org', async () => {
    seedActiveMember('u1', 'linked-device:mac-1')
    seed('linked_devices/mac-1', {
      ownerType: 'user',
      ownerUserId: 'u1',
      status: 'active',
      label: 'Pat Mac',
      runtimeTargetId: 'linked-device:mac-1',
      availableAgentIds: ['pip'],
      availableAgents: [
        { orgId: 'other-org', agentId: 'pip', profile: 'other--pip', healthy: true },
        { orgId: 'org-1', agentId: 'pip', profile: 'acme--pip', healthy: true },
      ],
    })
    seed('linked_device_grants/org-1_mac-1', { status: 'active', orgId: 'org-1', deviceId: 'mac-1' })

    const result = await resolveOrgShareLinkedComputerTargets({
      connection: {
        orgId: 'org-1',
        shareTargets: {
          mode: 'organization',
          teamIds: [],
          userIds: [],
          agentIds: [],
          requireActiveDeviceGrant: true,
        },
      },
    })

    expect(result.targets.map((target) => target.agentId)).toEqual(['acme--pip'])
  })

  it('ignores paused grants', async () => {
    seedActiveMember('u1', 'linked-device:mac-1')
    seed('linked_devices/mac-1', {
      ownerType: 'user',
      ownerUserId: 'u1',
      status: 'active',
      label: 'Pat Mac',
      runtimeTargetId: 'linked-device:mac-1',
      availableAgents: [{ orgId: 'org-1', agentId: 'pip', profile: 'acme--pip', healthy: true }],
    })
    seed('linked_device_grants/org-1_mac-1', { status: 'paused', orgId: 'org-1', deviceId: 'mac-1' })

    const result = await resolveOrgShareLinkedComputerTargets({
      connection: {
        orgId: 'org-1',
        shareTargets: {
          mode: 'organization',
          teamIds: [],
          userIds: [],
          agentIds: [],
          requireActiveDeviceGrant: true,
        },
      },
    })

    expect(result.targets).toEqual([])
    expect(result.memberCount).toBe(1)
  })

  it('respects agentIds allowlist', async () => {
    seedActiveMember('u1', 'linked-device:mac-1', ['pip', 'theo'])
    seed('linked_devices/mac-1', {
      ownerType: 'user',
      ownerUserId: 'u1',
      status: 'active',
      label: 'Pat Mac',
      runtimeTargetId: 'linked-device:mac-1',
      availableAgents: [
        { orgId: 'org-1', agentId: 'pip', profile: 'acme--pip', healthy: true },
        { orgId: 'org-1', agentId: 'theo', profile: 'acme--theo', healthy: true },
      ],
    })
    seed('linked_device_grants/org-1_mac-1', { status: 'active', orgId: 'org-1', deviceId: 'mac-1' })

    const result = await resolveOrgShareLinkedComputerTargets({
      connection: {
        orgId: 'org-1',
        shareTargets: {
          mode: 'organization',
          teamIds: [],
          userIds: [],
          agentIds: ['theo'],
          requireActiveDeviceGrant: true,
        },
      },
    })

    expect(result.targets.map((target) => target.agentId)).toEqual(['acme--theo'])
  })

  it('respects memberCanUseAgentOnRuntime', async () => {
    seedActiveMember('u1', 'linked-device:mac-1', ['theo'])
    seed('linked_devices/mac-1', {
      ownerType: 'user',
      ownerUserId: 'u1',
      status: 'active',
      label: 'Pat Mac',
      runtimeTargetId: 'linked-device:mac-1',
      availableAgents: [{ orgId: 'org-1', agentId: 'pip', profile: 'acme--pip', healthy: true }],
    })
    seed('linked_device_grants/org-1_mac-1', { status: 'active', orgId: 'org-1', deviceId: 'mac-1' })

    const result = await resolveOrgShareLinkedComputerTargets({
      connection: {
        orgId: 'org-1',
        shareTargets: {
          mode: 'organization',
          teamIds: [],
          userIds: [],
          agentIds: [],
          requireActiveDeviceGrant: true,
        },
      },
    })

    expect(result.targets).toEqual([])
  })
})

function userOwnedDevice(overrides: Partial<LinkedDevice> = {}): LinkedDevice {
  return {
    deviceId: 'mac-1',
    ownerType: 'user',
    ownerUserId: 'u1',
    runtimeTargetId: 'linked-device:mac-1',
    publicKeyFingerprint: 'fp',
    label: 'Pat Mac',
    platform: 'macos',
    architecture: 'arm64',
    runtimeVersion: '1.1.30',
    capabilities: ['workspace.execute', 'workspace.sync'],
    status: 'active',
    credentialVersion: 1,
    createdAt: null,
    updatedAt: null,
    lastSeenAt: null,
    availableAgents: [{ orgId: 'org-1', agentId: 'pip', profile: 'acme--pip', healthy: true }],
    ...overrides,
  }
}

describe('orgShareAllowsDevice', () => {
  beforeEach(() => {
    store.clear()
  })

  it('allows a member device that is in the organisation share targets', async () => {
    seedActiveMember('u1', 'linked-device:mac-1')
    seed('linked_device_grants/org-1_mac-1', { status: 'active', orgId: 'org-1', deviceId: 'mac-1' })

    await expect(orgShareAllowsDevice({
      connection: {
        orgId: 'org-1',
        shareTargets: {
          mode: 'organization',
          teamIds: [],
          userIds: [],
          agentIds: [],
          requireActiveDeviceGrant: true,
        },
      },
      device: userOwnedDevice(),
      profile: 'acme--pip',
    })).resolves.toBe(true)
  })

  it('denies a device whose owner is not in the share targets', async () => {
    seedActiveMember('u1', 'linked-device:mac-1')
    seedActiveMember('u-other', 'linked-device:mac-other')
    seed('linked_device_grants/org-1_mac-1', { status: 'active', orgId: 'org-1', deviceId: 'mac-1' })

    await expect(orgShareAllowsDevice({
      connection: {
        orgId: 'org-1',
        shareTargets: {
          mode: 'selected_users',
          teamIds: [],
          userIds: ['u-other'],
          agentIds: [],
          requireActiveDeviceGrant: true,
        },
      },
      device: userOwnedDevice(),
      profile: 'acme--pip',
    })).resolves.toBe(false)
  })

  it('denies a device whose grant is paused', async () => {
    seedActiveMember('u1', 'linked-device:mac-1')
    seed('linked_device_grants/org-1_mac-1', { status: 'paused', orgId: 'org-1', deviceId: 'mac-1' })

    await expect(orgShareAllowsDevice({
      connection: {
        orgId: 'org-1',
        shareTargets: {
          mode: 'organization',
          teamIds: [],
          userIds: [],
          agentIds: [],
          requireActiveDeviceGrant: true,
        },
      },
      device: userOwnedDevice(),
      profile: 'acme--pip',
    })).resolves.toBe(false)
  })

  it('teams mode allows a team member device and denies a non-member device', async () => {
    seed('org_teams/team-sales', {
      orgId: 'org-1',
      status: 'active',
      memberUserIds: ['u-team'],
    })
    seedActiveMember('u-team', 'linked-device:mac-team')
    seedActiveMember('u-other', 'linked-device:mac-other')
    seed('linked_device_grants/org-1_mac-team', { status: 'active', orgId: 'org-1', deviceId: 'mac-team' })
    seed('linked_device_grants/org-1_mac-other', { status: 'active', orgId: 'org-1', deviceId: 'mac-other' })

    const connection = {
      orgId: 'org-1',
      shareTargets: {
        mode: 'teams' as const,
        teamIds: ['team-sales'],
        userIds: [],
        agentIds: [],
        requireActiveDeviceGrant: true,
      },
    }

    await expect(orgShareAllowsDevice({
      connection,
      device: userOwnedDevice({
        deviceId: 'mac-team',
        ownerUserId: 'u-team',
        runtimeTargetId: 'linked-device:mac-team',
      }),
      profile: 'acme--pip',
    })).resolves.toBe(true)

    await expect(orgShareAllowsDevice({
      connection,
      device: userOwnedDevice({
        deviceId: 'mac-other',
        ownerUserId: 'u-other',
        runtimeTargetId: 'linked-device:mac-other',
      }),
      profile: 'acme--pip',
    })).resolves.toBe(false)
  })
})
