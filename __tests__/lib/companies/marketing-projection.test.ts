import { isProjectedCompanyMarketing, toMarketingCompanyCard } from '@/lib/companies/marketing-projection'

describe('isProjectedCompanyMarketing', () => {
  it('shows a CRM-home company on the org Marketing tab only when it is linked', () => {
    expect(isProjectedCompanyMarketing({ orgId: 'pib', linkedOrgId: 'lumen' }, 'pib')).toBe(true)
    expect(isProjectedCompanyMarketing({ orgId: 'pib' }, 'pib')).toBe(false)
  })

  it('projects the same company onto the linked client org', () => {
    expect(isProjectedCompanyMarketing({ orgId: 'pib', linkedOrgId: 'lumen' }, 'lumen')).toBe(true)
  })

  it('hides deleted rows', () => {
    expect(isProjectedCompanyMarketing({ orgId: 'pib', linkedOrgId: 'lumen', deleted: true }, 'pib')).toBe(false)
  })
})

describe('toMarketingCompanyCard', () => {
  it('carries companyId as the card id for company-scoped routes', () => {
    expect(toMarketingCompanyCard({
      id: 'co-1',
      name: 'Lumen',
      orgId: 'pib',
      linkedOrgId: 'lumen',
    })).toEqual({
      id: 'co-1',
      name: 'Lumen',
      orgId: 'pib',
      linkedOrgId: 'lumen',
    })
  })
})
