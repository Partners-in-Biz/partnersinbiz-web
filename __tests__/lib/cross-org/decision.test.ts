import {
  evaluatePartnerAccess,
  projectRoleRank,
  orgRoleRank,
  evaluatePartnerCapability,
} from '@/lib/cross-org/decision'
import type {
  PartnerAccessInput,
  PartnerResourceGrant,
  PartnerScopeAgreement,
} from '@/lib/cross-org/types'

const NOW = new Date('2026-08-09T12:00:00Z')

const ACTOR = { userId: 'user-partner-1', orgId: 'org-b' }

const LIVE_RELATIONSHIPS = [
  { id: 'rel-a', sourceOrgId: 'org-a', targetOrgId: 'org-b', partnerLinkId: 'link-1', status: 'active', deleted: false },
  { id: 'rel-b', sourceOrgId: 'org-b', targetOrgId: 'org-a', partnerLinkId: 'link-1', status: 'active', deleted: false },
]

const SCOPE_AB: PartnerScopeAgreement = {
  id: 'scope-ab',
  partnerLinkId: 'link-1',
  direction: { grantorOrgId: 'org-a', granteeOrgId: 'org-b' },
  capabilities: ['documents', 'projects'],
  fieldSharingPolicy: { companyProfile: true, documents: true, projects: true, commerce: false },
  status: 'active',
  version: 1,
  schemaVersion: 1,
  createdAt: NOW,
  updatedAt: NOW,
}

