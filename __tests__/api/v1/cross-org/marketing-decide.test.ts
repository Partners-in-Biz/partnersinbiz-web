jest.mock('@/lib/auth/crm-middleware', () => ({
  withCrmAuth: (_minRole: string, handler: (req: Request, ctx: unknown) => unknown) => (req: Request) => {
    const role = (req as Request & { _testRole?: string })._testRole ?? 'member'
    const isAgent = role === 'agent'
    return handler(req, {
      orgId: 'org-b',
      role,
      isAgent,
      actor: isAgent
        ? { uid: 'agent:maya', displayName: 'Maya', kind: 'agent' }
        : { uid: 'user-partner-1', displayName: 'Partner One', kind: 'human' },
      permissions: {},
      accessPolicy: {},
    })
  },
}))

jest.mock('@/lib/cross-org/policy-service', () => {
  const decide = jest.fn()
  return { createCrossOrgPolicyService: () => ({ decide }) }
})

jest.mock('@/lib/cross-org/marketing-resource-owner', () => ({
  loadMarketingResourceOwner: jest.fn().mockResolvedValue('org-a'),
}))

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/v1/cross-org/marketing/decide/route'
import { createCrossOrgPolicyService } from '@/lib/cross-org/policy-service'

const mockService = createCrossOrgPolicyService as jest.Mock
const mockDecide = mockService().decide as jest.Mock

function request(body: unknown, role = 'member') {
  const req = new NextRequest('http://localhost/api/v1/cross-org/marketing/decide', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { authorization: 'Bearer test', 'content-type': 'application/json', 'x-org-id': 'org-b' },
  })
  ;(req as NextRequest & { _testRole?: string })._testRole = role
  return req
}

describe('POST /api/v1/cross-org/marketing/decide', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDecide.mockResolvedValue({
      allowed: true,
      reasonCode: 'ALLOWED',
      chain: [{ step: 'actor', passed: true }],
      partnerLinkId: 'link-1',
      resourceGrantId: 'grant-1',
      projection: { fields: ['metrics'], items: null },
      auditEventId: 'audit-1',
    })
  })

  it('derives social draft review authority from the safe module contract and authenticated named user', async () => {
    const res = await POST(request({
      module: 'social', resourceId: 'post-1', partnerLinkId: 'link-1', mode: 'draft_review',
      action: 'publish', resourceType: 'invoice', orgId: 'org-evil', userId: 'user-evil',
    }))

    expect(res.status).toBe(200)
    expect(mockDecide).toHaveBeenCalledWith(expect.objectContaining({
      actor: { userId: 'user-partner-1', orgId: 'org-b', platformAdmin: false },
      actorRef: { uid: 'user-partner-1', displayName: 'Partner One', kind: 'human' },
      resourceType: 'social_post',
      resourceOwnerOrgId: 'org-a',
      requiredCapability: 'social',
      action: 'review_draft',
      requireNamedUser: true,
      actorRole: 'member',
      recordDecision: true,
    }))
  })

  it('rejects undeclared side effects rather than treating a decision endpoint as publishing authority', async () => {
    const res = await POST(request({
      module: 'social', resourceId: 'post-1', partnerLinkId: 'link-1', mode: 'delegated_operation', delegatedOperation: 'publish',
    }))
    expect(res.status).toBe(403)
    expect(mockDecide).not.toHaveBeenCalled()
  })

  it('requires a human for a collaboration approval decision', async () => {
    const res = await POST(request({
      module: 'ads', resourceId: 'ad-1', partnerLinkId: 'link-1', mode: 'approval',
    }, 'agent'))
    expect(res.status).toBe(403)
    expect(mockDecide).not.toHaveBeenCalled()
  })

  it('returns a policy denial as a successful audited decision envelope', async () => {
    mockDecide.mockResolvedValue({
      allowed: false,
      reasonCode: 'NAMED_USER_GRANT_REQUIRED',
      chain: [{ step: 'resource_grant', passed: false, detail: 'named user grant required' }],
      partnerLinkId: 'link-1',
      auditEventId: 'audit-denied',
    })
    const res = await POST(request({
      module: 'analytics', resourceId: 'property-1', partnerLinkId: 'link-1', mode: 'reporting_view',
    }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ allowed: false, reasonCode: 'NAMED_USER_GRANT_REQUIRED', auditEventId: 'audit-denied' }),
    }))
  })
})
