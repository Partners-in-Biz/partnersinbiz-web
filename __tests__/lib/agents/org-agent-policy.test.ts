import {
  assertCanCreateAgentOnDevice,
  buildScopedAgentId,
  canManageLinkedAgent,
  canPullAgentToDevice,
  canStartLinkedAgent,
  linkedAgentProfileRevision,
  parseLinkedAgentUpdateFields,
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

describe('linked agent manage + update fields', () => {
  it('lets a member manage only their own personal agent', () => {
    expect(canManageLinkedAgent({
      actorUserId: 'member-a',
      orgId: 'org-a',
      role: 'member',
      agent: {
        provisioningMode: 'linked_device',
        scopeOrgId: 'org-a',
        accessScope: 'personal',
        ownerUserId: 'member-a',
      },
    })).toBe(true)
    expect(canManageLinkedAgent({
      actorUserId: 'member-a',
      orgId: 'org-a',
      role: 'member',
      agent: {
        provisioningMode: 'linked_device',
        scopeOrgId: 'org-a',
        accessScope: 'personal',
        ownerUserId: 'member-b',
      },
    })).toBe(false)
  })

  it('does not let org admins edit another members personal agent', () => {
    expect(canManageLinkedAgent({
      actorUserId: 'admin-a',
      orgId: 'org-a',
      role: 'admin',
      agent: {
        provisioningMode: 'linked_device',
        scopeOrgId: 'org-a',
        accessScope: 'personal',
        ownerUserId: 'member-a',
      },
    })).toBe(false)
  })

  it('lets org admins manage organisation agents but not ordinary members', () => {
    const orgAgent = {
      provisioningMode: 'linked_device' as const,
      scopeOrgId: 'org-a',
      accessScope: 'organization' as const,
    }
    expect(canManageLinkedAgent({
      actorUserId: 'admin-a', orgId: 'org-a', role: 'admin', agent: orgAgent,
    })).toBe(true)
    expect(canManageLinkedAgent({
      actorUserId: 'member-a', orgId: 'org-a', role: 'member', agent: orgAgent,
    })).toBe(false)
  })

  it('never allows field-edit of marketplace template instances', () => {
    expect(canManageLinkedAgent({
      actorUserId: 'member-a',
      orgId: 'org-a',
      role: 'member',
      agent: {
        provisioningMode: 'linked_device',
        scopeOrgId: 'org-a',
        accessScope: 'personal',
        ownerUserId: 'member-a',
        agentKind: 'marketplace',
        marketplaceTemplateId: 'pip',
      },
    })).toBe(false)
    expect(canManageLinkedAgent({
      actorUserId: 'admin-a',
      orgId: 'org-a',
      role: 'owner',
      agent: {
        provisioningMode: 'linked_device',
        scopeOrgId: 'org-a',
        accessScope: 'organization',
        agentKind: 'marketplace',
        marketplaceTemplateId: 'theo',
      },
    })).toBe(false)
  })

  it('allows members to pull org-scoped marketplace agents', () => {
    expect(canPullAgentToDevice({
      actorUserId: 'member-a',
      orgId: 'org-a',
      orgManager: false,
      explicitlyGranted: false,
      agent: {
        agentId: 'mp-pip-aaaaaaaaaaaa',
        scopeOrgId: 'org-a',
        accessScope: 'organization',
        agentKind: 'marketplace',
        marketplaceTemplateId: 'pip',
      },
    })).toBe(true)
  })

  it('parses linked agent update fields and computes a stable profile revision', () => {
    const current = {
      name: 'Research',
      role: 'Specialist',
      persona: 'Helps with research',
      defaultModel: 'auto',
      iconKey: 'smart_toy',
      colorKey: 'sky',
    }
    const parsed = parseLinkedAgentUpdateFields({
      name: 'Research v2',
      persona: 'Deeper research',
    }, current)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.changed).toBe(true)
    expect(parsed.fields).toMatchObject({
      name: 'Research v2',
      role: 'Specialist',
      persona: 'Deeper research',
      defaultModel: 'auto',
    })
    expect(linkedAgentProfileRevision(parsed.fields)).toHaveLength(16)
    expect(linkedAgentProfileRevision(parsed.fields)).toBe(linkedAgentProfileRevision(parsed.fields))

    const invalid = parseLinkedAgentUpdateFields({ name: '' }, current)
    expect(invalid.ok).toBe(false)
  })
})
