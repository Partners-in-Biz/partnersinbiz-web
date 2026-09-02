import {
  COMPANY_WORKSPACE_ACTIONS,
  grantIncludesModule,
  normalizeCompanyWorkspaceModules,
  companyWorkspaceGrantId,
} from '@/lib/company-work/grants'
import { projectRecordFields } from '@/lib/company-work/fields'
import { isClientPrivate } from '@/lib/work-scope'
import type { PartnerResourceGrant } from '@/lib/cross-org/types'
import { orgRoleRank } from '@/lib/cross-org/decision'

describe('company workspace grants', () => {
  it('builds stable grant ids and normalises modules', () => {
    expect(companyWorkspaceGrantId({
      partnerLinkId: 'link-1',
      ownerOrgId: 'org-a',
      companyId: 'co-1',
    })).toBe('cw:link-1:org-a:co-1')

    expect(normalizeCompanyWorkspaceModules(['seo', 'ads', 'seo', 'not-a-module' as never])).toEqual([
      'seo',
      'ads',
    ])
    expect(normalizeCompanyWorkspaceModules([])).toEqual([])
    expect(normalizeCompanyWorkspaceModules(undefined).length).toBeGreaterThan(0)
  })

  it('checks module membership on grants', () => {
    const grant = {
      status: 'active',
      items: ['seo', 'campaigns'],
    } as PartnerResourceGrant
    expect(grantIncludesModule(grant, 'seo')).toBe(true)
    expect(grantIncludesModule(grant, 'ads')).toBe(false)
    expect(grantIncludesModule({ ...grant, status: 'revoked' }, 'seo')).toBe(false)
  })

  it('exposes view|comment|approve actions matching decideSharedAction', () => {
    expect([...COMPANY_WORKSPACE_ACTIONS]).toEqual(['view', 'comment', 'approve'])
    expect(orgRoleRank('viewer', 'viewer')).toBe(true)
  })
})

describe('company work field projection', () => {
  it('whitelists seo fields and drops spend-like keys', () => {
    const projected = projectRecordFields('seo', {
      id: 's1',
      orgId: 'org-a',
      companyId: 'co-1',
      siteName: 'Acme',
      siteUrl: 'https://acme.test',
      status: 'active',
      secretApiKey: 'nope',
      spendBudget: 999,
    })
    expect(projected).toMatchObject({
      id: 's1',
      siteName: 'Acme',
      status: 'active',
    })
    expect(projected.secretApiKey).toBeUndefined()
    expect(projected.spendBudget).toBeUndefined()
  })
})

describe('three-org pairwise projection rules (pure)', () => {
  /**
   * A↔B and B↔C are pairwise. A never sees C's company work.
   * Private records drop even when module is granted.
   */
  type FixtureGrant = {
    ownerOrgId: string
    granteeOrgIds: string[]
    companyId: string
    modules: string[]
    status: 'active' | 'revoked'
  }

  type FixtureRecord = {
    orgId: string
    companyId: string
    clientVisibility?: 'shared' | 'private'
  }

  function visibleToViewer(
    viewerOrgId: string,
    grants: FixtureGrant[],
    records: FixtureRecord[],
    module: string,
  ): FixtureRecord[] {
    const allowedCompanies = new Set(
      grants
        .filter((g) => g.status === 'active')
        .filter((g) => g.granteeOrgIds.includes(viewerOrgId))
        .filter((g) => g.modules.includes(module))
        .map((g) => g.companyId),
    )
    return records.filter((record) => (
      allowedCompanies.has(record.companyId)
      && record.orgId !== viewerOrgId
      && !isClientPrivate(record)
    ))
  }

  const grants: FixtureGrant[] = [
    {
      ownerOrgId: 'org-a',
      granteeOrgIds: ['org-b'],
      companyId: 'co-a-serves-b',
      modules: ['seo'],
      status: 'active',
    },
    {
      ownerOrgId: 'org-b',
      granteeOrgIds: ['org-c'],
      companyId: 'co-b-serves-c',
      modules: ['seo'],
      status: 'active',
    },
  ]

  const records: FixtureRecord[] = [
    { orgId: 'org-a', companyId: 'co-a-serves-b' },
    { orgId: 'org-a', companyId: 'co-a-serves-b', clientVisibility: 'private' },
    { orgId: 'org-b', companyId: 'co-b-serves-c' },
  ]

  it('lets B see A company work, never lets A see C', () => {
    expect(visibleToViewer('org-b', grants, records, 'seo')).toEqual([
      { orgId: 'org-a', companyId: 'co-a-serves-b' },
    ])
    expect(visibleToViewer('org-a', grants, records, 'seo')).toEqual([])
    expect(visibleToViewer('org-c', grants, records, 'seo')).toEqual([
      { orgId: 'org-b', companyId: 'co-b-serves-c' },
    ])
  })

  it('hides private records and revoked grants', () => {
    const revoked = grants.map((g) => (
      g.companyId === 'co-a-serves-b' ? { ...g, status: 'revoked' as const } : g
    ))
    expect(visibleToViewer('org-b', revoked, records, 'seo')).toEqual([])
  })

  it('hides a module when it is toggled off', () => {
    const noSeo = grants.map((g) => (
      g.companyId === 'co-a-serves-b' ? { ...g, modules: ['campaigns'] } : g
    ))
    expect(visibleToViewer('org-b', noSeo, records, 'seo')).toEqual([])
  })
})
