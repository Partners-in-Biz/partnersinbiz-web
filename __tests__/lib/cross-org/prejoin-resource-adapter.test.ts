import {
  claimPrejoinResourceInvitation,
  createPrejoinResourceInvitation,
  expirePrejoinResourceInvitation,
  materializePrejoinResourceGrant,
  recordPrejoinOwnerApproval,
  recoverPrejoinResourceInvitation,
  revokePrejoinResourceInvitation,
  resolvePrejoinResourceAdapter,
} from '@/lib/cross-org/prejoin-resource-adapter'

const RECIPIENT_EMAIL_HASH = 'recipient-email-hash'
const now = new Date('2026-08-10T00:00:00.000Z')

function createInvite(overrides: Record<string, unknown> = {}) {
  return createPrejoinResourceInvitation({
    id: 'invite-1', tokenHash: 'initial-token-hash', ownerOrgId: 'owner-org', recipientEmailHash: RECIPIENT_EMAIL_HASH,
    resourceType: 'document', resourceId: 'document-1', requestedActions: ['view', 'comment'], fields: ['title', 'blocks'], items: ['version-1'],
    issuedByRef: { kind: 'user', id: 'issuer-user' }, expiresAt: new Date('2026-09-01T00:00:00.000Z'), now, ...overrides,
  })
}

function activationEvidence(overrides: Record<string, unknown> = {}) {
  return {
    ownerVerifierAuthorized: true, linkActive: true, linkOwnerOrgId: 'owner-org', linkRecipientOrgId: 'recipient-org',
    scopeActive: true, scopePartnerLinkId: 'link-1', scopeGrantorOrgId: 'owner-org', scopeGranteeOrgId: 'recipient-org',
    recipientMembershipActive: true, ...overrides,
  }
}

function claimedInvite() {
  return claimPrejoinResourceInvitation({
    invitation: createInvite(), actor: { kind: 'user', id: 'recipient-user', emailHash: RECIPIENT_EMAIL_HASH, identityVerified: true },
    now: new Date('2026-08-11T00:00:00.000Z'),
  }).invitation
}

