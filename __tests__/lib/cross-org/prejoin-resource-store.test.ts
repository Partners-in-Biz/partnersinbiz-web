import {
  InMemoryPrejoinResourceStore,
  PrejoinResourceService,
} from '@/lib/cross-org/prejoin-resource-store'
import { InMemoryCrossOrgPolicyStore } from '@/lib/cross-org/policy-service'
import type { PartnerLink, PartnerScopeAgreement } from '@/lib/cross-org/types'

const NOW = new Date('2026-08-10T12:00:00.000Z')
const LATER = new Date('2026-08-11T12:00:00.000Z')

const LINK: PartnerLink = {
  id: 'link-1',
  partnerLinkId: 'link-1',
  orgA: 'owner-org',
  orgB: 'recipient-org',
  relationshipIdA: 'rel-a',
  relationshipIdB: 'rel-b',
  negotiableCapabilities: ['documents', 'projects', 'research', 'properties'],
  status: 'active',
  schemaVersion: 1,
  createdAt: NOW,
  updatedAt: NOW,
}

const SCOPE: PartnerScopeAgreement = {
  id: 'scope-1',
  partnerLinkId: 'link-1',
  direction: { grantorOrgId: 'owner-org', granteeOrgId: 'recipient-org' },
  capabilities: ['documents', 'projects', 'research', 'properties'],
  fieldSharingPolicy: { documents: true, research: true, properties: true },
  status: 'active',
  version: 1,
  schemaVersion: 1,
  acceptance: {
    grantor: { byRef: { uid: 'owner-admin', displayName: 'Owner Admin', kind: 'human' }, at: NOW },
    grantee: { byRef: { uid: 'recipient-admin', displayName: 'Recipient Admin', kind: 'human' }, at: NOW },
  },
  createdAt: NOW,
  updatedAt: NOW,
}

function makeService() {
  const invitationStore = new InMemoryPrejoinResourceStore()
  const policyStore = new InMemoryCrossOrgPolicyStore()
  policyStore.seedLink(LINK)
  policyStore.seedRelationships([
    { id: 'rel-a', sourceOrgId: 'owner-org', targetOrgId: 'recipient-org', partnerLinkId: 'link-1', status: 'active', deleted: false },
    { id: 'rel-b', sourceOrgId: 'recipient-org', targetOrgId: 'owner-org', partnerLinkId: 'link-1', status: 'active', deleted: false },
  ])
  policyStore.seedScopeAgreement(SCOPE)
  policyStore.seedMembership('recipient-org', 'recipient-user', 'member')
  return {
    invitationStore,
    policyStore,
    service: new PrejoinResourceService({ invitationStore, policyStore }),
  }
}

