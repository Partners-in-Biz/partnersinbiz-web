import {
  buildCommercialOwnershipPatch,
  buildProjectOwnershipPatch,
  parseFlags,
} from '@/scripts/migrate-pib-owned-client-resources'

describe('migrate-pib-owned-client-resources helpers', () => {
  it('defaults to dry-run and parses commit/org filters', () => {
    expect(parseFlags([])).toEqual({ dryRun: true, batchSize: 300 })
    expect(parseFlags(['--commit', '--org-id', 'client-1'])).toEqual({
      dryRun: false,
      orgId: 'client-1',
      batchSize: 300,
    })
    expect(parseFlags(['--commit', '--dry-run', '--batch-size', '50'])).toEqual({
      dryRun: true,
      batchSize: 50,
    })
  })

  it('plans legacy PiB commercial records as platform-owned and client-received', () => {
    const plan = buildCommercialOwnershipPatch({
      orgId: 'client-org',
      billingOrgId: 'pib-platform-owner',
      invoiceNumber: 'INV-001',
    }, 'pib-platform-owner')

    expect(plan?.patch).toEqual(expect.objectContaining({
      orgId: 'pib-platform-owner',
      sourceOrgId: 'pib-platform-owner',
      issuerOrgId: 'pib-platform-owner',
      recipientOrgId: 'client-org',
      targetOrgId: 'client-org',
      legacyOrgId: 'client-org',
      claimStatus: 'claimed',
    }))
  })

  it('does not migrate non-PiB commercial records', () => {
    expect(buildCommercialOwnershipPatch({
      orgId: 'client-org',
      billingOrgId: 'other-org',
      fromDetails: { companyName: 'Other Sender' },
    }, 'pib-platform-owner')).toBeNull()
  })

  it('plans legacy projects as platform-created and client-received', () => {
    const plan = buildProjectOwnershipPatch({
      orgId: 'client-org',
      name: 'Website rebuild',
    }, 'pib-platform-owner')

    expect(plan?.patch).toEqual(expect.objectContaining({
      orgId: 'pib-platform-owner',
      sourceOrgId: 'pib-platform-owner',
      issuerOrgId: 'pib-platform-owner',
      recipientOrgId: 'client-org',
      targetOrgId: 'client-org',
      clientOrgId: 'client-org',
      clientId: 'client-org',
      legacyOrgId: 'client-org',
      claimStatus: 'claimed',
    }))
  })
})
