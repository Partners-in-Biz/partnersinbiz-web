import {
  CrossOrgPolicyService,
  InMemoryCrossOrgPolicyStore,
  buildSafeProjection,
  projectResourceRecord,
  reasonCodeFromDecision,
} from '@/lib/cross-org/policy-service'
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
  negotiableCapabilities: ['documents', 'projects'],
  status: 'active',
  schemaVersion: 1,
  createdAt: NOW,
  updatedAt: NOW,
}

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

function seededStore(overrides: {
  grant?: PartnerResourceGrant | null
  scope?: PartnerScopeAgreement | null
  link?: PartnerLink | null
  relationships?: Array<Record<string, unknown>>
} = {}) {
  const store = new InMemoryCrossOrgPolicyStore()
  store.seedMembership('org-b', 'user-partner-1', 'member')
  store.seedLink('link' in overrides ? (overrides.link ?? undefined) : LINK)
  store.seedRelationships(overrides.relationships ?? LIVE_RELATIONSHIPS)
  if ('scope' in overrides) {
    if (overrides.scope) store.seedScopeAgreement(overrides.scope)
  } else {
    store.seedScopeAgreement(SCOPE_AB)
  }
  if ('grant' in overrides) {
    if (overrides.grant) store.seedGrant(overrides.grant)
  } else {
    store.seedGrant(grant())
  }
  return store
}

function baseInput(overrides: Partial<Parameters<CrossOrgPolicyService['decide']>[0]> = {}) {
  return {
    actor: { userId: 'user-partner-1', orgId: 'org-b' },
    resourceType: 'document' as const,
    resourceId: 'doc-1',
    action: 'view',
    partnerLinkId: 'link-1',
    requiredCapability: 'documents' as const,
    now: NOW,
    ...overrides,
  }
}

