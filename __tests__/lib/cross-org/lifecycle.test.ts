import {
  canTransition,
  planLinkUnlinkCascade,
  planCapabilityReductionCascade,
  evaluateExpiry,
  requiredCapabilityForActions,
  PARTNER_LINK_TRANSITIONS,
  SCOPE_AGREEMENT_TRANSITIONS,
  RESOURCE_GRANT_TRANSITIONS,
} from '@/lib/cross-org/lifecycle'
import type {
  PartnerLink,
  PartnerResourceGrant,
  PartnerScopeAgreement,
} from '@/lib/cross-org/types'

const NOW = new Date('2026-08-09T12:00:00Z')

const LINK: PartnerLink = {
  id: 'link-doc-1',
  partnerLinkId: 'link-1',
  orgA: 'org-a',
  orgB: 'org-b',
  relationshipIdA: 'rel-a',
  relationshipIdB: 'rel-b',
  negotiableCapabilities: ['documents', 'projects', 'invoices'],
  status: 'active',
  schemaVersion: 1,
  createdAt: NOW,
  updatedAt: NOW,
}

const AGREEMENT: PartnerScopeAgreement = {
  id: 'scope-ab',
  partnerLinkId: 'link-1',
  direction: { grantorOrgId: 'org-a', granteeOrgId: 'org-b' },
  capabilities: ['documents', 'projects'],
  fieldSharingPolicy: {},
  status: 'active',
  version: 1,
  schemaVersion: 1,
  createdAt: NOW,
  updatedAt: NOW,
}

function grant(id: string, overrides: Partial<PartnerResourceGrant> = {}): PartnerResourceGrant {
  return {
    id,
    partnerLinkId: 'link-1',
    scopeAgreementId: 'scope-ab',
    ownerOrgId: 'org-a',
    resourceType: 'document',
    resourceId: 'doc-1',
    grantee: { orgIds: ['org-b'], userIds: [], teamIds: [] },
    actions: ['view'],
    status: 'active',
    provenance: {},
    approvalBasis: { type: 'scope_agreement', refId: 'scope-ab' },
    createdAt: NOW,
    updatedAt: NOW,
    schemaVersion: 1,
    ...overrides,
  }
}

describe('lifecycle state machines', () => {
  it('enforces valid link transitions', () => {
    expect(canTransition(PARTNER_LINK_TRANSITIONS, 'active', 'paused')).toBe(true)
    expect(canTransition(PARTNER_LINK_TRANSITIONS, 'active', 'revoked')).toBe(true)
    expect(canTransition(PARTNER_LINK_TRANSITIONS, 'paused', 'active')).toBe(true)
    expect(canTransition(PARTNER_LINK_TRANSITIONS, 'revoked', 'active')).toBe(false)
    expect(canTransition(PARTNER_LINK_TRANSITIONS, 'revoked', 'archived')).toBe(true)
  })

  it('enforces valid scope agreement transitions', () => {
    expect(canTransition(SCOPE_AGREEMENT_TRANSITIONS, 'proposed', 'active')).toBe(true)
    expect(canTransition(SCOPE_AGREEMENT_TRANSITIONS, 'active', 'revoked')).toBe(true)
    expect(canTransition(SCOPE_AGREEMENT_TRANSITIONS, 'active', 'expired')).toBe(true)
    expect(canTransition(SCOPE_AGREEMENT_TRANSITIONS, 'revoked', 'active')).toBe(false)
  })

  it('enforces valid grant transitions', () => {
    expect(canTransition(RESOURCE_GRANT_TRANSITIONS, 'active', 'paused')).toBe(true)
    expect(canTransition(RESOURCE_GRANT_TRANSITIONS, 'paused', 'active')).toBe(true)
    expect(canTransition(RESOURCE_GRANT_TRANSITIONS, 'active', 'expired')).toBe(true)
    expect(canTransition(RESOURCE_GRANT_TRANSITIONS, 'expired', 'active')).toBe(false)
  })
})

describe('planLinkUnlinkCascade', () => {
  it('revokes agreements, grants and identity links on the link', () => {
    const plan = planLinkUnlinkCascade({
      link: LINK,
      agreements: [AGREEMENT, { ...AGREEMENT, id: 'scope-other', partnerLinkId: 'link-2' }],
      grants: [
        grant('grant-1'),
        grant('grant-2', { status: 'revoked' }),
        grant('grant-3', { partnerLinkId: 'link-2', scopeAgreementId: 'scope-other' }),
      ],
      identityLinkIds: ['ident-1', 'ident-2'],
    })

    expect(plan.revokeAgreementIds).toEqual(['scope-ab'])
    expect(plan.revokeGrantIds).toEqual(['grant-1'])
    expect(plan.keepGrantIds).toEqual(['grant-2', 'grant-3'])
    expect(plan.revokeIdentityLinkIds).toEqual(['ident-1', 'ident-2'])
    expect(plan.events.some((e) => e.eventType === 'scope_agreement.revoked')).toBe(true)
    expect(plan.events.some((e) => e.eventType === 'resource_grant.revoked')).toBe(true)
  })

  it('revokes grants that ride on a revoked agreement even without the link id', () => {
    const orphanGrant = grant('grant-orphan', {
      partnerLinkId: undefined,
      scopeAgreementId: 'scope-ab',
    })
    const plan = planLinkUnlinkCascade({
      link: LINK,
      agreements: [AGREEMENT],
      grants: [orphanGrant],
      identityLinkIds: [],
    })
    expect(plan.revokeGrantIds).toContain('grant-orphan')
  })
})

