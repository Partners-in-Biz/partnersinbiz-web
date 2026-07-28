import {
  assertCanCreateAgentOnDevice,
  buildScopedAgentId,
  canPullAgentToDevice,
  canStartLinkedAgent,
  runtimeSupportsCustomAgentProfiles,
} from '@/lib/agents/org-agent-policy'

describe('organisation agent creation policy', () => {
  it('derives a tenant-qualified runtime id from a tenant-local handle', () => {
    expect(buildScopedAgentId('org-a', 'research-agent')).toMatch(/^oa-[a-f0-9]{16}-research-agent$/)
    expect(buildScopedAgentId('org-a', 'research-agent')).not.toBe(
      buildScopedAgentId('org-b', 'research-agent'),
    )
  })

  it('requires the signed custom-profile runtime generation', () => {
    expect(runtimeSupportsCustomAgentProfiles('1.1.10')).toBe(false)
    expect(runtimeSupportsCustomAgentProfiles('1.1.11')).toBe(true)
    expect(runtimeSupportsCustomAgentProfiles('1.2.0')).toBe(true)
    expect(runtimeSupportsCustomAgentProfiles('invalid')).toBe(false)
  })

  it('lets a member create an agent on their own computer', () => {
    expect(assertCanCreateAgentOnDevice({
      actorUserId: 'member-a',
      orgId: 'org-a',
      role: 'member',
      device: { ownerType: 'user', ownerUserId: 'member-a', status: 'active' },
    })).toBe('personal')
  })

  it('rejects another persons computer', () => {
    expect(() => assertCanCreateAgentOnDevice({
      actorUserId: 'member-a',
      orgId: 'org-a',
      role: 'member',
      device: { ownerType: 'user', ownerUserId: 'member-b', status: 'active' },
    })).toThrow('computers they own')
  })

  it('lets admins create on their organisation VPS but rejects members', () => {
    const device = { ownerType: 'organization' as const, ownerOrgId: 'org-a', status: 'active' as const }
    expect(assertCanCreateAgentOnDevice({
      actorUserId: 'admin-a', orgId: 'org-a', role: 'admin', device,
    })).toBe('organization')
    expect(() => assertCanCreateAgentOnDevice({
      actorUserId: 'member-a', orgId: 'org-a', role: 'member', device,
    })).toThrow('owners and admins')
  })

  it('rejects inactive and cross-tenant VPS devices', () => {
    expect(() => assertCanCreateAgentOnDevice({
      actorUserId: 'admin-a',
      orgId: 'org-a',
      role: 'owner',
      device: { ownerType: 'organization', ownerOrgId: 'org-a', status: 'paused' },
    })).toThrow('active computer')
    expect(() => assertCanCreateAgentOnDevice({
      actorUserId: 'admin-a',
      orgId: 'org-a',
      role: 'owner',
      device: { ownerType: 'organization', ownerOrgId: 'org-b', status: 'active' },
    })).toThrow('another organisation')
  })
})

describe('organisation agent pull policy', () => {
  const base = { actorUserId: 'member-a', orgId: 'org-a', orgManager: false, explicitlyGranted: false }

  it('allows owners and explicit destination-runtime grants', () => {
    expect(canPullAgentToDevice({
      ...base,
      agent: { agentId: 'private-a', scopeOrgId: 'org-a', ownerUserId: 'member-a', accessScope: 'personal' },
    })).toBe(true)
    expect(canPullAgentToDevice({
      ...base,
      explicitlyGranted: true,
      agent: { agentId: 'org-research', scopeOrgId: 'org-a', accessScope: 'organization' },
    })).toBe(true)
  })

  it('denies ungranted members and cross-tenant custom agents', () => {
    expect(canPullAgentToDevice({
      ...base,
      agent: { agentId: 'org-research', scopeOrgId: 'org-a', accessScope: 'organization' },
    })).toBe(false)
    expect(canPullAgentToDevice({
      ...base,
      explicitlyGranted: true,
      agent: { agentId: 'other-org', scopeOrgId: 'org-b', accessScope: 'organization' },
    })).toBe(false)
  })

  it('does not let an organisation admin copy a members personal agent', () => {
    expect(canPullAgentToDevice({
      ...base,
      orgManager: true,
      agent: { agentId: 'member-private', scopeOrgId: 'org-a', ownerUserId: 'member-b', accessScope: 'personal' },
    })).toBe(false)
  })
})

describe('linked agent conversation policy', () => {
  it('keeps personal agents owner-only even for platform administrators', () => {
    expect(canStartLinkedAgent({
      accessScope: 'personal',
      ownerUserId: 'member-a',
      actorUserId: 'platform-admin',
      callerRole: 'admin',
      selectedDeviceOwnerUserId: 'member-a',
      explicitlyGranted: false,
    })).toBe(false)
    expect(canStartLinkedAgent({
      accessScope: 'personal',
      ownerUserId: 'member-a',
      actorUserId: 'member-a',
      callerRole: 'client',
      selectedDeviceOwnerUserId: 'member-a',
      explicitlyGranted: false,
    })).toBe(true)
  })

  it('allows shared organisation agents only for admins or explicitly granted members', () => {
    expect(canStartLinkedAgent({
      accessScope: 'organization',
      actorUserId: 'admin-a',
      callerRole: 'admin',
      explicitlyGranted: false,
    })).toBe(true)
    expect(canStartLinkedAgent({
      accessScope: 'organization',
      actorUserId: 'member-a',
      callerRole: 'client',
      explicitlyGranted: true,
    })).toBe(true)
    expect(canStartLinkedAgent({
      accessScope: 'organization',
      actorUserId: 'member-a',
      callerRole: 'client',
      explicitlyGranted: false,
    })).toBe(false)
  })
})
