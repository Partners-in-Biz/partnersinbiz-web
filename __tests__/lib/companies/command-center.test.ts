import { matchesCompany } from '@/lib/companies/command-center'
import type { Company } from '@/lib/companies/types'

const company: Company = {
  id: 'company-1',
  orgId: 'pib-platform-owner',
  name: 'Client One',
  linkedOrgId: 'client-org',
  tags: [],
  notes: '',
  createdAt: null,
  updatedAt: null,
}

describe('company command center matching', () => {
  it('matches client documents by nested linked company id', () => {
    expect(matchesCompany({
      id: 'doc-1',
      orgId: 'pib-platform-owner',
      linked: { companyId: 'company-1' },
    }, company)).toBe(true)
  })

  it('matches client documents by nested linked client org id', () => {
    expect(matchesCompany({
      id: 'doc-1',
      orgId: 'pib-platform-owner',
      linked: { clientOrgId: 'client-org' },
    }, company)).toBe(true)
  })

  it('matches contacts by secondary company links', () => {
    expect(matchesCompany({
      id: 'contact-1',
      orgId: 'pib-platform-owner',
      companyId: 'primary-company',
      companyLinks: [
        { companyId: 'primary-company', companyName: 'Primary Co', primary: true },
        { companyId: 'company-1', companyName: 'Client One', relationshipType: 'client_member' },
      ],
    }, company)).toBe(true)
  })
})