describe('planCapabilityReductionCascade', () => {
  it('revokes grants whose capability was removed', () => {
    const docGrant = grant('grant-doc', { actions: ['document.read'] })
    const plan = planCapabilityReductionCascade({
      agreement: AGREEMENT,
      removedCapabilities: ['documents'],
      grants: [docGrant],
    })
    expect(plan.revokeGrantIds).toEqual(['grant-doc'])
    expect(plan.events.some((e) => e.eventType === 'capability.reduced')).toBe(true)
  })

  it('revokes research/property grants when their scoped capability is removed even with generic actions', () => {
    const researchGrant = grant('grant-research', {
      resourceType: 'research', resourceId: 'research-1', actions: ['view'],
    })
    const propertyGrant = grant('grant-property', {
      resourceType: 'property', resourceId: 'property-1', actions: ['comment'],
    })
    const plan = planCapabilityReductionCascade({
      agreement: AGREEMENT,
      removedCapabilities: ['research', 'properties'],
      grants: [researchGrant, propertyGrant],
    })
    expect(plan.revokeGrantIds).toEqual(['grant-research', 'grant-property'])
  })

  it('keeps grants that do not depend on the removed capability', () => {
    const projectGrant = grant('grant-proj', {
      actions: ['project.read'],
      resourceType: 'project',
      resourceId: 'proj-1',
    })
    const plan = planCapabilityReductionCascade({
      agreement: AGREEMENT,
      removedCapabilities: ['documents'],
      grants: [projectGrant],
    })
    expect(plan.keepGrantIds).toEqual(['grant-proj'])
    expect(plan.revokeGrantIds).toEqual([])
  })

  it('freezes instead of revoking when freeze capability is set', () => {
    const docGrant = grant('grant-doc', { actions: ['document.read'] })
    const plan = planCapabilityReductionCascade({
      agreement: AGREEMENT,
      removedCapabilities: ['documents'],
      grants: [docGrant],
      freezeCapabilities: ['documents'],
    })
    expect(plan.freezeGrantIds).toEqual(['grant-doc'])
    expect(plan.revokeGrantIds).toEqual([])
  })

  it('revokes grants whose narrowed field was granted', () => {
    const plan = planCapabilityReductionCascade({
      agreement: AGREEMENT,
      removedCapabilities: [],
      narrowedFields: ['bankDetails'],
      grants: [grant('grant-field', { fields: ['bankDetails'] })],
    })
    expect(plan.revokeGrantIds).toEqual(['grant-field'])
  })
})

describe('evaluateExpiry', () => {
  it('flags expired grants', () => {
    const past = new Date(NOW.getTime() - 60_000)
    expect(evaluateExpiry({ status: 'active', expiresAt: past, now: NOW })).toEqual({
      status: 'expired',
      expired: true,
    })
  })

  it('keeps active grants before expiry', () => {
    const future = new Date(NOW.getTime() + 60_000)
    expect(evaluateExpiry({ status: 'active', expiresAt: future, now: NOW })).toEqual({
      status: 'active',
      expired: false,
    })
  })

  it('handles Firestore Timestamp shape', () => {
    const past = new Date(NOW.getTime() - 60_000)
    const ts = { seconds: Math.floor(past.getTime() / 1000) }
    expect(evaluateExpiry({ status: 'active', expiresAt: ts, now: NOW }).expired).toBe(true)
  })

  it('does not resurrect revoked grants', () => {
    const future = new Date(NOW.getTime() + 60_000)
    expect(evaluateExpiry({ status: 'revoked', expiresAt: future, now: NOW })).toEqual({
      status: 'revoked',
      expired: false,
    })
  })
})

describe('requiredCapabilityForActions', () => {
  it('maps module actions to capability families', () => {
    expect(requiredCapabilityForActions(['document.read'])).toBe('documents')
    expect(requiredCapabilityForActions(['invoice.write'])).toBe('invoices')
    expect(requiredCapabilityForActions(['order.read'])).toBe('orders')
    expect(requiredCapabilityForActions(['unknown.action'])).toBeUndefined()
  })
})
