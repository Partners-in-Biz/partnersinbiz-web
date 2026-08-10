import { NextRequest } from 'next/server'

type AuthHandler = (req: Request, ctx: Record<string, unknown>, routeCtx?: { params: Promise<Record<string, string>> }) => unknown

jest.mock('@/lib/auth/crm-middleware', () => ({
  withCrmAuth: (_minRole: string, handler: AuthHandler) =>
    (req: Request, routeCtx?: { params: Promise<Record<string, string>> }) => {
      const role = (req as Request & { _testRole?: string })._testRole ?? 'member'
      const isAgent = role === 'agent'
      const orgId = (req as Request & { _testOrgId?: string })._testOrgId ?? 'owner-org'
      const uid = (req as Request & { _testUid?: string })._testUid ?? (isAgent ? 'agent:theo' : 'owner-admin')
      return handler(req, {
        orgId,
        uid,
        role: isAgent ? 'member' : role,
        isAgent,
        actor: isAgent
          ? { uid: 'agent:theo', displayName: 'Theo', kind: 'agent' }
          : { uid, displayName: uid, kind: 'human' },
        permissions: {},
        accessPolicy: {},
      }, routeCtx)
    },
}))

const mockIssueInvitation = jest.fn()
const mockClaimInvitationByTokenHash = jest.fn()
const mockRecordOwnerApproval = jest.fn()
const mockActivateInvitation = jest.fn()
const mockRecoverInvitation = jest.fn()
const mockRevokeInvitation = jest.fn()
const mockRevokeGrantByInvitationId = jest.fn()
const mockGetInvitationById = jest.fn()
const mockLoadPrejoinResourceOwner = jest.fn()
const mockLoadActorEmailHash = jest.fn()

jest.mock('@/lib/cross-org/prejoin-resource-store', () => ({
  createPrejoinResourceService: () => ({
    issueInvitation: (...args: unknown[]) => mockIssueInvitation(...args),
    claimInvitationByTokenHash: (...args: unknown[]) => mockClaimInvitationByTokenHash(...args),
    recordOwnerApproval: (...args: unknown[]) => mockRecordOwnerApproval(...args),
    activateInvitation: (...args: unknown[]) => mockActivateInvitation(...args),
    recoverInvitation: (...args: unknown[]) => mockRecoverInvitation(...args),
    revokeInvitation: (...args: unknown[]) => mockRevokeInvitation(...args),
    revokeGrantByInvitationId: (...args: unknown[]) => mockRevokeGrantByInvitationId(...args),
  }),
  getPrejoinInvitationById: (...args: unknown[]) => mockGetInvitationById(...args),
}))

jest.mock('@/lib/cross-org/prejoin-resource-owner', () => ({
  loadPrejoinResourceOwner: (...args: unknown[]) => mockLoadPrejoinResourceOwner(...args),
}))

jest.mock('@/lib/cross-org/prejoin-resource-http', () => {
  const actual = jest.requireActual('@/lib/cross-org/prejoin-resource-http')
  return {
    ...actual,
    loadActorEmailHash: (...args: unknown[]) => mockLoadActorEmailHash(...args),
  }
})

import { POST as issueInvitation } from '@/app/api/v1/cross-org/prejoin-invitations/route'
import { POST as claimInvitation } from '@/app/api/v1/cross-org/prejoin-invitations/claim/route'
import { POST as approveInvitation } from '@/app/api/v1/cross-org/prejoin-invitations/[id]/approve/route'
import { POST as activateInvitation } from '@/app/api/v1/cross-org/prejoin-invitations/[id]/activate/route'
import { POST as recoverInvitation } from '@/app/api/v1/cross-org/prejoin-invitations/[id]/recover/route'
import { POST as revokeInvitation } from '@/app/api/v1/cross-org/prejoin-invitations/[id]/revoke/route'

function makeReq(url: string, body: unknown, opts?: { role?: string; orgId?: string; uid?: string }): NextRequest {
  const req = new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: 'Bearer test', 'x-org-id': opts?.orgId ?? 'owner-org' },
  })
  ;(req as NextRequest & { _testRole?: string })._testRole = opts?.role ?? 'member'
  ;(req as NextRequest & { _testOrgId?: string })._testOrgId = opts?.orgId ?? 'owner-org'
  ;(req as NextRequest & { _testUid?: string })._testUid = opts?.uid
  return req
}

const invitation = {
  id: 'invite-1',
  tokenHash: 'secret-hash',
  ownerOrgId: 'owner-org',
  recipientEmailHash: 'email-hash',
  resourceKey: 'client-document',
  resourceType: 'document',
  resourceId: 'doc-1',
  requestedActions: ['view', 'comment'],
  issuedByRef: { kind: 'user', id: 'owner-admin' },
  recipientIdentityMatched: false,
  status: 'pending',
  expiresAt: new Date('2026-09-01T00:00:00.000Z'),
  createdAt: new Date('2026-08-10T00:00:00.000Z'),
  updatedAt: new Date('2026-08-10T00:00:00.000Z'),
  schemaVersion: 1,
}

