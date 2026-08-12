import { NextRequest, NextResponse } from 'next/server'

type AuthHandler = (req: Request, ctx: Record<string, unknown>) => unknown

jest.mock('@/lib/auth/crm-middleware', () => ({
  withCrmAuth: (minRole: string, handler: AuthHandler) =>
    (req: Request) => {
      const role = (req as Request & { _testRole?: string })._testRole ?? minRole
      if (minRole === 'admin' && role === 'member') {
        return NextResponse.json({ success: false, error: 'Insufficient permissions' }, { status: 403 })
      }
      const isAgent = role === 'agent'
      return handler(req, {
        orgId: 'org-b',
        role,
        isAgent,
        actor: isAgent
          ? { uid: 'agent:theo', displayName: 'Theo', kind: 'agent' }
          : { uid: 'user-partner-1', displayName: 'Partner One', kind: 'human' },
        permissions: {},
        accessPolicy: {},
      })
    },
}))

jest.mock('@/lib/cross-org/policy-service', () => {
  const decide = jest.fn()
  return {
    createCrossOrgPolicyService: () => ({ decide }),
    CrossOrgPolicyService: class {},
    FirestoreCrossOrgPolicyStore: class {},
    InMemoryCrossOrgPolicyStore: class {},
    buildSafeProjection: jest.fn(),
    projectResourceRecord: jest.fn(),
    reasonCodeFromDecision: jest.fn(),
    hashPartnerAuditEvent: jest.fn(),
  }
})

import { POST } from '@/app/api/v1/cross-org/decide/route'
import { createCrossOrgPolicyService } from '@/lib/cross-org/policy-service'

const mockService = createCrossOrgPolicyService as jest.Mock
const mockDecide = mockService().decide as jest.Mock

function makePostReq(body: unknown, role = 'member'): NextRequest {
  const req = new NextRequest('http://localhost/api/v1/cross-org/decide', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: 'Bearer test', 'x-org-id': 'org-b' },
  })
  ;(req as NextRequest & { _testRole?: string })._testRole = role
  return req
}