describe('pre-join resource invitation adapter', () => {
  it('requires a hashed secret, valid timestamps, exact resource, and explicit supported actions', () => {
    expect(() => createInvite({ tokenHash: undefined })).toThrow('token hash')
    expect(() => createInvite({ expiresAt: new Date('invalid') })).toThrow('valid expiry')
    expect(() => createInvite({ now: new Date('invalid') })).toThrow('valid current time')
    expect(resolvePrejoinResourceAdapter('quote', ['view'])).toBeNull()
    expect(resolvePrejoinResourceAdapter('client-document', ['view', 'comment'])?.resourceType).toBe('document')
    expect(resolvePrejoinResourceAdapter('campaign', ['view', 'review_draft'])).toBeNull()
    expect(resolvePrejoinResourceAdapter('research', ['export'])).toBeNull()
    expect(resolvePrejoinResourceAdapter('conversation', ['view'])).toBeNull()
    expect(resolvePrejoinResourceAdapter('support-ticket', ['view'])).toBeNull()
    expect(resolvePrejoinResourceAdapter('service-workspace', ['view'])).toBeNull()
  })

  it('binds the claim to stored scope and does not let a mismatched token holder consume it', () => {
    const invite = createInvite()
    const mismatch = claimPrejoinResourceInvitation({
      invitation: invite, actor: { kind: 'user', id: 'attacker', emailHash: 'wrong', identityVerified: true }, now: new Date('2026-08-11T00:00:00.000Z'),
      untrustedRequest: { resourceId: 'other', requestedActions: ['approve'], ownerOrgId: 'attacker-org' },
    })
    expect(mismatch).toEqual({ kind: 'identity_mismatch', invitation: invite })
    const claimed = claimPrejoinResourceInvitation({
      invitation: mismatch.invitation, actor: { kind: 'user', id: 'recipient-user', emailHash: RECIPIENT_EMAIL_HASH, identityVerified: true }, now: new Date('2026-08-11T00:00:00.000Z'),
    })
    expect(claimed).toEqual(expect.objectContaining({ kind: 'claimed' }))
    expect(claimed.invitation).toEqual(expect.objectContaining({ resourceId: 'document-1', ownerOrgId: 'owner-org', recipientUserId: 'recipient-user', recipientIdentityMatched: true }))
  })

  it('records on-behalf approval only through authenticated owner authority and never impersonates the recipient', () => {
    const approved = recordPrejoinOwnerApproval({ invitation: createInvite(), approvedByRef: { kind: 'user', id: 'owner-admin' }, ownerAuthorized: true, now: new Date('2026-08-11T00:00:00.000Z') })
    expect(approved).toEqual(expect.objectContaining({ approvedByRef: { kind: 'user', id: 'owner-admin' }, status: 'pending', recipientIdentityMatched: false }))
    expect(() => recordPrejoinOwnerApproval({ invitation: createInvite(), approvedByRef: { kind: 'user', id: 'attacker' }, ownerAuthorized: false, now })).toThrow('authorized owner')
  })

  it('materializes only after live owner, link, directional scope, and recipient membership evidence', () => {
    const claimed = claimedInvite()
    const input = {
      invitation: claimed, partnerLinkId: 'link-1', scopeAgreementId: 'scope-1', recipientOrgId: 'recipient-org', recipientUserId: 'recipient-user',
      ownerVerifiedByRef: { kind: 'user' as const, id: 'owner-user' }, now: new Date('2026-08-12T00:00:00.000Z'),
    }
    expect(() => materializePrejoinResourceGrant({ ...input, evidence: activationEvidence({ scopeActive: false }) })).toThrow('live bilateral')
    expect(() => materializePrejoinResourceGrant({ ...input, evidence: activationEvidence({ linkRecipientOrgId: 'other-org' }) })).toThrow('live bilateral')
    expect(() => materializePrejoinResourceGrant({ ...input, evidence: activationEvidence({ recipientMembershipActive: false }) })).toThrow('live bilateral')
    const result = materializePrejoinResourceGrant({ ...input, evidence: activationEvidence() })
    expect(result.grant).toEqual(expect.objectContaining({
      id: 'prejoin:invite-1', ownerOrgId: 'owner-org', resourceType: 'document', resourceId: 'document-1', actions: ['view', 'comment'],
      fields: ['title', 'blocks'], items: ['version-1'], grantee: { orgIds: ['recipient-org'], userIds: ['recipient-user'], teamIds: [] },
      provenance: { sourceInviteId: 'invite-1' }, status: 'active',
    }))
    expect(result.invitation.status).toBe('activated')
    expect(() => revokePrejoinResourceInvitation({ invitation: result.invitation, revokedByRef: { kind: 'user', id: 'owner-user' }, reason: 'remove', now: input.now })).toThrow('canonical grant lifecycle')
  })

  it('fails closed on expiry or revocation and returns source/replacement atomically for recovery', () => {
    const invite = createInvite()
    expect(claimPrejoinResourceInvitation({ invitation: { ...invite, expiresAt: new Date('invalid') }, actor: { kind: 'user', id: 'recipient-user', emailHash: RECIPIENT_EMAIL_HASH, identityVerified: true }, now }).kind).toBe('unavailable')
    const revoked = revokePrejoinResourceInvitation({ invitation: invite, revokedByRef: { kind: 'user', id: 'owner-user' }, reason: 'requested', now })
    expect(claimPrejoinResourceInvitation({ invitation: revoked, actor: { kind: 'user', id: 'recipient-user', emailHash: RECIPIENT_EMAIL_HASH, identityVerified: true }, now }).kind).toBe('unavailable')
    const expired = expirePrejoinResourceInvitation({ invitation: invite, now: new Date('2026-09-02T00:00:00.000Z') })
    const recovered = recoverPrejoinResourceInvitation({ invitation: expired, id: 'invite-2', tokenHash: 'replacement-token-hash', issuedByRef: { kind: 'user', id: 'owner-user' }, expiresAt: new Date('2026-10-01T00:00:00.000Z'), now: new Date('2026-09-03T00:00:00.000Z') })
    expect(recovered.source).toEqual(expect.objectContaining({ status: 'replaced', replacedByInvitationId: 'invite-2' }))
    expect(recovered.replacement).toEqual(expect.objectContaining({ id: 'invite-2', recoveryOfInvitationId: 'invite-1', status: 'pending' }))
    expect(() => recoverPrejoinResourceInvitation({ invitation: recovered.source, id: 'invite-3', tokenHash: 'second', issuedByRef: { kind: 'user', id: 'owner-user' }, expiresAt: new Date('2026-11-01T00:00:00.000Z'), now: new Date('2026-09-04T00:00:00.000Z') })).toThrow('only expired or revoked')
  })
})
