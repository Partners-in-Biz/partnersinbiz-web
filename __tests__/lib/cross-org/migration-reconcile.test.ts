import {
  applyMigrationPlan,
  assertNoNewLegacyAliasCombination,
  buildCanonicalMigrationPlan,
  buildMigrationEvidence,
  planCanonicalOwnerFieldBackfill,
  type CanonicalMigrationSnapshot,
} from '@/lib/cross-org/migration'

function emptySnapshot(overrides: Partial<CanonicalMigrationSnapshot> = {}): CanonicalMigrationSnapshot {
  return {
    relationships: [],
    shares: [],
    existingLinks: [],
    existingGrants: [],
    existingIdentityLinks: [],
    existingAgreements: [],
    resources: [],
    crmIdentityRows: [],
    orphanModuleRecords: {},
    ...overrides,
  }
}

describe('buildCanonicalMigrationPlan (dry-run-first)', () => {
  it('defaults to dry-run mode and never marks destructive', () => {
    const plan = buildCanonicalMigrationPlan(emptySnapshot())
    expect(plan.mode).toBe('dry-run')
    expect(plan.destructive).toBe(false)
    expect(plan.operations).toEqual([])
    expect(plan.summary.planned).toBe(0)
  })

  it('plans partner link promotion for an active mirrored pair', () => {
    const plan = buildCanonicalMigrationPlan(
      emptySnapshot({
        relationships: [
          {
            id: 'rel-a',
            sourceOrgId: 'org-a',
            targetOrgId: 'org-b',
            partnerLinkId: 'link-1',
            status: 'active',
            sharedCapabilities: ['projects'],
          },
          {
            id: 'rel-b',
            sourceOrgId: 'org-b',
            targetOrgId: 'org-a',
            partnerLinkId: 'link-1',
            status: 'active',
            sharedCapabilities: ['projects'],
          },
        ],
      }),
    )
    const op = plan.operations.find((item) => item.kind === 'promote_partner_link')
    expect(op).toBeDefined()
    expect(op?.decision).toBe('plan')
    expect(op?.collection).toBe('partnerLinks')
    expect(op?.after).toMatchObject({
      partnerLinkId: 'link-1',
      orgA: 'org-a',
      orgB: 'org-b',
      status: 'active',
    })
    expect(op?.rollback).toMatchObject({ action: 'delete', collection: 'partnerLinks' })
  })

  it('no-ops when the canonical partner link already matches', () => {
    const plan = buildCanonicalMigrationPlan(
      emptySnapshot({
        relationships: [
          {
            id: 'rel-a',
            sourceOrgId: 'org-a',
            targetOrgId: 'org-b',
            partnerLinkId: 'link-1',
            status: 'active',
          },
          {
            id: 'rel-b',
            sourceOrgId: 'org-b',
            targetOrgId: 'org-a',
            partnerLinkId: 'link-1',
            status: 'active',
          },
        ],
        existingLinks: [
          {
            id: 'link-1',
            partnerLinkId: 'link-1',
            orgA: 'org-a',
            orgB: 'org-b',
            relationshipIdA: 'rel-a',
            relationshipIdB: 'rel-b',
            negotiableCapabilities: ['projects'],
            status: 'active',
            schemaVersion: 1,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          },
        ],
      }),
    )
    const op = plan.operations.find((item) => item.kind === 'promote_partner_link')
    expect(op?.decision).toBe('noop')
  })

  it('surfaces partner-link contradictions instead of silently merging', () => {
    const plan = buildCanonicalMigrationPlan(
      emptySnapshot({
        relationships: [
          {
            id: 'rel-a',
            sourceOrgId: 'org-a',
            targetOrgId: 'org-b',
            partnerLinkId: 'link-1',
            status: 'active',
          },
          {
            id: 'rel-b',
            sourceOrgId: 'org-b',
            targetOrgId: 'org-a',
            partnerLinkId: 'link-1',
            status: 'active',
          },
        ],
        existingLinks: [
          {
            id: 'link-1',
            partnerLinkId: 'link-1',
            orgA: 'org-a',
            orgB: 'org-c',
            relationshipIdA: 'rel-old-a',
            relationshipIdB: 'rel-old-c',
            negotiableCapabilities: [],
            status: 'active',
            schemaVersion: 1,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          },
        ],
      }),
    )
    expect(plan.contradictions.some((c) => c.code === 'partner_link_org_mismatch')).toBe(true)
    const op = plan.operations.find((item) => item.kind === 'promote_partner_link')
    expect(op?.decision).toBe('contradiction')
    expect(plan.summary.contradictions).toBeGreaterThan(0)
  })

  it('plans resource grant promotion with provenance and access-preserving actions', () => {
    const plan = buildCanonicalMigrationPlan(
      emptySnapshot({
        shares: [
          {
            id: 'share-1',
            partnerLinkId: 'link-1',
            resourceType: 'project',
            resourceId: 'proj-1',
            partnerOrgId: 'org-b',
            ownerOrgId: 'org-a',
            permission: 'comment',
            status: 'active',
          },
        ],
      }),
    )
    const op = plan.operations.find((item) => item.kind === 'promote_resource_grant')
    expect(op?.decision).toBe('plan')
    expect(op?.after).toMatchObject({
      id: 'share-1',
      ownerOrgId: 'org-a',
      resourceId: 'proj-1',
      actions: ['view', 'comment'],
      provenance: { sourceShareId: 'share-1' },
    })
    expect(op?.preservesAccess).toBe(true)
  })

  it('surfaces grant owner contradictions instead of rewriting owner', () => {
    const plan = buildCanonicalMigrationPlan(
      emptySnapshot({
        shares: [
          {
            id: 'share-1',
            partnerLinkId: 'link-1',
            resourceType: 'project',
            resourceId: 'proj-1',
            partnerOrgId: 'org-b',
            ownerOrgId: 'org-a',
            status: 'active',
          },
        ],
        existingGrants: [
          {
            id: 'share-1',
            partnerLinkId: 'link-1',
            ownerOrgId: 'org-other',
            resourceType: 'project',
            resourceId: 'proj-1',
            grantee: { orgIds: ['org-b'], userIds: [], teamIds: [] },
            actions: ['view'],
            status: 'active',
            provenance: { sourceShareId: 'share-1' },
            approvalBasis: { type: 'partner_link', refId: 'link-1' },
            createdAt: new Date(0),
            updatedAt: new Date(0),
            schemaVersion: 1,
          },
        ],
      }),
    )
    expect(plan.contradictions.some((c) => c.code === 'resource_grant_owner_mismatch')).toBe(true)
    expect(plan.operations.find((o) => o.kind === 'promote_resource_grant')?.decision).toBe('contradiction')
  })

  it('plans identity join seeding as unverified without expanding access', () => {
    const plan = buildCanonicalMigrationPlan(
      emptySnapshot({
        crmIdentityRows: [
          {
            companyId: 'co-1',
            contactId: 'ct-1',
            pointers: { linkedOrgId: 'org-client', linkedUserId: 'user-1' },
          },
        ],
      }),
    )
    const identityOps = plan.operations.filter((o) => o.kind === 'seed_identity_link')
    expect(identityOps.length).toBe(3)
    expect(identityOps.every((o) => o.decision === 'plan')).toBe(true)
    expect(identityOps.every((o) => (o.after as { status?: string }).status === 'unverified')).toBe(true)
    expect(identityOps.every((o) => o.preservesAccess)).toBe(true)
  })

  it('surfaces identity target contradictions against verified links', () => {
    const plan = buildCanonicalMigrationPlan(
      emptySnapshot({
        crmIdentityRows: [
          {
            companyId: 'co-1',
            pointers: { linkedOrgId: 'org-new' },
          },
        ],
        existingIdentityLinks: [
          {
            id: 'id-1',
            linkType: 'company_org',
            sourceRef: { kind: 'company', id: 'co-1' },
            targetRef: { kind: 'org', id: 'org-old' },
            status: 'verified',
            provenance: {},
            schemaVersion: 1,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          },
        ],
      }),
    )
    expect(plan.contradictions.some((c) => c.code === 'identity_pointer_conflicts_verified')).toBe(true)
    const op = plan.operations.find((o) => o.kind === 'seed_identity_link')
    expect(op?.decision).toBe('contradiction')
  })

  it('plans bilateral acceptance backfill without silent single-side activation', () => {
    const plan = buildCanonicalMigrationPlan(
      emptySnapshot({
        existingAgreements: [
          {
            id: 'sa-1',
            partnerLinkId: 'link-1',
            direction: { grantorOrgId: 'org-a', granteeOrgId: 'org-b' },
            capabilities: ['projects'],
            fieldSharingPolicy: {} as never,
            status: 'proposed',
            version: 1,
            schemaVersion: 1,
            acceptedByRef: { type: 'user', id: 'user-a' } as never,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          },
        ],
        relationships: [
          {
            id: 'rel-a',
            sourceOrgId: 'org-a',
            targetOrgId: 'org-b',
            partnerLinkId: 'link-1',
            status: 'active',
            acceptedByUid: 'user-a',
          },
          {
            id: 'rel-b',
            sourceOrgId: 'org-b',
            targetOrgId: 'org-a',
            partnerLinkId: 'link-1',
            status: 'active',
            acceptedByUid: 'user-b',
          },
        ],
      }),
    )
    const op = plan.operations.find((o) => o.kind === 'backfill_scope_acceptance')
    expect(op?.decision).toBe('plan')
    expect(op?.after).toMatchObject({
      acceptance: {
        grantor: { byRef: expect.objectContaining({ uid: 'user-a' }) },
        grantee: { byRef: expect.objectContaining({ uid: 'user-b' }) },
      },
    })
    // Migration must not silently flip activation when evidence is only backfill
    // of acceptance sides — status remains caller-controlled unless both sides
    // already match bilateral acceptance and were intended active.
    expect((op?.after as { status?: string }).status).toBe('proposed')
  })

  it('reports orphans as evidence ops without destructive delete', () => {
    const plan = buildCanonicalMigrationPlan(
      emptySnapshot({
        orphanModuleRecords: {
          shares: ['share-orphan-1'],
          project_grants: ['proj-org-1'],
        },
        orphanTrigger: {
          type: 'link.unlinked',
          partnerLinkId: 'link-dead',
        },
      }),
    )
    const orphans = plan.operations.filter((o) => o.kind === 'report_orphan')
    expect(orphans).toHaveLength(2)
    expect(orphans.every((o) => o.decision === 'plan')).toBe(true)
    expect(orphans.every((o) => o.destructive !== true)).toBe(true)
    expect(plan.auditEvents.some((e) => e.eventType === 'orphan.detected')).toBe(true)
  })

  it('plans canonical owner field backfill when owner is unambiguous', () => {
    const plan = buildCanonicalMigrationPlan(
      emptySnapshot({
        resources: [
          {
            id: 'proj-1',
            resourceType: 'project',
            orgId: 'org-owner',
            // missing sourceOrgId / ownerOrgId
          },
        ],
      }),
    )
    const op = plan.operations.find((o) => o.kind === 'backfill_canonical_owner')
    expect(op?.decision).toBe('plan')
    expect(op?.after).toMatchObject({
      ownerOrgId: 'org-owner',
      sourceOrgId: 'org-owner',
      orgId: 'org-owner',
    })
    expect(op?.rollback).toBeDefined()
  })

  it('surfaces owner-field contradictions instead of silent merge', () => {
    const plan = buildCanonicalMigrationPlan(
      emptySnapshot({
        resources: [
          {
            id: 'inv-1',
            resourceType: 'invoice',
            orgId: 'org-a',
            sourceOrgId: 'org-b',
            ownerOrgId: 'org-c',
          },
        ],
      }),
    )
    expect(plan.contradictions.some((c) => c.code === 'canonical_owner_conflict')).toBe(true)
    expect(plan.operations.find((o) => o.kind === 'backfill_canonical_owner')?.decision).toBe('contradiction')
  })
})