describe('POST /api/v1/cross-org/decide — audit decision API contract', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDecide.mockResolvedValue({
      allowed: true,
      reasonCode: 'ALLOWED',
      chain: [{ step: 'actor', passed: true }],
      partnerLinkId: 'link-1',
      scopeAgreementId: 'scope-ab',
      resourceGrantId: 'grant-1',
      projection: { fields: null, items: null },
      auditEventId: 'audit-1',
    })
  })

  it('returns 400 when resourceType is missing', async () => {
    const res = await POST(makePostReq({ resourceId: 'doc-1', action: 'view', partnerLinkId: 'link-1' }))
    expect(res.status).toBe(400)
    expect(mockDecide).not.toHaveBeenCalled()
  })

  it('returns 400 for an unknown resourceType', async () => {
    const res = await POST(makePostReq({ resourceType: 'banana', resourceId: 'doc-1', action: 'view', partnerLinkId: 'link-1' }))
    expect(res.status).toBe(400)
    expect(mockDecide).not.toHaveBeenCalled()
  })

  it('returns 400 when resourceId is missing', async () => {
    const res = await POST(makePostReq({ resourceType: 'document', action: 'view', partnerLinkId: 'link-1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when action is missing', async () => {
    const res = await POST(makePostReq({ resourceType: 'document', resourceId: 'doc-1', partnerLinkId: 'link-1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for an unknown requiredCapability', async () => {
    const res = await POST(makePostReq({ resourceType: 'document', resourceId: 'doc-1', action: 'view', partnerLinkId: 'link-1', requiredCapability: 'telepathy' }))
    expect(res.status).toBe(400)
    expect(mockDecide).not.toHaveBeenCalled()
  })

  it('rejects marketing resource types so their closed-mode route remains the only decision boundary', async () => {
    const res = await POST(makePostReq({ resourceType: 'analytics', resourceId: 'property-1', action: 'view', partnerLinkId: 'link-1' }))
    expect(res.status).toBe(403)
    expect(mockDecide).not.toHaveBeenCalled()
  })

  it('rejects research/property decisions until a closed-mode adapter-backed route exists', async () => {
    for (const resourceType of ['research', 'property']) {
      const res = await POST(makePostReq({ resourceType, resourceId: `${resourceType}-1`, action: 'view', partnerLinkId: 'link-1' }))
      expect(res.status).toBe(403)
    }
    expect(mockDecide).not.toHaveBeenCalled()
  })

  it('derives actor org/user from the auth context, never from the body', async () => {
    const res = await POST(makePostReq({
      resourceType: 'document',
      resourceId: 'doc-1',
      action: 'view',
      partnerLinkId: 'link-1',
      orgId: 'org-evil',
      userId: 'user-evil',
    }))
    expect(res.status).toBe(200)
    expect(mockDecide).toHaveBeenCalledWith(expect.objectContaining({
      actor: { userId: 'user-partner-1', orgId: 'org-b', platformAdmin: false },
      actorRef: { uid: 'user-partner-1', displayName: 'Partner One', kind: 'human' },
      resourceType: 'document',
      resourceId: 'doc-1',
      action: 'view',
      partnerLinkId: 'link-1',
      recordDecision: true,
    }))
  })

  it('forwards field/item/actorRole/actorTeamIds and recordDecision=false', async () => {
    const res = await POST(makePostReq({
      resourceType: 'document',
      resourceId: 'doc-1',
      action: 'view',
      partnerLinkId: 'link-1',
      requiredCapability: 'documents',
      field: 'title',
      item: 'v1',
      actorRole: 'viewer',
      actorTeamIds: ['team-1', 'team-2'],
      recordDecision: false,
    }))
    expect(res.status).toBe(200)
    expect(mockDecide).toHaveBeenCalledWith(expect.objectContaining({
      field: 'title',
      item: 'v1',
      actorRole: 'viewer',
      actorTeamIds: ['team-1', 'team-2'],
      requiredCapability: 'documents',
      recordDecision: false,
    }))
  })

  it('uses the agent actor ref when an agent calls with X-Agent-Actor semantics', async () => {
    const res = await POST(makePostReq({
      resourceType: 'document',
      resourceId: 'doc-1',
      action: 'view',
      partnerLinkId: 'link-1',
    }, 'agent'))
    expect(res.status).toBe(200)
    expect(mockDecide).toHaveBeenCalledWith(expect.objectContaining({
      actor: { userId: 'agent:theo', orgId: 'org-b', platformAdmin: false },
      actorRef: { uid: 'agent:theo', displayName: 'Theo', kind: 'agent' },
    }))
  })

  it('returns the decision envelope with reason code, chain and projection', async () => {
    const res = await POST(makePostReq({ resourceType: 'document', resourceId: 'doc-1', action: 'view', partnerLinkId: 'link-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toEqual(expect.objectContaining({
      allowed: true,
      reasonCode: 'ALLOWED',
      partnerLinkId: 'link-1',
      scopeAgreementId: 'scope-ab',
      resourceGrantId: 'grant-1',
      projection: { fields: null, items: null },
      auditEventId: 'audit-1',
    }))
  })

  it('returns a denied decision as a successful envelope (decision is not an error)', async () => {
    mockDecide.mockResolvedValue({
      allowed: false,
      reason: 'action write not granted',
      reasonCode: 'ACTION_NOT_GRANTED',
      chain: [{ step: 'action_field', passed: false, detail: 'action write not granted' }],
      partnerLinkId: 'link-1',
    })
    const res = await POST(makePostReq({ resourceType: 'document', resourceId: 'doc-1', action: 'write', partnerLinkId: 'link-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.allowed).toBe(false)
    expect(body.data.reasonCode).toBe('ACTION_NOT_GRANTED')
  })

  it('returns 400 for a partnerLinkId that is not canonical-shaped', async () => {
    const res = await POST(makePostReq({ resourceType: 'document', resourceId: 'doc-1', action: 'view', partnerLinkId: 'rel-abc' }))
    expect(res.status).toBe(400)
    expect(mockDecide).not.toHaveBeenCalled()
  })
})