describe('PrejoinResourceService', () => {
  it('issues exact-resource invitations idempotently and keeps non-issuable adapters fail-closed', async () => {
    const { service } = makeService()

    const first = await service.issueInvitation({
      id: 'invite-1',
      tokenHash: 'token-hash-1',
      ownerOrgId: 'owner-org',
      recipientEmailHash: 'recipient-email-hash',
      resourceType: 'document',
      resourceId: 'doc-1',
      requestedActions: ['comment', 'view', 'comment'],
      fields: ['blocks', 'title'],
      items: ['version-1'],
      issuedByRef: { kind: 'user', id: 'issuer-user' },
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      now: NOW,
    })

    const replay = await service.issueInvitation({
      id: 'invite-2',
      tokenHash: 'replacement-token-hash',
      ownerOrgId: 'owner-org',
      recipientEmailHash: 'recipient-email-hash',
      resourceType: 'document',
      resourceId: 'doc-1',
      requestedActions: ['view', 'comment'],
      fields: ['title', 'blocks'],
      items: ['version-1'],
      issuedByRef: { kind: 'user', id: 'issuer-user' },
      expiresAt: new Date('2026-09-02T00:00:00.000Z'),
      now: LATER,
    })

    expect(replay.id).toBe(first.id)
    expect(replay.tokenHash).toBe('token-hash-1')
    await expect(service.issueInvitation({
      id: 'invite-conversation',
      tokenHash: 'token-hash-conversation',
      ownerOrgId: 'owner-org',
      recipientEmailHash: 'recipient-email-hash',
      resourceType: 'conversation',
      resourceId: 'conv-1',
      requestedActions: ['view'],
      issuedByRef: { kind: 'user', id: 'issuer-user' },
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      now: NOW,
    })).rejects.toThrow('supported resource')
  })

  it('claims only the verified recipient identity, records owner approval separately, and keeps mismatches non-consuming', async () => {
    const { service } = makeService()
    await service.issueInvitation({
      id: 'invite-1',
      tokenHash: 'token-hash-1',
      ownerOrgId: 'owner-org',
      recipientEmailHash: 'recipient-email-hash',
      resourceType: 'document',
      resourceId: 'doc-1',
      requestedActions: ['view', 'comment'],
      issuedByRef: { kind: 'user', id: 'issuer-user' },
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      now: NOW,
    })

    const mismatch = await service.claimInvitationByTokenHash({
      tokenHash: 'token-hash-1',
      actor: { kind: 'user', id: 'wrong-user', emailHash: 'wrong-hash', identityVerified: true },
      now: LATER,
    })
    expect(mismatch.kind).toBe('identity_mismatch')
    expect(mismatch.invitation.claimedByRef).toBeUndefined()

    const claimed = await service.claimInvitationByTokenHash({
      tokenHash: 'token-hash-1',
      actor: { kind: 'user', id: 'recipient-user', emailHash: 'recipient-email-hash', identityVerified: true },
      now: LATER,
    })
    expect(claimed.kind).toBe('claimed')
    expect(claimed.invitation).toEqual(expect.objectContaining({
      recipientUserId: 'recipient-user',
      recipientIdentityMatched: true,
      claimedByRef: { kind: 'user', id: 'recipient-user' },
      status: 'pending_owner_verification',
    }))

    const approved = await service.recordOwnerApproval({
      invitationId: 'invite-1',
      approvedByRef: { kind: 'user', id: 'owner-admin' },
      ownerAuthorized: true,
      now: new Date('2026-08-12T12:00:00.000Z'),
    })
    expect(approved).toEqual(expect.objectContaining({
      approvedByRef: { kind: 'user', id: 'owner-admin' },
      recipientUserId: 'recipient-user',
      claimedByRef: { kind: 'user', id: 'recipient-user' },
    }))
  })

  it('materializes the exact requested grant only after authoritative evidence and activation is idempotent', async () => {
    const { service, invitationStore } = makeService()
    await service.issueInvitation({
      id: 'invite-1',
      tokenHash: 'token-hash-1',
      ownerOrgId: 'owner-org',
      recipientEmailHash: 'recipient-email-hash',
      resourceType: 'document',
      resourceId: 'research-1',
      requestedActions: ['view', 'comment'],
      fields: ['title', 'summary'],
      items: ['finding-1'],
      issuedByRef: { kind: 'user', id: 'issuer-user' },
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      now: NOW,
    })
    await service.claimInvitationByTokenHash({
      tokenHash: 'token-hash-1',
      actor: { kind: 'user', id: 'recipient-user', emailHash: 'recipient-email-hash', identityVerified: true },
      now: LATER,
    })
    await service.recordOwnerApproval({
      invitationId: 'invite-1',
      approvedByRef: { kind: 'user', id: 'owner-admin' },
      ownerAuthorized: true,
      now: new Date('2026-08-12T00:00:00.000Z'),
    })

    const first = await service.activateInvitation({
      invitationId: 'invite-1',
      partnerLinkId: 'link-1',
      recipientOrgId: 'recipient-org',
      recipientUserId: 'recipient-user',
      ownerVerifiedByRef: { kind: 'user', id: 'owner-admin' },
      ownerVerifierAuthorized: true,
      now: new Date('2026-08-13T00:00:00.000Z'),
    })

    expect(first.grant).toEqual(expect.objectContaining({
      id: 'prejoin:invite-1',
      resourceType: 'document',
      resourceId: 'research-1',
      actions: ['view', 'comment'],
      fields: ['title', 'summary'],
      items: ['finding-1'],
      grantee: { orgIds: ['recipient-org'], userIds: ['recipient-user'], teamIds: [] },
      provenance: { sourceInviteId: 'invite-1' },
      approvalBasis: { type: 'scope_agreement', refId: 'scope-1' },
      status: 'active',
    }))
    expect(first.invitation).toEqual(expect.objectContaining({
      status: 'activated',
      approvedByRef: { kind: 'user', id: 'owner-admin' },
      claimedByRef: { kind: 'user', id: 'recipient-user' },
      ownerVerifiedByRef: { kind: 'user', id: 'owner-admin' },
      recipientUserId: 'recipient-user',
    }))
    expect(invitationStore.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'resource_grant.created', resourceGrantId: 'prejoin:invite-1', resourceId: 'research-1' }),
    ]))

    const replay = await service.activateInvitation({
      invitationId: 'invite-1',
      partnerLinkId: 'link-1',
      recipientOrgId: 'recipient-org',
      recipientUserId: 'recipient-user',
      ownerVerifiedByRef: { kind: 'user', id: 'owner-admin' },
      ownerVerifierAuthorized: true,
      now: new Date('2026-08-14T00:00:00.000Z'),
    })
    expect(replay.grant).toEqual(first.grant)
    expect(invitationStore.auditEvents.filter((event) => event.eventType === 'resource_grant.created')).toHaveLength(1)
  })

  it('recovers expired invitations idempotently with source and replacement lineage', async () => {
    const { service } = makeService()
    await service.issueInvitation({
      id: 'invite-1',
      tokenHash: 'token-hash-1',
      ownerOrgId: 'owner-org',
      recipientEmailHash: 'recipient-email-hash',
      resourceType: 'document',
      resourceId: 'quote-1',
      requestedActions: ['view'],
      issuedByRef: { kind: 'user', id: 'issuer-user' },
      expiresAt: new Date('2026-08-11T00:00:00.000Z'),
      now: NOW,
    })

    await service.claimInvitationByTokenHash({
      tokenHash: 'token-hash-1',
      actor: { kind: 'user', id: 'recipient-user', emailHash: 'recipient-email-hash', identityVerified: true },
      now: new Date('2026-08-12T00:00:00.000Z'),
    })

    const recovered = await service.recoverInvitation({
      invitationId: 'invite-1',
      replacementId: 'invite-2',
      replacementTokenHash: 'token-hash-2',
      issuedByRef: { kind: 'user', id: 'owner-admin' },
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      now: new Date('2026-08-13T00:00:00.000Z'),
    })
    expect(recovered.source).toEqual(expect.objectContaining({ status: 'replaced', replacedByInvitationId: 'invite-2' }))
    expect(recovered.replacement).toEqual(expect.objectContaining({ id: 'invite-2', recoveryOfInvitationId: 'invite-1', status: 'pending' }))

    const replay = await service.recoverInvitation({
      invitationId: 'invite-1',
      replacementId: 'invite-3',
      replacementTokenHash: 'token-hash-3',
      issuedByRef: { kind: 'user', id: 'owner-admin' },
      expiresAt: new Date('2026-10-01T00:00:00.000Z'),
      now: new Date('2026-08-14T00:00:00.000Z'),
    })
    expect(replay).toEqual(recovered)
  })

  it('revokes pending invitations directly and activated grants by source invitation id', async () => {
    const { service, invitationStore } = makeService()
    await service.issueInvitation({
      id: 'invite-pending',
      tokenHash: 'token-hash-pending',
      ownerOrgId: 'owner-org',
      recipientEmailHash: 'recipient-email-hash',
      resourceType: 'document',
      resourceId: 'property-1',
      requestedActions: ['view', 'comment'],
      issuedByRef: { kind: 'user', id: 'issuer-user' },
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      now: NOW,
    })

    const revokedInvite = await service.revokeInvitation({
      invitationId: 'invite-pending',
      revokedByRef: { kind: 'user', id: 'owner-admin' },
      reason: 'withdrawn',
      now: new Date('2026-08-12T00:00:00.000Z'),
    })
    expect(revokedInvite.status).toBe('revoked')

    await service.issueInvitation({
      id: 'invite-active',
      tokenHash: 'token-hash-active',
      ownerOrgId: 'owner-org',
      recipientEmailHash: 'recipient-email-hash',
      resourceType: 'document',
      resourceId: 'property-2',
      requestedActions: ['view'],
      issuedByRef: { kind: 'user', id: 'issuer-user' },
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      now: NOW,
    })
    await service.claimInvitationByTokenHash({
      tokenHash: 'token-hash-active',
      actor: { kind: 'user', id: 'recipient-user', emailHash: 'recipient-email-hash', identityVerified: true },
      now: LATER,
    })
    await service.recordOwnerApproval({
      invitationId: 'invite-active',
      approvedByRef: { kind: 'user', id: 'owner-admin' },
      ownerAuthorized: true,
      now: new Date('2026-08-12T00:00:00.000Z'),
    })
    await service.activateInvitation({
      invitationId: 'invite-active',
      partnerLinkId: 'link-1',
      recipientOrgId: 'recipient-org',
      recipientUserId: 'recipient-user',
      ownerVerifiedByRef: { kind: 'user', id: 'owner-admin' },
      ownerVerifierAuthorized: true,
      now: new Date('2026-08-13T00:00:00.000Z'),
    })

    const firstGrantRevocation = await service.revokeGrantByInvitationId({
      invitationId: 'invite-active',
      revokedByRef: { uid: 'owner-admin', displayName: 'Owner Admin', kind: 'human' },
      actorOrgId: 'owner-org',
      reason: 'scope removed',
      now: new Date('2026-08-14T00:00:00.000Z'),
    })
    expect(firstGrantRevocation?.status).toBe('revoked')

    const replayGrantRevocation = await service.revokeGrantByInvitationId({
      invitationId: 'invite-active',
      revokedByRef: { uid: 'owner-admin', displayName: 'Owner Admin', kind: 'human' },
      actorOrgId: 'owner-org',
      reason: 'scope removed',
      now: new Date('2026-08-15T00:00:00.000Z'),
    })
    expect(replayGrantRevocation).toEqual(firstGrantRevocation)
    expect(invitationStore.auditEvents.filter((event) => event.eventType === 'resource_grant.revoked')).toHaveLength(1)
  })
})
