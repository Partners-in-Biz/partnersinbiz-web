import { filterCrmRowsForStaffClientOrg } from '@/lib/crm/staff-client-filter'

describe('filterCrmRowsForStaffClientOrg', () => {
  const elemental = 'wS5pgwa6c9WbPocf4w0w'
  const companies = new Map([
    ['co-el', { id: 'co-el', linkedOrgId: elemental }],
    ['co-hu', { id: 'co-hu', linkedOrgId: 'humanaut-org' }],
  ])
  const contacts = new Map([
    ['ct-el', { id: 'ct-el', companyId: 'co-el', linkedOrgId: elemental }],
    ['ct-hu', { id: 'ct-hu', companyId: 'co-hu' }],
  ])

  it('passes rows through when no staff client org is set', () => {
    const rows = [{ id: 'd1', companyId: 'co-hu' }, { id: 'd2', companyId: 'co-el' }]
    expect(filterCrmRowsForStaffClientOrg(undefined, rows, { companies, contacts })).toEqual(rows)
  })

  it('keeps deals whose company is linked to the client org', () => {
    const rows = [
      { id: 'd-el', companyId: 'co-el' },
      { id: 'd-hu', companyId: 'co-hu' },
      { id: 'd-ct', contactId: 'ct-el' },
    ]
    expect(filterCrmRowsForStaffClientOrg(elemental, rows, { companies, contacts }).map((row) => row.id))
      .toEqual(['d-el', 'd-ct'])
  })

  it('keeps companies stamped with the client linkedOrgId', () => {
    const rows = [
      { id: 'co-el', linkedOrgId: elemental },
      { id: 'co-hu', linkedOrgId: 'humanaut-org' },
    ]
    expect(filterCrmRowsForStaffClientOrg(elemental, rows).map((row) => row.id)).toEqual(['co-el'])
  })
})