describe('CrossOrgPolicyService — adapter contract', () => {
  it('allows a fully valid cross-org read and returns an ALLOWED reason code', async () => {
    const service = new CrossOrgPolicyService(seededStore())
    const result = await service.decide(baseInput())
    expect(result.allowed).toBe(true)
    expect(result.reasonCode).toBe('ALLOWED')
    expect(result.chain.every((s) => s.passed)).toBe(true)
    expect(result.projection).toEqual({ fields: null, items: null })
  })

  it('denies an active legacy grant with no stored scope agreement instead of adopting a newer active scope', async () => {
    const service = new CrossOrgPolicyService(seededStore({
      grant: grant({ scopeAgreementId: undefined, approvalBasis: { type: 'partner_link', refId: 'link-1' } }),
    }))

    const result = await service.decide(baseInput())

    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('SCOPE_AGREEMENT_REQUIRED')
  })

  it('denies a grant that is bound to a different scope agreement than the active directional scope', async () => {
    const service = new CrossOrgPolicyService(seededStore({
      grant: grant({ scopeAgreementId: 'scope-revoked', approvalBasis: { type: 'scope_agreement', refId: 'scope-revoked' } }),
    }))

    const result = await service.decide(baseInput())

    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('SCOPE_AGREEMENT_REQUIRED')
  })

  it('denies when the actor has no active membership with ACTIVE_MEMBERSHIP_REQUIRED', async () => {
    const store = seededStore()
    store.memberships.clear()
    const service = new CrossOrgPolicyService(store)
    const result = await service.decide(baseInput())
    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('ACTIVE_MEMBERSHIP_REQUIRED')
  })

  it('denies when the canonical link doc is missing with RECIPROCAL_LINK_REQUIRED', async () => {
    const store = seededStore({ link: null })
    const service = new CrossOrgPolicyService(store)
    const result = await service.decide(baseInput())
    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('RECIPROCAL_LINK_REQUIRED')
    expect(result.chain.some((s) => s.step === 'reciprocal_link' && !s.passed)).toBe(true)
  })

  it('denies when the canonical link doc is revoked even with stale active relationship rows', async () => {
    const store = seededStore({ link: { ...LINK, status: 'revoked' } })
    const service = new CrossOrgPolicyService(store)
    const result = await service.decide(baseInput())
    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('RECIPROCAL_LINK_REQUIRED')
  })

  it('denies when the link does not cover the actor org', async () => {
    const store = seededStore({ link: { ...LINK, orgA: 'org-x', orgB: 'org-y' } })
    const service = new CrossOrgPolicyService(store)
    const result = await service.decide(baseInput())
    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('RECIPROCAL_LINK_REQUIRED')
  })

  it('denies when the reciprocal relationship rows are not both active', async () => {
    const broken = [
      { ...LIVE_RELATIONSHIPS[0] },
      { ...LIVE_RELATIONSHIPS[1], status: 'revoked' },
    ]
    const store = seededStore({ relationships: broken })
    const service = new CrossOrgPolicyService(store)
    const result = await service.decide(baseInput())
    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('RECIPROCAL_LINK_REQUIRED')
  })

  it('denies when the directional scope agreement is missing with SCOPE_AGREEMENT_REQUIRED', async () => {
    const store = seededStore({ scope: null })
    const service = new CrossOrgPolicyService(store)
    const result = await service.decide(baseInput())
    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('SCOPE_AGREEMENT_REQUIRED')
  })

  it('denies when the required capability is not shared', async () => {
    const store = seededStore({ scope: { ...SCOPE_AB, capabilities: ['projects'] } })
    const service = new CrossOrgPolicyService(store)
    const result = await service.decide(baseInput())
    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('CAPABILITY_REQUIRED')
  })

  it('denies when the scope agreement is expired (lazy expiry)', async () => {
    const expired = new Date(NOW.getTime() - 60_000)
    const store = seededStore({ scope: { ...SCOPE_AB, expiresAt: expired } })
    const service = new CrossOrgPolicyService(store)
    const result = await service.decide(baseInput())
    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('SCOPE_AGREEMENT_REQUIRED')
  })

  it('denies when the resource grant is missing with RESOURCE_GRANT_REQUIRED', async () => {
    const store = seededStore({ grant: null })
    const service = new CrossOrgPolicyService(store)
    const result = await service.decide(baseInput())
    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('RESOURCE_GRANT_REQUIRED')
  })

  it('denies when the grant is revoked with GRANT_NOT_ACTIVE', async () => {
    const store = seededStore({ grant: grant({ status: 'revoked' }) })
    const service = new CrossOrgPolicyService(store)
    const result = await service.decide(baseInput())
    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('GRANT_NOT_ACTIVE')
  })

  it('denies when the grant is expired with GRANT_EXPIRED (lazy expiry + pure chain)', async () => {
    const past = new Date(NOW.getTime() - 60_000)
    const store = seededStore({ grant: grant({ expiresAt: past }) })
    const service = new CrossOrgPolicyService(store)
    const result = await service.decide(baseInput())
    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('GRANT_EXPIRED')
  })

  it('denies when the grant does not cover the actor org/user/team', async () => {
    const store = seededStore({
      grant: grant({ grantee: { orgIds: ['org-c'], userIds: [], teamIds: [] } }),
    })
    const service = new CrossOrgPolicyService(store)
    const result = await service.decide(baseInput())
    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('RESOURCE_GRANT_REQUIRED')
  })

  it('allows when the grant covers the actor user directly', async () => {
    const store = seededStore({
      grant: grant({ grantee: { orgIds: [], userIds: ['user-partner-1'], teamIds: [] } }),
    })
    const service = new CrossOrgPolicyService(store)
    const result = await service.decide(baseInput())
    expect(result.allowed).toBe(true)
    expect(result.resourceGrantId).toBe('grant-1')
  })

  it('requires an exact user grant for a named-user collaboration decision', async () => {
    const store = seededStore({
      grant: grant({ grantee: { orgIds: ['org-b'], userIds: [], teamIds: [] } }),
    })
    const service = new CrossOrgPolicyService(store)
    const denied = await service.decide(baseInput({ requireNamedUser: true }))
    expect(denied).toEqual(expect.objectContaining({ allowed: false, reasonCode: 'NAMED_USER_GRANT_REQUIRED' }))

    const directStore = seededStore({
      grant: grant({ grantee: { orgIds: ['org-b'], userIds: ['user-partner-1'], teamIds: [] } }),
    })
    const allowed = await new CrossOrgPolicyService(directStore).decide(baseInput({ requireNamedUser: true }))
    expect(allowed.allowed).toBe(true)
  })

  it('denies a grant that does not belong to the immutable module resource owner', async () => {
    const store = seededStore({ grant: grant({ ownerOrgId: 'org-a' }) })
    const result = await new CrossOrgPolicyService(store).decide(baseInput({ resourceOwnerOrgId: 'org-c' }))
    expect(result).toEqual(expect.objectContaining({ allowed: false, reasonCode: 'RESOURCE_OWNER_MISMATCH' }))
    expect(store.auditEvents[0]?.decision).toBe('denied')
  })

  it('denies when the grant role is insufficient with ROLE_REQUIRED', async () => {
    const store = seededStore({ grant: grant({ role: 'owner' }) })
    const service = new CrossOrgPolicyService(store)
    const result = await service.decide(baseInput({ actorRole: 'viewer' }))
    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('ROLE_REQUIRED')
  })

  it('denies when the action is not in the grant allowlist with ACTION_NOT_GRANTED', async () => {
    const service = new CrossOrgPolicyService(seededStore())
    const result = await service.decide(baseInput({ action: 'write' }))
    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('ACTION_NOT_GRANTED')
  })

  it('denies when the field is not in the grant allowlist with FIELD_NOT_GRANTED', async () => {
    const store = seededStore({ grant: grant({ fields: ['title'] }) })
    const service = new CrossOrgPolicyService(store)
    const result = await service.decide(baseInput({ field: 'bankDetails' }))
    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('FIELD_NOT_GRANTED')
  })

  it('denies when the item is not in the grant allowlist with ITEM_NOT_GRANTED', async () => {
    const store = seededStore({ grant: grant({ items: ['v1'] }) })
    const service = new CrossOrgPolicyService(store)
    const result = await service.decide(baseInput({ item: 'v2' }))
    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('ITEM_NOT_GRANTED')
  })

  it('denies when the scope field policy hides the requested field with FIELD_NOT_SHARED', async () => {
    const narrowedScope = { ...SCOPE_AB, fieldSharingPolicy: { companyProfile: true, documents: true, projects: true, commerce: false, 'document.bankDetails': false } }
    const store = seededStore({ scope: narrowedScope, grant: grant({ fields: ['title', 'bankDetails'] }) })
    const service = new CrossOrgPolicyService(store)
    const result = await service.decide(baseInput({ field: 'bankDetails' }))
    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('FIELD_NOT_SHARED')
  })

  it('allows within-org access with active membership and no link/grant required', async () => {
    const store = new InMemoryCrossOrgPolicyStore()
    store.seedMembership('org-a', 'owner-1', 'owner')
    const service = new CrossOrgPolicyService(store)
    const result = await service.decide({
      actor: { userId: 'owner-1', orgId: 'org-a' },
      resourceType: 'document',
      resourceId: 'doc-own',
      action: 'view',
      now: NOW,
    })
    expect(result.allowed).toBe(true)
    expect(result.reasonCode).toBe('ALLOWED')
    expect(result.partnerLinkId).toBeUndefined()
  })

  it('emits an append-only access.decided audit event on allow and deny with no foreign payload', async () => {
    const store = seededStore()
    const service = new CrossOrgPolicyService(store)

    const denied = await service.decide(baseInput({ action: 'write' }))
    expect(denied.auditEventId).toBeTruthy()
    const allowed = await service.decide(baseInput())
    expect(allowed.auditEventId).toBeTruthy()

    expect(store.auditEvents).toHaveLength(2)
    const [deniedEvent, allowedEvent] = store.auditEvents
    expect(deniedEvent.eventType).toBe('access.decided')
    expect(deniedEvent.decision).toBe('denied')
    expect(deniedEvent.reason).toBe('action write not granted')
    expect(deniedEvent.actorOrgId).toBe('org-b')
    expect(deniedEvent.resourceType).toBe('document')
    expect(deniedEvent.resourceId).toBe('doc-1')
    expect(allowedEvent.decision).toBe('allowed')
    // No foreign resource payload ever lands in the event.
    expect(JSON.stringify(store.auditEvents)).not.toContain('secretField')
    expect(deniedEvent.hash).toBeTruthy()
    expect(deniedEvent.hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('skips audit emission when recordDecision is false', async () => {
    const store = seededStore()
    const service = new CrossOrgPolicyService(store)
    await service.decide(baseInput({ recordDecision: false }))
    expect(store.auditEvents).toHaveLength(0)
  })

  it('returns a safe projection with grant field allowlists', async () => {
    const store = seededStore({
      grant: grant({ fields: ['title', 'body'], items: ['v1'] }),
    })
    const service = new CrossOrgPolicyService(store)
    const result = await service.decide(baseInput())
    expect(result.allowed).toBe(true)
    expect(result.projection).toEqual({ fields: ['title', 'body'], items: ['v1'] })
  })
})

describe('buildSafeProjection', () => {
  it('returns null allowlists when the grant has no field/item restrictions', () => {
    const projection = buildSafeProjection(grant(), SCOPE_AB)
    expect(projection).toEqual({ fields: null, items: null })
  })

  it('returns the grant allowlist and drops fields the scope policy hides', () => {
    const narrowedScope = { ...SCOPE_AB, fieldSharingPolicy: { companyProfile: true, documents: true, projects: true, commerce: false, 'document.bankDetails': false } }
    const projection = buildSafeProjection(grant({ fields: ['title', 'bankDetails'] }), narrowedScope)
    expect(projection.fields).toEqual(['title'])
  })
})

describe('projectResourceRecord', () => {
  it('keeps only grant-allowed fields and filters items', () => {
    const record = {
      title: 'Shared doc',
      body: 'Body',
      bankDetails: 'secret',
      items: [{ id: 'v1', label: 'v1' }, { id: 'v2', label: 'v2' }],
    }
    const projection = buildSafeProjection(grant({ fields: ['title', 'body'], items: ['v1'] }), SCOPE_AB)
    const projected = projectResourceRecord(record, projection)
    expect(projected).toEqual({ title: 'Shared doc', body: 'Body', items: [{ id: 'v1', label: 'v1' }] })
    expect(projected).not.toHaveProperty('bankDetails')
  })

  it('never mutates the source record', () => {
    const record = { title: 'Shared doc', bankDetails: 'secret' }
    projectResourceRecord(record, buildSafeProjection(grant({ fields: ['title'] }), SCOPE_AB))
    expect(record).toHaveProperty('bankDetails')
  })
})

describe('reasonCodeFromDecision', () => {
  it('maps each failing chain step to its stable code', () => {
    const cases: Array<[Parameters<typeof reasonCodeFromDecision>[0], string]> = [
      [{ allowed: true, chain: [{ step: 'actor', passed: true }] }, 'ALLOWED'],
      [{ allowed: false, chain: [{ step: 'actor', passed: false, detail: 'actor userId/orgId required' }] }, 'ACTOR_IDENTITY_REQUIRED'],
      [{ allowed: false, chain: [{ step: 'active_membership', passed: false, detail: 'no active orgMembers row' }] }, 'ACTIVE_MEMBERSHIP_REQUIRED'],
      [{ allowed: false, chain: [{ step: 'reciprocal_link', passed: false, detail: 'partner link not live' }] }, 'RECIPROCAL_LINK_REQUIRED'],
      [{ allowed: false, chain: [{ step: 'capability', passed: false, detail: 'scope agreement missing or not active' }] }, 'SCOPE_AGREEMENT_REQUIRED'],
      [{ allowed: false, chain: [{ step: 'capability', passed: false, detail: 'capability analytics not shared' }] }, 'CAPABILITY_REQUIRED'],
      [{ allowed: false, chain: [{ step: 'capability', passed: false, detail: 'field bankDetails not shared' }] }, 'FIELD_NOT_SHARED'],
      [{ allowed: false, chain: [{ step: 'resource_grant', passed: false, detail: 'no resource grant for cross-org access' }] }, 'RESOURCE_GRANT_REQUIRED'],
      [{ allowed: false, chain: [{ step: 'resource_grant', passed: false, detail: 'grant status revoked' }] }, 'GRANT_NOT_ACTIVE'],
      [{ allowed: false, chain: [{ step: 'resource_grant', passed: false, detail: 'grant expired' }] }, 'GRANT_EXPIRED'],
      [{ allowed: false, chain: [{ step: 'resource_grant', passed: false, detail: 'grant does not cover actor' }] }, 'GRANT_DOES_NOT_COVER_ACTOR'],
      [{ allowed: false, chain: [{ step: 'resource_grant', passed: false, detail: 'grant does not cover this resource' }] }, 'GRANT_COVERS_OTHER_RESOURCE'],
      [{ allowed: false, chain: [{ step: 'resource_grant', passed: false, detail: 'grant belongs to a different partner link' }] }, 'GRANT_WRONG_LINK'],
      [{ allowed: false, chain: [{ step: 'user_role', passed: false, detail: 'role owner required' }] }, 'ROLE_REQUIRED'],
      [{ allowed: false, chain: [{ step: 'action_field', passed: false, detail: 'action write not granted' }] }, 'ACTION_NOT_GRANTED'],
      [{ allowed: false, chain: [{ step: 'action_field', passed: false, detail: 'field bankDetails not granted' }] }, 'FIELD_NOT_GRANTED'],
      [{ allowed: false, chain: [{ step: 'action_field', passed: false, detail: 'item v2 not granted' }] }, 'ITEM_NOT_GRANTED'],
      [{ allowed: false, chain: [{ step: 'lifecycle', passed: false, detail: 'partner link lifecycle not active' }] }, 'LIFECYCLE_NOT_ACTIVE'],
    ]
    for (const [decision, expected] of cases) {
      expect(reasonCodeFromDecision(decision)).toBe(expected)
    }
  })
})
