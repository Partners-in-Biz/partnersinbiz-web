import {
  buildCanonicalMigrationPlan,
  type CanonicalMigrationSnapshot,
} from '@/lib/cross-org/migration'
import type { PartnerLink, PartnerResourceGrant } from '@/lib/cross-org/types'
import { projectRecordFields } from '@/lib/company-work/fields'

function snapshot(overrides: Partial<CanonicalMigrationSnapshot> = {}): CanonicalMigrationSnapshot {
  return {
    relationships: [],
    shares: [],
    existingLinks: [],
    existingGrants: [],
    existingIdentityLinks: [],
    existingAgreements: [],
    resources: [],
    crmIdentityRows: [],
    ...overrides,
  }
}

describe('company_workspace grant backfill planner', () => {
  it('mints one deterministic PartnerLink for a reciprocal linked pair and plans both grants', () => {
    const plan = buildCanonicalMigrationPlan(snapshot({
      linkedCompanies: [
        { companyId: 'co-on-pib', orgId: 'pib', linkedOrgId: 'client', sharedCapabilities: ['seo', 'projects'] },
        { companyId: 'pib-on-client', orgId: 'client', linkedOrgId: 'pib', sharedCapabilities: [] },
      ],
    }))

    const links = plan.operations.filter((op) => op.kind === 'promote_partner_link')
    expect(links).toHaveLength(1)
    expect(links[0].decision).toBe('plan')
    expect(links[0].documentId).toBe('cw-link:client:pib')
    expect(links[0].after).toMatchObject({ orgA: 'client', orgB: 'pib', status: 'active' })

    const grants = plan.operations.filter((op) => op.kind === 'backfill_company_workspace_grant')
    expect(grants.map((op) => op.decision)).toEqual(['plan', 'plan'])
    const byOwner = Object.fromEntries(grants.map((op) => [(op.after as { ownerOrgId: string }).ownerOrgId, op.after]))
    expect(byOwner.pib).toMatchObject({
      id: 'cw:cw-link:client:pib:pib:co-on-pib',
      resourceType: 'company_workspace',
      resourceId: 'co-on-pib',
      grantee: { orgIds: ['client'] },
      items: ['seo', 'projects'],
      actions: ['view', 'comment', 'approve'],
    })
    // Explicit empty capability list is honoured (client shares nothing back yet).
    expect(byOwner.client).toMatchObject({ items: [] })
  })

  it('falls back to the default module set only when capabilities are undefined', () => {
    const plan = buildCanonicalMigrationPlan(snapshot({
      linkedCompanies: [
        { companyId: 'c1', orgId: 'a', linkedOrgId: 'b' },
        { companyId: 'c2', orgId: 'b', linkedOrgId: 'a' },
      ],
    }))
    const grant = plan.operations.find((op) => op.kind === 'backfill_company_workspace_grant')
    expect((grant?.after as { items: string[] }).items).toEqual(
      expect.arrayContaining(['crm', 'projects', 'documents', 'campaigns', 'social', 'email', 'seo', 'ads', 'research', 'services', 'support', 'messages']),
    )
  })

  it('skips one-directional linked companies without a link and never mints for them', () => {
    const plan = buildCanonicalMigrationPlan(snapshot({
      linkedCompanies: [{ companyId: 'lonely', orgId: 'a', linkedOrgId: 'b' }],
    }))
    expect(plan.operations.filter((op) => op.kind === 'promote_partner_link')).toHaveLength(0)
    const grant = plan.operations.find((op) => op.kind === 'backfill_company_workspace_grant')
    expect(grant?.decision).toBe('skip')
    expect(grant?.documentId).toBe('lonely')
    expect(grant?.before).toMatchObject({ companyId: 'lonely', orgId: 'a', linkedOrgId: 'b' })
  })

  it('is idempotent: existing active link + grants produce noops only', () => {
    const link = {
      id: 'cw-link:a:b',
      partnerLinkId: 'cw-link:a:b',
      orgA: 'a',
      orgB: 'b',
      status: 'active',
    } as PartnerLink
    const grants = [
      { id: 'cw:cw-link:a:b:a:c1', partnerLinkId: 'cw-link:a:b', ownerOrgId: 'a', resourceType: 'company_workspace', resourceId: 'c1', status: 'active' },
      { id: 'cw:cw-link:a:b:b:c2', partnerLinkId: 'cw-link:a:b', ownerOrgId: 'b', resourceType: 'company_workspace', resourceId: 'c2', status: 'active' },
    ] as PartnerResourceGrant[]

    const plan = buildCanonicalMigrationPlan(snapshot({
      existingLinks: [link],
      existingGrants: grants,
      linkedCompanies: [
        { companyId: 'c1', orgId: 'a', linkedOrgId: 'b' },
        { companyId: 'c2', orgId: 'b', linkedOrgId: 'a' },
      ],
    }))

    expect(plan.operations.filter((op) => op.kind === 'promote_partner_link' && op.decision === 'plan')).toHaveLength(0)
    const cw = plan.operations.filter((op) => op.kind === 'backfill_company_workspace_grant')
    expect(cw.map((op) => op.decision)).toEqual(['noop', 'noop'])
    expect(plan.operations.every((op) => op.destructive !== true)).toBe(true)
  })
})

describe('write-back projection fields', () => {
  it('exposes clientApproval and comment counters to the viewer for every module', () => {
    const projected = projectRecordFields('projects', {
      id: 'p1',
      name: 'Launch',
      clientApproval: { state: 'approved', byOrgId: 'client' },
      clientCommentCount: 3,
      internalBudget: 1000,
    })
    expect(projected).toMatchObject({
      clientApproval: { state: 'approved' },
      clientCommentCount: 3,
    })
    expect(projected.internalBudget).toBeUndefined()
  })
})
