import {
  MARKETING_HANDLER_POLICY_BOUND_MODULES,
  assertMarketingHandlerAccess,
  extractPartnerLinkId,
} from '@/lib/cross-org/marketing-handler-access'
import type { ApiUser } from '@/lib/api/types'

const owner = { uid: 'owner-a', role: 'client', orgId: 'org-a' } as ApiUser
const collaborator = { uid: 'member-b', role: 'client', orgId: 'org-b' } as ApiUser
const thirdOrg = { uid: 'member-c', role: 'client', orgId: 'org-c' } as ApiUser

function allowPolicy() {
  return {
    decide: jest.fn(async () => ({
      allowed: true,
      reason: 'allowed',
      reasonCode: 'ALLOWED' as const,
      chain: [],
      resourceGrantId: 'grant-1',
      partnerLinkId: 'link-ab',
      projection: { fields: null, items: null },
    })),
  }
}

function denyPolicy() {
  return {
    decide: jest.fn(async () => ({
      allowed: false,
      reason: 'grant missing',
      reasonCode: 'RESOURCE_GRANT_REQUIRED' as const,
      chain: [],
    })),
  }
}

describe('marketing handler access seam', () => {
  it('binds all six marketing/analytics modules for real handler policy', () => {
    expect([...MARKETING_HANDLER_POLICY_BOUND_MODULES].sort()).toEqual([
      'ads',
      'analytics',
      'campaigns',
      'email',
      'seo',
      'social',
    ])
  })

  it('lets the owning organisation perform owner-only launch/publish/send operations', async () => {
    await expect(assertMarketingHandlerAccess({
      user: owner,
      module: 'campaigns',
      resourceId: 'camp-1',
      resourceOwnerOrgId: 'org-a',
      operation: 'launch',
    })).resolves.toEqual({ ok: true, access: 'owner', orgId: 'org-a' })

    await expect(assertMarketingHandlerAccess({
      user: owner,
      module: 'social',
      resourceId: 'post-1',
      resourceOwnerOrgId: 'org-a',
      operation: 'publish',
    })).resolves.toEqual({ ok: true, access: 'owner', orgId: 'org-a' })
  })

  it('denies recipient/collaborator organisations on owner-only actions without calling policy', async () => {
    const policy = allowPolicy()
    await expect(assertMarketingHandlerAccess({
      user: collaborator,
      module: 'campaigns',
      resourceId: 'camp-1',
      resourceOwnerOrgId: 'org-a',
      operation: 'launch',
      partnerLinkId: 'link-ab',
      policy,
    })).resolves.toMatchObject({
      ok: false,
      status: 403,
      reason: 'OWNER_ONLY_ACTION',
    })

    await expect(assertMarketingHandlerAccess({
      user: collaborator,
      module: 'social',
      resourceId: 'post-1',
      resourceOwnerOrgId: 'org-a',
      operation: 'publish',
      partnerLinkId: 'link-ab',
      policy,
    })).resolves.toMatchObject({ ok: false, reason: 'OWNER_ONLY_ACTION' })

    await expect(assertMarketingHandlerAccess({
      user: collaborator,
      module: 'email',
      resourceId: 'camp-1',
      resourceOwnerOrgId: 'org-a',
      operation: 'send',
      partnerLinkId: 'link-ab',
      policy,
    })).resolves.toMatchObject({ ok: false, reason: 'OWNER_ONLY_ACTION' })

    await expect(assertMarketingHandlerAccess({
      user: collaborator,
      module: 'ads',
      resourceId: 'ad-1',
      resourceOwnerOrgId: 'org-a',
      operation: 'spend',
      partnerLinkId: 'link-ab',
      policy,
    })).resolves.toMatchObject({ ok: false, reason: 'OWNER_ONLY_ACTION' })

    expect(policy.decide).not.toHaveBeenCalled()
  })

  it('allows a named collaborator draft_review only after CrossOrgPolicyService.decide', async () => {
    const policy = allowPolicy()
    const result = await assertMarketingHandlerAccess({
      user: collaborator,
      module: 'social',
      resourceId: 'post-1',
      resourceOwnerOrgId: 'org-a',
      operation: 'draft_review',
      partnerLinkId: 'link-ab',
      policy,
    })
    expect(result).toMatchObject({
      ok: true,
      access: 'cross_org',
      orgId: 'org-b',
      action: 'review_draft',
    })
    expect(policy.decide).toHaveBeenCalledWith(expect.objectContaining({
      actor: expect.objectContaining({ userId: 'member-b', orgId: 'org-b' }),
      resourceType: 'social_post',
      resourceId: 'post-1',
      resourceOwnerOrgId: 'org-a',
      action: 'review_draft',
      partnerLinkId: 'link-ab',
      requiredCapability: 'social',
      requireNamedUser: true,
      recordDecision: false,
    }))
  })

  it('fails closed when the partner link is missing or the grant is revoked', async () => {
    await expect(assertMarketingHandlerAccess({
      user: collaborator,
      module: 'campaigns',
      resourceId: 'camp-1',
      resourceOwnerOrgId: 'org-a',
      operation: 'read',
    })).resolves.toMatchObject({ ok: false, reason: 'PARTNER_LINK_REQUIRED' })

    const policy = denyPolicy()
    await expect(assertMarketingHandlerAccess({
      user: thirdOrg,
      module: 'analytics',
      resourceId: 'prop-1',
      resourceOwnerOrgId: 'org-a',
      operation: 'reporting_view',
      partnerLinkId: 'link-ab',
      policy,
    })).resolves.toMatchObject({ ok: false, reason: 'COLLABORATION_DENIED' })
    expect(policy.decide).toHaveBeenCalled()
  })

  it('extracts partnerLinkId from header, query, or body', () => {
    const req = {
      headers: { get: (name: string) => (name === 'x-partner-link-id' ? 'link-header' : null) },
      url: 'https://partnersinbiz.online/api/v1/campaigns/c1?partnerLinkId=link-query',
    } as unknown as import('next/server').NextRequest
    expect(extractPartnerLinkId(req)).toBe('link-header')
    expect(extractPartnerLinkId({
      headers: { get: () => null },
      url: 'https://partnersinbiz.online/api/v1/campaigns/c1?partnerLinkId=link-query',
    } as unknown as import('next/server').NextRequest)).toBe('link-query')
    expect(extractPartnerLinkId(null, { partnerLinkId: 'link-body' })).toBe('link-body')
    expect(extractPartnerLinkId(null, { partnerLinkId: 'not-a-link' })).toBeNull()
  })
})
