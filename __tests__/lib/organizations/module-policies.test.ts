import {
  canRolePerformModuleAction,
  canRoleUseModule,
  resolveOrganizationModulePolicies,
  type OrganizationModulePolicies,
} from '@/lib/organizations/module-policies'

describe('organization module policies', () => {
  it('defaults selected-org governance modules to visible for all organisation roles', () => {
    const policies = resolveOrganizationModulePolicies(undefined)

    expect(canRoleUseModule(policies, 'projects', 'owner')).toBe(true)
    expect(canRoleUseModule(policies, 'documents', 'admin')).toBe(true)
    expect(canRoleUseModule(policies, 'messages', 'member')).toBe(true)
  })

  it('uses saved tab visibility roles to decide whether a portal member can see a module', () => {
    const policies = resolveOrganizationModulePolicies({
      modulePolicies: {
        projects: {
          actions: {
            visibility: { owner: true, admin: true, member: false },
          },
        },
      },
    })

    expect(canRoleUseModule(policies, 'projects', 'member')).toBe(false)
    expect(canRoleUseModule(policies, 'projects', 'admin')).toBe(true)
  })

  it('checks saved action-level role grants', () => {
    const policies = resolveOrganizationModulePolicies({
      modulePolicies: {
        projects: {
          actions: {
            create: { owner: true, admin: true, member: false },
          },
        },
      },
    })

    expect(canRolePerformModuleAction(policies, 'projects', 'create', 'member')).toBe(false)
    expect(canRolePerformModuleAction(policies, 'projects', 'create', 'admin')).toBe(true)
  })

  it('preserves saved action roles and custom items while filling missing defaults', () => {
    const policies: OrganizationModulePolicies = resolveOrganizationModulePolicies({
      modulePolicies: {
        documents: {
          actions: {
            create: { owner: true, admin: false, member: false },
          },
          customItems: [
            { id: 'custom-brief', label: 'Custom brief', description: 'Organisation-specific document template.' },
          ],
        },
      },
    })

    expect(policies.documents.actions.create).toEqual({ owner: true, admin: false, member: false })
    expect(policies.documents.actions.visibility).toEqual({ owner: true, admin: true, member: true })
    expect(policies.documents.customItems).toEqual([
      { id: 'custom-brief', label: 'Custom brief', description: 'Organisation-specific document template.' },
    ])
  })
})
