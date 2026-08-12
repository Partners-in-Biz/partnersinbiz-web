import {
  getSupportServiceActionPolicy,
  projectServiceWorkspaceForPartner,
  projectSupportForPartner,
  projectSupportMessageForPartner,
  supportServiceRoleRank,
} from '@/lib/cross-org/support-service-adapter'
import { evaluatePartnerAccess } from '@/lib/cross-org/decision'
import {
  claimSupportServiceParticipant,
  inviteSupportServiceParticipant,
  revokeSupportServiceParticipant,
} from '@/lib/cross-org/support-service-collaboration'

describe('support/service cross-org collaboration adapter', () => {
  it('does not expose internal notes or files through a general resource grant', () => {
    expect(getSupportServiceActionPolicy('support', 'internal_note')).toEqual({ allowed: false, reason: 'INTERNAL_ONLY' })
    expect(getSupportServiceActionPolicy('service', 'download_file')).toEqual({ allowed: false, reason: 'FILE_DELIVERY_REQUIRES_FILE_GRANT' })
    expect(getSupportServiceActionPolicy('service', 'unknown')).toEqual({ allowed: false, reason: 'UNSUPPORTED_ACTION' })
  })

  it('requires a named provider user plus provider-manager role for assignment, resolution, participant change, and SLA actions', () => {
    for (const action of ['assign', 'resolve', 'invite_participant', 'revoke_participant', 'update_sla']) {
      expect(getSupportServiceActionPolicy('support', action)).toEqual(expect.objectContaining({ allowed: true, requireNamedUser: true, requiredRole: 'provider_manager' }))
    }
    expect(getSupportServiceActionPolicy('service', 'claim')).toEqual(expect.objectContaining({ allowed: true, requireNamedUser: true, requiredRole: 'provider_agent' }))
    expect(supportServiceRoleRank('provider_manager', 'provider_agent')).toBe(true)
    expect(supportServiceRoleRank('provider_agent', 'provider_manager')).toBe(false)
  })

  it('denies privileged actions covered only by an organisation-wide grant', () => {
    const decision = evaluatePartnerAccess({
      actor: { userId: 'provider-user', orgId: 'provider-org' }, resourceType: 'support', resourceId: 'ticket-1', action: 'assign', partnerLinkId: 'link-1', requiredCapability: 'support', membershipActive: true, requireNamedUser: true,
      relationships: [
        { partnerLinkId: 'link-1', sourceOrgId: 'requester-org', targetOrgId: 'provider-org', status: 'active', deleted: false },
        { partnerLinkId: 'link-1', sourceOrgId: 'provider-org', targetOrgId: 'requester-org', status: 'active', deleted: false },
      ],
      scopeAgreement: { id: 'scope-1', partnerLinkId: 'link-1', direction: { grantorOrgId: 'requester-org', granteeOrgId: 'provider-org' }, capabilities: ['support'], fieldSharingPolicy: {}, status: 'active', version: 1, schemaVersion: 1, createdAt: new Date(), updatedAt: new Date() },
      grant: { id: 'grant-1', partnerLinkId: 'link-1', ownerOrgId: 'requester-org', resourceType: 'support', resourceId: 'ticket-1', grantee: { orgIds: ['provider-org'], userIds: [], teamIds: [] }, actions: ['assign'], status: 'active', provenance: {}, approvalBasis: { type: 'partner_link', refId: 'link-1' }, schemaVersion: 1, createdAt: new Date(), updatedAt: new Date() },
    })
    expect(decision).toEqual(expect.objectContaining({ allowed: false, reason: 'named user grant required' }))
  })

  it('keeps invite, claimant-bound claim, and revocation as explicit durable participant transitions', () => {
    const invited = inviteSupportServiceParticipant({
      participants: [],
      participant: { id: 'participant-1', userId: 'provider-user', orgId: 'provider-org', role: 'provider_agent' },
      invitedByRef: { uid: 'requester-manager', kind: 'human' },
    })
    expect(invited[0]).toEqual(expect.objectContaining({ status: 'invited', role: 'provider_agent' }))
    expect(() => claimSupportServiceParticipant({ participants: invited, participantId: 'participant-1', claimantUserId: 'different-user', now: 'now' })).toThrow('claimant')
    const claimed = claimSupportServiceParticipant({ participants: invited, participantId: 'participant-1', claimantUserId: 'provider-user', now: 'now' })
    expect(claimed[0]).toEqual(expect.objectContaining({ status: 'active', acceptedAt: 'now' }))
    const revoked = revokeSupportServiceParticipant({ participants: claimed, participantId: 'participant-1', revokedByRef: { uid: 'provider-manager', kind: 'human' }, now: 'later' })
    expect(revoked[0]).toEqual(expect.objectContaining({ status: 'revoked', revokedAt: 'later' }))
  })

  it('projects foreign records through safe allowlists only', () => {
    const projection = { fields: null, items: null }
    const ticket = projectSupportForPartner({ id: 'ticket-1', subject: 'Need help', status: 'new', providerOrgId: 'provider', requesterOrgId: 'requester', hermesSummary: 'private diagnostic', contextRefs: ['private'], rawFileUrl: 'https://private', sla: { visibility: 'shared', dueAt: 'tomorrow', escalationPolicy: 'private' } }, projection)
    expect(ticket).toEqual(expect.objectContaining({ id: 'ticket-1', subject: 'Need help', sla: { visibility: 'shared', dueAt: 'tomorrow' } }))
    expect(ticket).not.toHaveProperty('hermesSummary')
    expect(projectSupportMessageForPartner({ id: 'note', kind: 'internal_note', body: 'private' }, projection)).toEqual({})
    expect(projectSupportMessageForPartner({ id: 'comment', kind: 'comment', body: 'safe', attachments: [{ url: 'private' }] }, projection)).toEqual({ id: 'comment', kind: 'comment', body: 'safe' })
    const workspace = projectServiceWorkspaceForPartner({ id: 'service-1', name: 'SEO Sprint', status: 'active', budget: 2000, linkedDocumentIds: ['private'], sla: { visibility: 'requester', dueAt: 'tomorrow', escalationPolicy: 'private' } }, projection)
    expect(workspace).toEqual(expect.objectContaining({ id: 'service-1', name: 'SEO Sprint', sla: { visibility: 'requester', dueAt: 'tomorrow' } }))
    expect(workspace).not.toHaveProperty('budget')
    expect(workspace).not.toHaveProperty('linkedDocumentIds')
  })
})
