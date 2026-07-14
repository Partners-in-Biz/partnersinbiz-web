import {
  canAccessExecutionLocation,
  executionLocationPresence,
} from '@/lib/project-locations/access'
import type { ProjectExecutionLocation } from '@/lib/project-locations/model'

function location(overrides: Partial<ProjectExecutionLocation> = {}): ProjectExecutionLocation {
  return {
    locationId: 'partners-vps',
    label: 'Partners VPS',
    kind: 'vps',
    platform: 'linux',
    runtimeTargetId: 'vps',
    transportIdentity: 'transport-vps',
    owner: { type: 'organization', orgId: 'pib-platform-owner' },
    visibility: 'organization',
    allowedOrgIds: ['pib-platform-owner'],
    status: 'active',
    availability: 'online',
    verificationStatus: 'verified',
    mappings: [{ mappingId: 'partners-vps-workspace', orgId: 'pib-platform-owner', workspaceId: 'partners', status: 'active' }],
    legacyCompatibilityTargetId: 'vps',
    createdAt: 'now',
    updatedAt: 'now',
    ...overrides,
  }
}

describe('project execution location access', () => {
  it('allows every active member to use an organisation-visible VPS in its mapped organisation', () => {
    expect(canAccessExecutionLocation({
      location: location(),
      userId: 'member-1',
      orgId: 'pib-platform-owner',
      workspaceId: 'partners',
      membership: { active: true, role: 'member' },
    })).toBe(true)
  })

  it('allows a private computer only for its user owner', () => {
    const mac = location({
      locationId: 'peets-mac-mini',
      label: "Peet's Mac",
      kind: 'computer',
      platform: 'macos',
      runtimeTargetId: 'local',
      owner: { type: 'user', userId: 'peet' },
      visibility: 'private',
      legacyCompatibilityTargetId: 'local',
      mappings: [{ mappingId: 'mac-partners', orgId: 'pib-platform-owner', workspaceId: 'partners', status: 'active' }],
    })
    expect(canAccessExecutionLocation({
      location: mac, userId: 'peet', orgId: 'pib-platform-owner', workspaceId: 'partners',
      membership: { active: true, role: 'owner' },
    })).toBe(true)
    expect(canAccessExecutionLocation({
      location: mac, userId: 'member-1', orgId: 'pib-platform-owner', workspaceId: 'partners',
      membership: { active: true, role: 'member' },
    })).toBe(false)
  })

  it('denies cross-org, inactive membership, and missing Workspace mappings', () => {
    expect(canAccessExecutionLocation({
      location: location(), userId: 'member-1', orgId: 'other-org', workspaceId: 'partners',
      membership: { active: true, role: 'member' },
    })).toBe(false)
    expect(canAccessExecutionLocation({
      location: location(), userId: 'member-1', orgId: 'pib-platform-owner', workspaceId: 'partners',
      membership: { active: false, role: 'member' },
    })).toBe(false)
    expect(canAccessExecutionLocation({
      location: location(), userId: 'member-1', orgId: 'pib-platform-owner', workspaceId: 'another-workspace',
      membership: { active: true, role: 'member' },
    })).toBe(false)
  })

  it('keeps an authorised offline computer visible but non-selectable', () => {
    const presence = executionLocationPresence(location({
      locationId: 'peets-mac-mini', label: "Peet's Mac", kind: 'computer', platform: 'macos',
      runtimeTargetId: 'local', availability: 'offline', owner: { type: 'user', userId: 'peet' },
      visibility: 'private', legacyCompatibilityTargetId: 'local',
    }), {
      id: 'local', label: "Peet's Mac", enabled: true, isLocal: true, isFresh: false,
      transportIdentity: 'transport-vps',
      isHealthy: false, selectable: false, lastSeenAt: null, ageSeconds: null, lastHealthStatus: 'offline',
    })
    expect(presence).toEqual(expect.objectContaining({
      id: 'local',
      label: "Peet's Mac",
      selectable: false,
      unavailableReason: 'computer_offline',
      locationId: 'peets-mac-mini',
    }))
  })

  it('keeps an unknown-availability computer non-selectable even when its transport responds', () => {
    const presence = executionLocationPresence(location({ availability: 'unknown' }), {
      id: 'vps', label: 'Partners VPS', enabled: true, isLocal: false, isFresh: true,
      transportIdentity: 'transport-vps',
      isHealthy: true, selectable: true, lastSeenAt: null, ageSeconds: null, lastHealthStatus: 'ok',
    })

    expect(presence).toEqual(expect.objectContaining({
      selectable: false,
      unavailableReason: 'computer_offline',
      isFresh: false,
    }))
  })
})
