import {
  buildResourceCompanyPatch,
  parseFlags,
  recipientOrgForResource,
} from '@/scripts/backfill-platform-owner-resource-company-links'

describe('backfill-platform-owner-resource-company-links helpers', () => {
  it('defaults to dry-run and parses commit/org filters', () => {
    expect(parseFlags([])).toEqual({ dryRun: true, batchSize: 300 })
    expect(parseFlags(['--commit', '--org-id', 'client-1', '--batch-size', '50'])).toEqual({
      dryRun: false,
      orgId: 'client-1',
      batchSize: 50,
    })
  })

  it('resolves recipient org from current and legacy resource fields', () => {
    expect(recipientOrgForResource({ recipientOrgId: 'recipient' })).toBe('recipient')
    expect(recipientOrgForResource({ targetOrgId: 'target' })).toBe('target')
    expect(recipientOrgForResource({ clientOrgId: 'client' })).toBe('client')
    expect(recipientOrgForResource({ legacyOrgId: 'legacy' })).toBe('legacy')
  })

  it('links invoices with company and sourceCompany ids', () => {
    const plan = buildResourceCompanyPatch('invoices', {
      recipientOrgId: 'client-1',
    }, {
      linkedOrgId: 'client-1',
      companyId: 'co-1',
      companyName: 'Client One',
    })

    expect(plan?.patch).toEqual({
      companyId: 'co-1',
      sourceCompanyId: 'co-1',
      recipientCompanyName: 'Client One',
    })
  })

  it('preserves existing recipient company name and adds companyName for quotes/projects', () => {
    const plan = buildResourceCompanyPatch('projects', {
      recipientOrgId: 'client-1',
      recipientCompanyName: 'Existing Name',
    }, {
      linkedOrgId: 'client-1',
      companyId: 'co-1',
      companyName: 'Client One',
    })

    expect(plan?.patch).toEqual({
      companyId: 'co-1',
      sourceCompanyId: 'co-1',
      recipientCompanyName: 'Existing Name',
      companyName: 'Client One',
    })
  })

  it('skips resources that are already fully linked', () => {
    expect(buildResourceCompanyPatch('invoices', {
      companyId: 'co-1',
      sourceCompanyId: 'co-1',
    }, {
      linkedOrgId: 'client-1',
      companyId: 'co-1',
      companyName: 'Client One',
    })).toBeNull()
  })
})