describe('cross-org prejoin invitation owning routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLoadPrejoinResourceOwner.mockResolvedValue('owner-org')
    mockLoadActorEmailHash.mockResolvedValue('email-hash')
    mockGetInvitationById.mockResolvedValue(invitation)
    mockIssueInvitation.mockImplementation(async (input: Record<string, unknown>) => ({
      ...invitation,
      id: input.id,
      tokenHash: input.tokenHash,
      ownerOrgId: input.ownerOrgId,
      recipientEmailHash: input.recipientEmailHash,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      requestedActions: input.requestedActions,
      fields: input.fields,
      items: input.items,
      issuedByRef: input.issuedByRef,
      expiresAt: input.expiresAt,
    }))
    mockClaimInvitationByTokenHash.mockResolvedValue({ kind: 'claimed', invitation: { ...invitation, status: 'pending_owner_verification', recipientUserId: 'recipient-user', recipientIdentityMatched: true } })
    mockRecordOwnerApproval.mockResolvedValue({ ...invitation, approvedByRef: { kind: 'user', id: 'owner-admin' } })
    mockActivateInvitation.mockResolvedValue({
      invitation: { ...invitation, status: 'activated' },
      grant: { id: 'prejoin:invite-1', resourceId: 'doc-1', actions: ['view', 'comment'], status: 'active' },
    })
    mockRecoverInvitation.mockImplementation(async (input: Record<string, unknown>) => ({
      source: { ...invitation, status: 'replaced', replacedByInvitationId: input.replacementId },
      replacement: {
        ...invitation,
        id: input.replacementId,
        tokenHash: input.replacementTokenHash,
        status: 'pending',
        recoveryOfInvitationId: input.invitationId,
        issuedByRef: input.issuedByRef,
        expiresAt: input.expiresAt,
      },
    }))
    mockRevokeInvitation.mockResolvedValue({ ...invitation, status: 'revoked' })
    mockRevokeGrantByInvitationId.mockResolvedValue({ id: 'prejoin:invite-1', status: 'revoked' })
  })

  it('issues only for the authenticated owner org after authoritative owner lookup', async () => {
    const res = await issueInvitation(makeReq('http://localhost/api/v1/cross-org/prejoin-invitations', {
      resourceType: 'document',
      resourceId: 'doc-1',
      recipientEmail: 'recipient@example.com',
      requestedActions: ['view', 'comment'],
      fields: ['title'],
      orgId: 'evil-org',
      ownerOrgId: 'evil-org',
    }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.invitation.tokenHash).toBeUndefined()
    expect(typeof body.data.deliveryToken).toBe('string')
    expect(body.data.deliveryToken.length).toBeGreaterThan(20)
    expect(mockLoadPrejoinResourceOwner).toHaveBeenCalledWith('document', 'doc-1')
    expect(mockIssueInvitation).toHaveBeenCalledWith(expect.objectContaining({
      ownerOrgId: 'owner-org',
      resourceType: 'document',
      resourceId: 'doc-1',
      requestedActions: ['view', 'comment'],
      fields: ['title'],
      issuedByRef: { kind: 'user', id: 'owner-admin' },
    }))
  })

  it('rejects issue when the resource is missing or owned by another org', async () => {
    mockLoadPrejoinResourceOwner.mockResolvedValueOnce(null)
    const missing = await issueInvitation(makeReq('http://localhost/api/v1/cross-org/prejoin-invitations', {
      resourceType: 'document',
      resourceId: 'missing',
      recipientEmail: 'recipient@example.com',
      requestedActions: ['view'],
    }))
    expect(missing.status).toBe(404)
    expect(mockIssueInvitation).not.toHaveBeenCalled()

    mockLoadPrejoinResourceOwner.mockResolvedValueOnce('other-org')
    const foreign = await issueInvitation(makeReq('http://localhost/api/v1/cross-org/prejoin-invitations', {
      resourceType: 'document',
      resourceId: 'doc-1',
      recipientEmail: 'recipient@example.com',
      requestedActions: ['view'],
    }))
    expect(foreign.status).toBe(403)
    expect(mockIssueInvitation).not.toHaveBeenCalled()
  })

  it('keeps conversation/support/service non-issuable at the route boundary', async () => {
    for (const resourceType of ['conversation', 'support', 'service']) {
      const res = await issueInvitation(makeReq('http://localhost/api/v1/cross-org/prejoin-invitations', {
        resourceType,
        resourceId: `${resourceType}-1`,
        recipientEmail: 'recipient@example.com',
        requestedActions: ['view'],
      }))
      expect(res.status).toBe(400)
    }
    expect(mockIssueInvitation).not.toHaveBeenCalled()
  })

  it('claims with verified actor email hash and never mutates on identity mismatch', async () => {
    mockClaimInvitationByTokenHash.mockResolvedValueOnce({ kind: 'identity_mismatch', invitation })
    const mismatch = await claimInvitation(makeReq('http://localhost/api/v1/cross-org/prejoin-invitations/claim', {
      token: 'raw-delivery-token',
    }, { orgId: 'recipient-org', uid: 'wrong-user' }))
    expect(mismatch.status).toBe(403)
    expect(mockClaimInvitationByTokenHash).toHaveBeenCalledWith(expect.objectContaining({
      actor: expect.objectContaining({ id: 'wrong-user', emailHash: 'email-hash', identityVerified: true }),
    }))

    mockClaimInvitationByTokenHash.mockResolvedValueOnce({
      kind: 'claimed',
      invitation: { ...invitation, status: 'pending_owner_verification', recipientUserId: 'recipient-user', recipientIdentityMatched: true, claimedByRef: { kind: 'user', id: 'recipient-user' } },
    })
    const claimed = await claimInvitation(makeReq('http://localhost/api/v1/cross-org/prejoin-invitations/claim', {
      token: 'raw-delivery-token',
    }, { orgId: 'recipient-org', uid: 'recipient-user' }))
    expect(claimed.status).toBe(200)
    const body = await claimed.json()
    expect(body.data.kind).toBe('claimed')
    expect(body.data.invitation.tokenHash).toBeUndefined()
    expect(body.data.invitation.recipientUserId).toBe('recipient-user')
  })

  it('records owner approval only for the owner org and never trusts body recipient identity', async () => {
    const foreign = await approveInvitation(
      makeReq('http://localhost/api/v1/cross-org/prejoin-invitations/invite-1/approve', {
        recipientUserId: 'attacker',
      }, { orgId: 'recipient-org', uid: 'recipient-user' }),
      { params: Promise.resolve({ id: 'invite-1' }) },
    )
    expect(foreign.status).toBe(403)
    expect(mockRecordOwnerApproval).not.toHaveBeenCalled()

    const approved = await approveInvitation(
      makeReq('http://localhost/api/v1/cross-org/prejoin-invitations/invite-1/approve', {
        recipientUserId: 'attacker',
      }),
      { params: Promise.resolve({ id: 'invite-1' }) },
    )
    expect(approved.status).toBe(200)
    expect(mockRecordOwnerApproval).toHaveBeenCalledWith({
      invitationId: 'invite-1',
      approvedByRef: { kind: 'user', id: 'owner-admin' },
      ownerAuthorized: true,
    })
  })

  it('activates using invitation recipient identity and authoritative owner verification', async () => {
    mockGetInvitationById.mockResolvedValueOnce({
      ...invitation,
      status: 'pending_owner_verification',
      recipientUserId: 'recipient-user',
      recipientIdentityMatched: true,
      approvedByRef: { kind: 'user', id: 'owner-admin' },
    })
    const res = await activateInvitation(
      makeReq('http://localhost/api/v1/cross-org/prejoin-invitations/invite-1/activate', {
        partnerLinkId: 'link-1',
        recipientOrgId: 'recipient-org',
        recipientUserId: 'attacker',
        ownerVerifierAuthorized: true,
      }),
      { params: Promise.resolve({ id: 'invite-1' }) },
    )
    expect(res.status).toBe(200)
    expect(mockActivateInvitation).toHaveBeenCalledWith(expect.objectContaining({
      invitationId: 'invite-1',
      partnerLinkId: 'link-1',
      recipientOrgId: 'recipient-org',
      recipientUserId: 'recipient-user',
      ownerVerifiedByRef: { kind: 'user', id: 'owner-admin' },
      ownerVerifierAuthorized: true,
    }))
    const body = await res.json()
    expect(body.data.grant.id).toBe('prejoin:invite-1')
    expect(body.data.invitation.tokenHash).toBeUndefined()
  })

  it('recovers and revokes through owner-only routes with safe projections', async () => {
    const recovered = await recoverInvitation(
      makeReq('http://localhost/api/v1/cross-org/prejoin-invitations/invite-1/recover', {
        expiresAt: '2026-10-01T00:00:00.000Z',
      }),
      { params: Promise.resolve({ id: 'invite-1' }) },
    )
    expect(recovered.status).toBe(200)
    const recoveredBody = await recovered.json()
    expect(recoveredBody.data.source.tokenHash).toBeUndefined()
    expect(recoveredBody.data.replacement.tokenHash).toBeUndefined()
    expect(typeof recoveredBody.data.deliveryToken).toBe('string')
    expect(mockRecoverInvitation).toHaveBeenCalledWith(expect.objectContaining({
      invitationId: 'invite-1',
      issuedByRef: { kind: 'user', id: 'owner-admin' },
    }))

    mockGetInvitationById.mockResolvedValueOnce({ ...invitation, status: 'activated' })
    const revoked = await revokeInvitation(
      makeReq('http://localhost/api/v1/cross-org/prejoin-invitations/invite-1/revoke', {
        reason: 'withdrawn',
      }),
      { params: Promise.resolve({ id: 'invite-1' }) },
    )
    expect(revoked.status).toBe(200)
    expect(mockRevokeGrantByInvitationId).toHaveBeenCalledWith(expect.objectContaining({
      invitationId: 'invite-1',
      actorOrgId: 'owner-org',
      reason: 'withdrawn',
    }))
    expect(mockRevokeInvitation).not.toHaveBeenCalled()
  })
})
