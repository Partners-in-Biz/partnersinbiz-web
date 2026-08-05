import {
  ACCESS_PRESET_LABELS,
  DEFAULT_RECORD_SCOPES,
  FULL_ACCESS_POLICY,
  WORKSPACE_MODULE_KEYS,
  accessSummaryForPolicy,
  canAccessModule,
  defaultAccessPolicyFor,
  isFullWorkspaceAccessPolicy,
  memberCanDeleteBillingRecord,
  memberCanPerformModuleAction,
  memberCanUseAgentOnRuntime,
  memberMayUsePersonalLlmOnOrgVps,
  normalizeMemberAccessPolicy,
  presetPolicy,
  recordScopeFor,
  resolveEffectiveMemberPolicy,
  resolveMemberAccessPolicy,
} from '@/lib/orgMembers/access-policy'

describe('org member access policy', () => {
  it('defines every owner-managed workspace module', () => {
    expect(WORKSPACE_MODULE_KEYS).toEqual([
      'crm',
      'projects',
      'documents',
      'marketing',
      'messages',
      'email',
      'reports',
      'research',
      'properties',
      'billing',
      'mobileApps',
      'youtubeStudio',
      'bookStudio',
    ])
  })

  it('derives a CRM sales preset from the legacy crm access scope', () => {
    const policy = defaultAccessPolicyFor('member', 'crm')

    expect(policy.preset).toBe('crm_sales')
    expect(canAccessModule(policy, 'crm')).toBe(true)
    expect(canAccessModule(policy, 'projects')).toBe(false)
    expect(recordScopeFor(policy, 'crm')).toBe('owned_or_linked')
    expect(accessSummaryForPolicy(policy)).toContain('CRM')
    expect(accessSummaryForPolicy(policy)).toContain('owned or linked')
  })

  it('gives owners and system actors full access regardless of stored overrides', () => {
    const ownerPolicy = resolveMemberAccessPolicy({
      role: 'owner',
      accessPolicy: {
        preset: 'custom',
        modules: { crm: false },
        recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
      },
    })
    const systemPolicy = resolveMemberAccessPolicy({ role: 'system', accessScope: 'readonly' })

    expect(WORKSPACE_MODULE_KEYS.every((moduleKey) => canAccessModule(ownerPolicy, moduleKey))).toBe(true)
    expect(recordScopeFor(ownerPolicy, 'crm')).toBe('all')
    expect(WORKSPACE_MODULE_KEYS.every((moduleKey) => canAccessModule(systemPolicy, moduleKey))).toBe(true)
    expect(recordScopeFor(systemPolicy, 'projects')).toBe('all')
  })

  it('defaults admins to full access but honors owner-provided narrowing overrides', () => {
    const defaultAdmin = resolveMemberAccessPolicy({ role: 'admin' })
    const narrowedAdmin = resolveMemberAccessPolicy({
      role: 'admin',
      accessPolicy: normalizeMemberAccessPolicy({
        preset: 'custom',
        modules: { crm: true, projects: false, reports: true },
        recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
      }),
    })

    expect(canAccessModule(defaultAdmin, 'projects')).toBe(true)
    expect(recordScopeFor(defaultAdmin, 'crm')).toBe('all')
    expect(canAccessModule(narrowedAdmin, 'crm')).toBe(true)
    expect(canAccessModule(narrowedAdmin, 'projects')).toBe(false)
    expect(recordScopeFor(narrowedAdmin, 'crm')).toBe('owned_or_linked')
  })

  it('normalizes partial custom policies with safe defaults', () => {
    const policy = normalizeMemberAccessPolicy({
      preset: 'custom',
      modules: { crm: true },
      recordScopes: { crm: 'all' },
    })

    expect(canAccessModule(policy, 'crm')).toBe(true)
    expect(canAccessModule(policy, 'marketing')).toBe(false)
    expect(recordScopeFor(policy, 'crm')).toBe('all')
    expect(recordScopeFor(policy, 'projects')).toBe('owned_or_linked')
  })

  it('keeps agent execution deny-by-default and normalizes explicit per-runtime grants', () => {
    const policy = normalizeMemberAccessPolicy({
      preset: 'custom',
      modules: { messages: true },
      recordScopes: {},
      agentRuntimeAccess: {
        'partners-vps': ['pip', 'theo', 'theo', 'INVALID AGENT'],
        'bad path/target': ['maya'],
      },
    })

    expect(policy.agentRuntimeAccess).toEqual({ 'partners-vps': ['pip', 'theo'] })
    expect(memberCanUseAgentOnRuntime(policy, 'partners-vps', 'theo')).toBe(true)
    expect(memberCanUseAgentOnRuntime(policy, 'partners-vps', 'maya')).toBe(false)
    expect(memberCanUseAgentOnRuntime(policy, 'another-vps', 'pip')).toBe(false)
  })

  it('preserves valid custom agent ids in explicit runtime grants', () => {
    const policy = normalizeMemberAccessPolicy({
      agentRuntimeAccess: {
        'linked-device:member-mac': ['my-research-agent', 'INVALID AGENT'],
      },
    })
    expect(policy.agentRuntimeAccess).toEqual({
      'linked-device:member-mac': ['my-research-agent'],
    })
    expect(memberCanUseAgentOnRuntime(policy, 'linked-device:member-mac', 'my-research-agent')).toBe(true)
  })

  it('matches Team grants when dispatch passes linked-device prefix or bare device id', () => {
    const linkedPolicy = normalizeMemberAccessPolicy({
      agentRuntimeAccess: {
        'linked-device:device-abc': ['qa-release'],
      },
    })
    expect(memberCanUseAgentOnRuntime(linkedPolicy, 'linked-device:device-abc', 'qa-release')).toBe(true)
    expect(memberCanUseAgentOnRuntime(linkedPolicy, 'device-abc', 'qa-release')).toBe(true)
    expect(memberCanUseAgentOnRuntime(linkedPolicy, 'linked-device:other', 'qa-release')).toBe(false)

    const barePolicy = normalizeMemberAccessPolicy({
      agentRuntimeAccess: {
        'device-xyz': ['theo'],
      },
    })
    expect(memberCanUseAgentOnRuntime(barePolicy, 'device-xyz', 'theo')).toBe(true)
    expect(memberCanUseAgentOnRuntime(barePolicy, 'linked-device:device-xyz', 'theo')).toBe(true)
  })

  it('defaults allowPersonalLlmOnOrgVps to false for members and true for owners', () => {
    expect(normalizeMemberAccessPolicy({ preset: 'custom', modules: { messages: true } }).allowPersonalLlmOnOrgVps).toBe(false)
    expect(normalizeMemberAccessPolicy({
      preset: 'custom',
      modules: { messages: true },
      allowPersonalLlmOnOrgVps: true,
    }).allowPersonalLlmOnOrgVps).toBe(true)
    expect(resolveMemberAccessPolicy({ role: 'owner' }).allowPersonalLlmOnOrgVps).toBe(true)
    expect(memberMayUsePersonalLlmOnOrgVps({ allowPersonalLlmOnOrgVps: true }, 'member')).toBe(true)
    expect(memberMayUsePersonalLlmOnOrgVps({ allowPersonalLlmOnOrgVps: false }, 'member')).toBe(false)
    expect(memberMayUsePersonalLlmOnOrgVps({ allowPersonalLlmOnOrgVps: false }, 'owner')).toBe(true)
  })

  it('enforces per-module action grants with the module toggle as the top-level allow', () => {
    const policy = normalizeMemberAccessPolicy({
      preset: 'custom',
      modules: { crm: true, documents: true, billing: true },
      recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
      moduleActions: {
        crm: { create: false, delete: false, export: true },
        documents: { edit: false },
        billing: { create: false, edit: false },
      },
    })

    // Module off blocks everything even with action grants present.
    expect(memberCanPerformModuleAction(policy, 'projects', 'create')).toBe(false)
    // Explicit false overrides the org default.
    expect(memberCanPerformModuleAction(policy, 'crm', 'create')).toBe(false)
    expect(memberCanPerformModuleAction(policy, 'crm', 'delete')).toBe(false)
    expect(memberCanPerformModuleAction(policy, 'documents', 'edit')).toBe(false)
    // Explicit true and unset actions fall back to the org default (true).
    expect(memberCanPerformModuleAction(policy, 'crm', 'export')).toBe(true)
    expect(memberCanPerformModuleAction(policy, 'crm', 'send')).toBe(true)
    // Caller-supplied org default is honored when no explicit flag is stored.
    expect(memberCanPerformModuleAction(policy, 'crm', 'create', false)).toBe(false)
  })

  it('keeps billing delete fail-closed: explicit grant required for members', () => {
    const noGrant = normalizeMemberAccessPolicy({
      preset: 'custom',
      modules: { crm: true, billing: true },
      recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
      capabilities: { invoices: true, quotes: true },
    })
    const withGrant = normalizeMemberAccessPolicy({
      preset: 'custom',
      modules: { crm: true, billing: true },
      recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
      moduleActions: { billing: { delete: true } },
    })

    expect(memberCanDeleteBillingRecord(noGrant)).toBe(false)
    expect(memberCanDeleteBillingRecord(withGrant)).toBe(true)
  })

  it('applies org modulePolicies as defaults for members without an explicit policy', () => {
    const effective = resolveEffectiveMemberPolicy({
      role: 'member',
      orgModulePolicies: {
        projects: {
          actions: {
            visibility: { owner: true, admin: true, member: false, viewer: false },
            create: { owner: true, admin: true, member: false, viewer: false },
          },
        },
        documents: {
          actions: {
            visibility: { owner: true, admin: true, member: true, viewer: true },
          },
        },
      },
    })

    expect(canAccessModule(effective, 'projects')).toBe(false)
    expect(canAccessModule(effective, 'documents')).toBe(true)
    // Org matrix member=false for create translates to a member action grant false.
    expect(memberCanPerformModuleAction(effective, 'projects', 'create')).toBe(false)
    // Full-workspace default modules remain on (crm/marketing not in the matrix).
    expect(canAccessModule(effective, 'crm')).toBe(true)
  })

  it('prefers the explicit per-member policy over org modulePolicies defaults', () => {
    const effective = resolveEffectiveMemberPolicy({
      role: 'member',
      accessPolicy: {
        preset: 'custom',
        modules: { crm: true, research: true },
        recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
      },
      orgModulePolicies: {
        research: {
          actions: {
            visibility: { owner: true, admin: true, member: false, viewer: false },
          },
        },
      },
    })

    // Explicit policy wins: research stays on even though the org matrix says no.
    expect(canAccessModule(effective, 'research')).toBe(true)
    // Modules absent from the explicit policy stay off.
    expect(canAccessModule(effective, 'projects')).toBe(false)
  })

  it('backfills missing recordScopes keys from DEFAULT_RECORD_SCOPES (legacy policies)', () => {
    const legacy = normalizeMemberAccessPolicy({
      preset: 'custom',
      modules: { research: true, documents: true, marketing: true, crm: true },
      // Legacy CRM-era policy only ever set the CRM/projects keys.
      recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
    })

    expect(recordScopeFor(legacy, 'crm')).toBe('owned_or_linked')
    expect(recordScopeFor(legacy, 'projects')).toBe('owned_or_linked')
    // Missing keys keep the module default — research/documents/marketing 'all'.
    expect(recordScopeFor(legacy, 'research')).toBe(DEFAULT_RECORD_SCOPES.research)
    expect(recordScopeFor(legacy, 'documents')).toBe(DEFAULT_RECORD_SCOPES.documents)
    expect(recordScopeFor(legacy, 'marketing')).toBe(DEFAULT_RECORD_SCOPES.marketing)
    // Explicit overrides are still honored.
    const narrowed = normalizeMemberAccessPolicy({
      preset: 'custom',
      modules: { research: true },
      recordScopes: { research: 'owned_or_linked' },
    })
    expect(recordScopeFor(narrowed, 'research')).toBe('owned_or_linked')
  })

  it('exposes named presets for the Team access editor', () => {
    const full = presetPolicy('full')
    const crmSales = presetPolicy('crm_sales')
    const projectDelivery = presetPolicy('project_delivery')
    const marketing = presetPolicy('marketing')
    const finance = presetPolicy('finance')
    const reviewer = presetPolicy('reviewer')

    expect(isFullWorkspaceAccessPolicy(full)).toBe(true)
    expect(canAccessModule(crmSales, 'crm')).toBe(true)
    expect(canAccessModule(crmSales, 'projects')).toBe(false)
    expect(canAccessModule(projectDelivery, 'projects')).toBe(true)
    expect(canAccessModule(projectDelivery, 'documents')).toBe(true)
    expect(canAccessModule(marketing, 'marketing')).toBe(true)
    expect(canAccessModule(marketing, 'email')).toBe(true)
    expect(canAccessModule(finance, 'billing')).toBe(true)
    expect(canAccessModule(finance, 'crm')).toBe(false)
    expect(canAccessModule(reviewer, 'reports')).toBe(true)
    expect(canAccessModule(reviewer, 'marketing')).toBe(false)

    // Every non-custom preset has a human label for the UI.
    expect(ACCESS_PRESET_LABELS.crm_sales).toContain('CRM')
    expect(ACCESS_PRESET_LABELS.finance).toBeTruthy()
    expect(ACCESS_PRESET_LABELS.reviewer).toContain('review')
  })

  it('resolveEffectiveMemberPolicy keeps viewer backfill from the role matrix', () => {
    const viewerPolicy = resolveEffectiveMemberPolicy({
      role: 'viewer',
      orgModulePolicies: {
        research: {
          actions: {
            visibility: { owner: true, admin: true, member: false, viewer: true },
          },
        },
      },
    })
    // Viewer role without explicit policy uses the org matrix viewer column.
    expect(canAccessModule(viewerPolicy, 'research')).toBe(true)
  })

  it('does not mutate the shared FULL_ACCESS_POLICY singleton when applying org defaults', () => {
    const snapshotModules = { ...FULL_ACCESS_POLICY.modules }
    const snapshotScopes = { ...FULL_ACCESS_POLICY.recordScopes }

    resolveEffectiveMemberPolicy({
      role: 'member',
      orgModulePolicies: {
        projects: {
          actions: {
            visibility: { owner: true, admin: true, member: false, viewer: false },
          },
        },
      },
    })

    expect(FULL_ACCESS_POLICY.modules).toEqual(snapshotModules)
    expect(FULL_ACCESS_POLICY.recordScopes).toEqual(snapshotScopes)
    // The singleton still grants every workspace module.
    expect(WORKSPACE_MODULE_KEYS.every((moduleKey) => canAccessModule(FULL_ACCESS_POLICY, moduleKey))).toBe(true)
  })
})