function grant(overrides: Partial<PartnerResourceGrant> = {}): PartnerResourceGrant {
  return {
    id: 'grant-1',
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

function baseInput(overrides: Partial<PartnerAccessInput> = {}): PartnerAccessInput {
  return {
    actor: ACTOR,
    resourceType: 'document',
    resourceId: 'doc-1',
    action: 'view',
    partnerLinkId: 'link-1',
    requiredCapability: 'documents',
    scopeAgreement: SCOPE_AB,
    grant: grant(),
    relationships: LIVE_RELATIONSHIPS,
    membershipActive: true,
    now: NOW,
    ...overrides,
  }
}

describe('evaluatePartnerAccess decision chain', () => {
  it('allows a fully valid cross-org read', () => {
    const decision = evaluatePartnerAccess(baseInput())
    expect(decision.allowed).toBe(true)
    expect(decision.chain.every((s) => s.passed)).toBe(true)
  })

  it('denies when the actor has no active membership', () => {
    const decision = evaluatePartnerAccess(baseInput({ membershipActive: false }))
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('active membership')
    const membershipStep = decision.chain.find((s) => s.step === 'active_membership')
    expect(membershipStep?.passed).toBe(false)
  })

  it('denies when the reciprocal link rows are not both active', () => {
    const broken = [
      { ...LIVE_RELATIONSHIPS[0] },
      { ...LIVE_RELATIONSHIPS[1], status: 'revoked' },
    ]
    const decision = evaluatePartnerAccess(baseInput({ relationships: broken }))
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('reciprocal partner link')
  })

  it('denies when a relationship row is deleted', () => {
    const broken = [
      { ...LIVE_RELATIONSHIPS[0], deleted: true },
      { ...LIVE_RELATIONSHIPS[1] },
    ]
    const decision = evaluatePartnerAccess(baseInput({ relationships: broken }))
    expect(decision.allowed).toBe(false)
  })

  it('denies when the link does not cover the actor org', () => {
    const wrong = [
      { id: 'rel-x', sourceOrgId: 'org-c', targetOrgId: 'org-d', partnerLinkId: 'link-1', status: 'active' },
      { id: 'rel-y', sourceOrgId: 'org-d', targetOrgId: 'org-c', partnerLinkId: 'link-1', status: 'active' },
    ]
    const decision = evaluatePartnerAccess(baseInput({ relationships: wrong }))
    expect(decision.allowed).toBe(false)
  })

  it('denies when the required capability is not on the scope agreement', () => {
    const decision = evaluatePartnerAccess(
      baseInput({ requiredCapability: 'analytics' }),
    )
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('capability analytics required')
  })

  it('denies when the scope agreement is not active', () => {
    const decision = evaluatePartnerAccess(
      baseInput({ scopeAgreement: { ...SCOPE_AB, status: 'revoked' } }),
    )
    expect(decision.allowed).toBe(false)
  })

  it('denies when the scope agreement direction does not cover the actor org', () => {
    const reversed = {
      ...SCOPE_AB,
      direction: { grantorOrgId: 'org-b', granteeOrgId: 'org-a' },
    }
    const decision = evaluatePartnerAccess(baseInput({ scopeAgreement: reversed }))
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('direction')
  })

  it('denies when the grant is not active', () => {
    const decision = evaluatePartnerAccess(baseInput({ grant: grant({ status: 'revoked' }) }))
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('grant')
  })

  it('denies when the grant does not cover the actor org/user/team', () => {
    const decision = evaluatePartnerAccess(
      baseInput({ grant: grant({ grantee: { orgIds: ['org-c'], userIds: [], teamIds: [] } }) }),
    )
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('does not cover actor')
  })

  it('allows when the grant covers the actor user directly', () => {
    const decision = evaluatePartnerAccess(
      baseInput({ grant: grant({ grantee: { orgIds: [], userIds: ['user-partner-1'], teamIds: [] } }) }),
    )
    expect(decision.allowed).toBe(true)
  })

  it('denies when the grant is expired', () => {
    const past = new Date(NOW.getTime() - 60_000)
    const decision = evaluatePartnerAccess(baseInput({ grant: grant({ expiresAt: past }) }))
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('expired')
  })

  it('denies when the grant role is insufficient', () => {
    const decision = evaluatePartnerAccess(
      baseInput({ grant: grant({ role: 'owner' }), actorRole: 'viewer', roleRank: orgRoleRank }),
    )
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('role owner required')
  })

  it('allows when the grant role is satisfied (project role rank)', () => {
    const decision = evaluatePartnerAccess(
      baseInput({
        grant: grant({ role: 'contributor' }),
        actorRole: 'manager',
        roleRank: projectRoleRank,
      }),
    )
    expect(decision.allowed).toBe(true)
  })

  it('denies when the action is not in the grant allowlist', () => {
    const decision = evaluatePartnerAccess(baseInput({ action: 'write' }))
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('action write not granted')
  })

  it('denies when the field is not in the grant field allowlist', () => {
    const decision = evaluatePartnerAccess(
      baseInput({ grant: grant({ fields: ['title'] }), field: 'bankDetails' }),
    )
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('field bankDetails not granted')
  })

  it('denies when the item is not in the grant item allowlist', () => {
    const decision = evaluatePartnerAccess(
      baseInput({ grant: grant({ items: ['a'] }), item: 'b' }),
    )
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('item b not granted')
  })

  it('requires a grant for cross-org access when none is supplied', () => {
    const decision = evaluatePartnerAccess(baseInput({ grant: undefined }))
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('resource grant required for cross-org access')
  })

  it('allows within-org access with active membership and no grant/link', () => {
    const decision = evaluatePartnerAccess(
      baseInput({
        partnerLinkId: undefined,
        requiredCapability: undefined,
        scopeAgreement: undefined,
        grant: undefined,
        relationships: undefined,
        context: 'within_org',
      }),
    )
    expect(decision.allowed).toBe(true)
  })

  it('short-circuits platform admins only within their own org', () => {
    const decision = evaluatePartnerAccess(
      baseInput({
        actor: { userId: 'admin-1', orgId: 'org-a', platformAdmin: true },
        context: 'within_org',
        partnerLinkId: undefined,
        requiredCapability: undefined,
        scopeAgreement: undefined,
        grant: undefined,
        relationships: undefined,
        membershipActive: false,
      }),
    )
    expect(decision.allowed).toBe(true)
  })

  it('does NOT let a platform admin skip the chain for cross-org access', () => {
    const decision = evaluatePartnerAccess(
      baseInput({
        actor: { userId: 'admin-1', orgId: 'org-b', platformAdmin: true },
        context: 'cross_org_grant',
        membershipActive: false,
      }),
    )
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('active membership')
  })

  it('records every step in the chain on both allow and deny', () => {
    const allowed = evaluatePartnerAccess(baseInput())
    expect(allowed.chain.map((s) => s.step)).toEqual([
      'actor',
      'active_membership',
      'reciprocal_link',
      'capability',
      'resource_grant',
      'user_role',
      'action_field',
      'lifecycle',
    ])
    const denied = evaluatePartnerAccess(baseInput({ membershipActive: false }))
    expect(denied.chain.some((s) => s.step === 'actor' && s.passed)).toBe(true)
    expect(denied.chain.some((s) => s.step === 'active_membership' && !s.passed)).toBe(true)
  })
})

describe('evaluatePartnerCapability', () => {
  it('allows when membership, live link and scope agreement all hold', () => {
    const decision = evaluatePartnerCapability({
      actorOrgId: 'org-b',
      partnerLinkId: 'link-1',
      relationships: LIVE_RELATIONSHIPS,
      scopeAgreement: SCOPE_AB,
      requiredCapability: 'documents',
      membershipActive: true,
    })
    expect(decision.allowed).toBe(true)
  })

  it('denies when the capability is missing', () => {
    const decision = evaluatePartnerCapability({
      actorOrgId: 'org-b',
      partnerLinkId: 'link-1',
      relationships: LIVE_RELATIONSHIPS,
      scopeAgreement: SCOPE_AB,
      requiredCapability: 'invoices',
      membershipActive: true,
    })
    expect(decision.allowed).toBe(false)
  })
})
