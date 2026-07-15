import { normalizeMemberAccessPolicy } from '@/lib/orgMembers/access-policy'
import { canApiUserReadCompany } from '@/lib/companies/api-access'

const restrictedUser = {
  uid: 'user-1',
  role: 'client' as const,
  orgId: 'org-1',
  orgIds: ['org-1'],
  memberAccessPolicy: normalizeMemberAccessPolicy({
    preset: 'custom',
    modules: { crm: true },
    recordScopes: { crm: 'owned_or_linked' },
  }),
}

describe('company access for project setup', () => {
  it('allows only companies directly assigned to a restricted member', () => {
    expect(canApiUserReadCompany(restrictedUser, 'org-1', {
      id: 'company-1', orgId: 'org-1', assignedTo: 'user-1',
    })).toBe(true)
    expect(canApiUserReadCompany(restrictedUser, 'org-1', {
      id: 'company-2', orgId: 'org-1', assignedTo: 'someone-else',
    })).toBe(false)
  })

  it('allows a company reached through an assigned contact', () => {
    expect(canApiUserReadCompany(restrictedUser, 'org-1', {
      id: 'company-1', orgId: 'org-1', assignedTo: 'someone-else',
    }, [{
      id: 'contact-1', orgId: 'org-1', assignedTo: 'user-1', companyId: 'company-1',
    }])).toBe(true)
  })

  it('never crosses the selected organisation', () => {
    expect(canApiUserReadCompany({ uid: 'admin-1', role: 'admin', allowedOrgIds: [] }, 'org-1', {
      id: 'company-1', orgId: 'org-2', assignedTo: 'admin-1',
    })).toBe(false)
  })
})