describe('assertNoNewLegacyAliasCombination', () => {
  it('allows no-op and identity-derived primary pointer sync', () => {
    expect(
      assertNoNewLegacyAliasCombination({
        existing: { linkedOrgId: 'org-a', linkedUserId: 'user-1' },
        proposed: { linkedOrgId: 'org-a', linkedUserId: 'user-1' },
      }).allowed,
    ).toBe(true)

    expect(
      assertNoNewLegacyAliasCombination({
        existing: { linkedOrgId: 'org-old' },
        proposed: { linkedOrgId: 'org-new' },
        source: 'identity_pointer_sync',
      }).allowed,
    ).toBe(true)
  })

  it('blocks new alias combinations outside identity sync', () => {
    const result = assertNoNewLegacyAliasCombination({
      existing: { linkedOrgId: 'org-a' },
      proposed: { linkedOrgId: 'org-a', linkedUserId: 'user-1', allowedOrgIds: ['org-x'] },
      source: 'direct_write',
    })
    expect(result.allowed).toBe(false)
    expect(result.code).toBe('new_legacy_alias_combination_forbidden')
  })

  it('blocks inventing allowedOrgIds/allowedUserIds aliases on direct writes', () => {
    const result = assertNoNewLegacyAliasCombination({
      existing: {},
      proposed: { allowedOrgIds: ['org-x'], allowedUserIds: ['u-1'] },
      source: 'direct_write',
    })
    expect(result.allowed).toBe(false)
  })
})

