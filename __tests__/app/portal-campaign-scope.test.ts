jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: {},
  adminDb: {},
}))

jest.mock('@/lib/portal/org-access', () => ({
  canUsePortalOrg: jest.fn(),
  resolvePortalActiveOrgId: jest.fn(),
}))

import { scopedPortalHref, scopeFromSearchParams } from '@/app/(portal)/portal/campaigns/portalCampaignScope'

describe('portal campaign scope', () => {
  it('preserves CRM company workspace scope for campaign cards and drilldowns', () => {
    const scope = scopeFromSearchParams({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })

    expect(scope).toEqual({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })
    expect(scopedPortalHref('/portal/campaigns/campaign-1', scope)).toBe(
      '/portal/campaigns/campaign-1?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )
  })
})
