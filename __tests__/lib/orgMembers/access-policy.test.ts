import {
  WORKSPACE_MODULE_KEYS,
  accessSummaryForPolicy,
  canAccessModule,
  defaultAccessPolicyFor,
  normalizeMemberAccessPolicy,
  recordScopeFor,
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
})