describe('planCanonicalOwnerFieldBackfill', () => {
  it('fills missing canonical owner fields from the single present owner', () => {
    const result = planCanonicalOwnerFieldBackfill({
      id: 'doc-1',
      resourceType: 'document',
      orgId: 'org-holder',
    })
    expect(result.decision).toBe('plan')
    expect(result.patch).toEqual({
      ownerOrgId: 'org-holder',
      sourceOrgId: 'org-holder',
      orgId: 'org-holder',
    })
  })

  it('no-ops when already canonical', () => {
    const result = planCanonicalOwnerFieldBackfill({
      id: 'doc-1',
      resourceType: 'document',
      orgId: 'org-holder',
      ownerOrgId: 'org-holder',
      sourceOrgId: 'org-holder',
    })
    expect(result.decision).toBe('noop')
  })
})

describe('applyMigrationPlan + evidence', () => {
  it('dry-run apply never mutates and returns re-run/rollback evidence', async () => {
    const plan = buildCanonicalMigrationPlan(
      emptySnapshot({
        shares: [
          {
            id: 'share-1',
            partnerLinkId: 'link-1',
            resourceType: 'project',
            resourceId: 'proj-1',
            partnerOrgId: 'org-b',
            ownerOrgId: 'org-a',
            status: 'active',
          },
        ],
      }),
    )
    const writes: string[] = []
    const result = await applyMigrationPlan(plan, {
      mode: 'dry-run',
      write: async (op) => {
        writes.push(op.id)
      },
    })
    expect(result.mode).toBe('dry-run')
    expect(writes).toEqual([])
    expect(result.applied).toHaveLength(0)
    expect(result.wouldApply.length).toBeGreaterThan(0)
    expect(result.evidence.schemaVersion).toBe(1)
    expect(result.evidence.destructive).toBe(false)
    expect(result.evidence.accessPreserving).toBe(true)
    expect(result.evidence.reRunKey).toEqual(expect.any(String))
    expect(result.evidence.rollbackOps.length).toBeGreaterThan(0)
  })

  it('apply mode only writes planned non-contradiction ops and records evidence', async () => {
    const plan = buildCanonicalMigrationPlan(
      emptySnapshot({
        shares: [
          {
            id: 'share-1',
            partnerLinkId: 'link-1',
            resourceType: 'project',
            resourceId: 'proj-1',
            partnerOrgId: 'org-b',
            ownerOrgId: 'org-a',
            status: 'active',
          },
        ],
        resources: [
          {
            id: 'bad',
            resourceType: 'invoice',
            orgId: 'org-a',
            sourceOrgId: 'org-b',
          },
        ],
      }),
      { mode: 'apply' },
    )
    const written: string[] = []
    const result = await applyMigrationPlan(plan, {
      mode: 'apply',
      write: async (op) => {
        written.push(op.kind)
      },
    })
    expect(written).toContain('promote_resource_grant')
    expect(written).not.toContain('backfill_canonical_owner')
    expect(result.skippedContradictions.length).toBeGreaterThan(0)
    const evidence = buildMigrationEvidence(plan, result)
    expect(evidence.summary.planned).toBeGreaterThan(0)
    expect(evidence.summary.contradictions).toBeGreaterThan(0)
    expect(evidence.appliedKinds).toContain('promote_resource_grant')
  })
})
