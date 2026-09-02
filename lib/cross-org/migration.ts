// lib/cross-org/migration.ts
//
// Migration compatibility rules for the canonical cross-org contracts (ADR:
// docs/architecture/cross-org-access-model.md).
//
// Compatibility contract:
//   - Legacy CRM convenience pointers (linkedOrgId / linkedUserId /
//     allowedOrgIds / allowedUserIds) are READ-ONLY compatibility inputs. They
//     never grant access on their own.
//   - Existing businessRelationships rows that carry a partnerLinkId and
//     status === 'active' are promoted to canonical PartnerLink rows.
//   - Existing partner_record_shares rows are promoted to PartnerResourceGrant
//     rows with provenance.sourceShareId.
//   - linkedOrgId/linkedUserId pointers seed PartnerIdentityLink rows during
//     backfill; they may be removed once migration evidence proves the
//     canonical rows are complete.
//
// These helpers are pure and unit-testable; the backfill script (migration task
// ub12qgO1AMb3WQeLIPSB) hydrates Firestore data and persists the produced rows.

import { createHash } from 'node:crypto'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import type { SharedBusinessCapability } from '@/lib/business-relationships/types'
import { detectOrphanedModuleRecords } from './lifecycle'
import type {
  CrossOrgModule,
  ModuleCascadePlan,
  PartnerIdentityLink,
  PartnerIdentityLinkType,
  PartnerLink,
  PartnerResourceGrant,
  PartnerResourceType,
  PartnerScopeAgreement,
} from './types'
import { CROSS_ORG_SCHEMA_VERSION } from './types'

// ── Legacy pointer compatibility ─────────────────────────────────────────────

export interface LegacyPointerInput {
  linkedOrgId?: unknown
  linkedUserId?: unknown
  allowedOrgIds?: unknown
  allowedUserIds?: unknown
}

/**
 * Normalise a legacy CRM row's convenience pointers. Any pointer is read-only
 * compatibility input: present pointers are reported, but they never grant
 * access by themselves (callers must still evaluate the canonical contracts).
 */
export function extractLegacyPointers(input: LegacyPointerInput): {
  linkedOrgId: string
  linkedUserId: string
  allowedOrgIds: string[]
  allowedUserIds: string[]
  hasAny: boolean
} {
  const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
  const cleanArray = (value: unknown): string[] =>
    Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map((item) => item.trim())
      : []

  const linkedOrgId = clean(input.linkedOrgId)
  const linkedUserId = clean(input.linkedUserId)
  const allowedOrgIds = cleanArray(input.allowedOrgIds)
  const allowedUserIds = cleanArray(input.allowedUserIds)

  return {
    linkedOrgId,
    linkedUserId,
    allowedOrgIds,
    allowedUserIds,
    hasAny: Boolean(linkedOrgId || linkedUserId || allowedOrgIds.length || allowedUserIds.length),
  }
}

// ── Business relationship -> PartnerLink promotion ───────────────────────────

export interface LegacyRelationshipRow {
  id: string
  sourceOrgId?: unknown
  targetOrgId?: unknown
  partnerLinkId?: unknown
  status?: unknown
  deleted?: unknown
  sharedCapabilities?: unknown
}

export interface PromotedLinkCandidate {
  partnerLinkId: string
  orgA: string
  orgB: string
  relationshipIdA: string
  relationshipIdB: string
  negotiableCapabilities: SharedBusinessCapability[]
}

/**
 * Promote a pair of legacy businessRelationships rows that share a
 * partnerLinkId and are both active into a canonical PartnerLink candidate.
 * Returns null when either row is missing/revoked/deleted or ids don't match —
 * promotion must never fabricate a link.
 */
export function promoteActiveRelationshipPair(
  a: LegacyRelationshipRow,
  b: LegacyRelationshipRow,
): PromotedLinkCandidate | null {
  const partnerLinkId = clean(a.partnerLinkId)
  const statusA = clean(a.status)
  const statusB = clean(b.status)
  const deletedA = a.deleted === true
  const deletedB = b.deleted === true

  if (!partnerLinkId || clean(b.partnerLinkId) !== partnerLinkId) return null
  if (statusA !== 'active' || statusB !== 'active') return null
  if (deletedA || deletedB) return null
  if (a.id === b.id) return null

  const orgA = clean(a.sourceOrgId)
  const orgB = clean(b.sourceOrgId)
  if (!orgA || !orgB || orgA === orgB) return null

  const targetA = clean(a.targetOrgId)
  const targetB = clean(b.targetOrgId)
  // The mirror contract: A.sourceOrgId === B.targetOrgId and vice versa.
  if (targetA !== orgB || targetB !== orgA) return null

  const capabilities = mergeCapabilities(a.sharedCapabilities, b.sharedCapabilities)

  return {
    partnerLinkId,
    orgA,
    orgB,
    relationshipIdA: a.id,
    relationshipIdB: b.id,
    negotiableCapabilities: capabilities,
  }
}

// ── partner_record_shares -> PartnerResourceGrant promotion ─────────────────

export interface LegacyShareRow {
  id: string
  partnerLinkId?: unknown
  resourceType?: unknown
  resourceId?: unknown
  partnerOrgId?: unknown
  permission?: unknown
  status?: unknown
  ownerOrgId?: unknown
  createdByRef?: unknown
  createdAt?: unknown
}

const SHARE_RESOURCE_TYPE_MAP: Record<string, PartnerResourceType> = {
  deal: 'deal',
  project: 'project',
  invoice: 'invoice',
  quote: 'quote',
  client_document: 'document',
}

/**
 * Promote one active partner_record_shares row to a PartnerResourceGrant
 * candidate. The share's `partnerOrgId` becomes the grantee org; provenance
 * records sourceShareId so the migration is reversible and auditable.
 */
export function promoteShareToResourceGrant(
  row: LegacyShareRow,
): PartnerResourceGrant | null {
  const partnerLinkId = clean(row.partnerLinkId)
  const resourceType = SHARE_RESOURCE_TYPE_MAP[clean(row.resourceType)]
  const resourceId = clean(row.resourceId)
  const partnerOrgId = clean(row.partnerOrgId)
  const ownerOrgId = clean(row.ownerOrgId)
  const status = clean(row.status)

  if (!partnerLinkId || !resourceType || !resourceId || !partnerOrgId || !ownerOrgId) return null
  if (status !== 'active') return null

  const permission = clean(row.permission)
  const actions = permission === 'comment'
    ? ['view', 'comment']
    : ['view']

  const now = new Date()

  return {
    id: row.id,
    partnerLinkId,
    ownerOrgId,
    resourceType,
    resourceId,
    grantee: {
      orgIds: [partnerOrgId],
      userIds: [],
      teamIds: [],
    },
    actions,
    status: 'active',
    provenance: {
      sourceShareId: row.id,
    },
    approvalBasis: { type: 'partner_link', refId: partnerLinkId },
    createdByRef: row.createdByRef as never,
    createdAt: row.createdAt ?? now,
    updatedAt: now,
    schemaVersion: 1,
  }
}

// ── linkedOrgId / linkedUserId -> PartnerIdentityLink seeding ───────────────

export interface LegacyIdentityInput {
  companyId?: string
  contactId?: string
  orgId?: string
  userId?: string
  pointers: LegacyPointerInput
  sourceInviteId?: string
}

export interface SeededIdentityLink {
  linkType: PartnerIdentityLinkType
  sourceRef: { kind: 'company' | 'contact'; id: string }
  targetRef: { kind: 'org' | 'user'; id: string }
  status: 'unverified'
  provenance: { sourceInviteId?: string }
  schemaVersion: number
}

/**
 * Seed candidate PartnerIdentityLink rows from legacy convenience pointers.
 * Every seeded link starts `unverified` — verification requires a later,
 * explicit accept/consent step. Pointers on their own never grant access.
 */
export function seedIdentityLinksFromPointers(input: LegacyIdentityInput): SeededIdentityLink[] {
  const out: SeededIdentityLink[] = []
  const { linkedOrgId, linkedUserId } = extractLegacyPointers(input.pointers)

  if (input.companyId && linkedOrgId) {
    out.push({
      linkType: 'company_org',
      sourceRef: { kind: 'company', id: input.companyId },
      targetRef: { kind: 'org', id: linkedOrgId },
      status: 'unverified',
      provenance: { sourceInviteId: input.sourceInviteId },
      schemaVersion: 1,
    })
  }
  if (input.contactId && linkedUserId) {
    out.push({
      linkType: 'contact_user',
      sourceRef: { kind: 'contact', id: input.contactId },
      targetRef: { kind: 'user', id: linkedUserId },
      status: 'unverified',
      provenance: { sourceInviteId: input.sourceInviteId },
      schemaVersion: 1,
    })
  }
  if (input.contactId && linkedOrgId) {
    out.push({
      linkType: 'contact_org',
      sourceRef: { kind: 'contact', id: input.contactId },
      targetRef: { kind: 'org', id: linkedOrgId },
      status: 'unverified',
      provenance: { sourceInviteId: input.sourceInviteId },
      schemaVersion: 1,
    })
  }
  return out
}

// ── Dry-run-first reconciliation planner (task ub12qgO1AMb3WQeLIPSB) ─────────
//
// Pure planner + evidence helpers. Defaults to dry-run. Never deletes legacy
// rows, never silently merges contradictions, never expands access beyond the
// legacy grant surface. Apply mode only creates/fills missing canonical fields
// that preserve existing access. Production destructive migration is out of
// scope for this task.

export type MigrationMode = 'dry-run' | 'apply'

export type MigrationOpKind =
  | 'promote_partner_link'
  | 'promote_resource_grant'
  | 'seed_identity_link'
  | 'backfill_scope_acceptance'
  | 'backfill_canonical_owner'
  | 'backfill_company_workspace_grant'
  | 'report_orphan'

export type MigrationDecision = 'plan' | 'noop' | 'contradiction' | 'skip'

export interface MigrationContradiction {
  code: string
  message: string
  subjectIds: string[]
  details?: Record<string, unknown>
}

export interface MigrationRollbackSpec {
  action: 'delete' | 'restore_fields' | 'none'
  collection: string
  documentId?: string
  fields?: Record<string, unknown>
}

export interface MigrationOperation {
  id: string
  kind: MigrationOpKind
  decision: MigrationDecision
  collection: string
  documentId?: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  rollback?: MigrationRollbackSpec
  reason: string
  preservesAccess: boolean
  destructive?: boolean
  contradiction?: MigrationContradiction
}

export interface MigrationAuditEventDraft {
  eventType: 'reconciliation.ran' | 'orphan.detected' | 'resource_grant.created' | 'identity_link.created'
  reason: string
  partnerLinkId?: string
  resourceGrantId?: string
  identityLinkId?: string
  metadata?: Record<string, unknown>
}

export interface CanonicalResourceOwnerInput {
  id: string
  resourceType: PartnerResourceType | string
  orgId?: unknown
  ownerOrgId?: unknown
  sourceOrgId?: unknown
  issuerOrgId?: unknown
}

export interface CrmIdentityRowInput {
  companyId?: string
  contactId?: string
  pointers: LegacyPointerInput
  sourceInviteId?: string
}

/** Linked CRM company rows used to backfill company_workspace grants. */
export interface LinkedCompanyMigrationRow {
  companyId: string
  orgId: string
  linkedOrgId: string
  partnerLinkId?: string
  sharedCapabilities?: SharedBusinessCapability[]
}

export interface CanonicalMigrationSnapshot {
  relationships: Array<LegacyRelationshipRow & { acceptedByUid?: unknown }>
  shares: LegacyShareRow[]
  existingLinks: PartnerLink[]
  existingGrants: PartnerResourceGrant[]
  existingIdentityLinks: PartnerIdentityLink[]
  existingAgreements: PartnerScopeAgreement[]
  resources: CanonicalResourceOwnerInput[]
  crmIdentityRows: CrmIdentityRowInput[]
  linkedCompanies?: LinkedCompanyMigrationRow[]
  orphanModuleRecords?: Partial<Record<CrossOrgModule, string[]>>
  orphanTrigger?: ModuleCascadePlan['trigger']
}

export interface CanonicalMigrationPlan {
  mode: MigrationMode
  runId: string
  generatedAt: string
  destructive: false
  operations: MigrationOperation[]
  contradictions: MigrationContradiction[]
  auditEvents: MigrationAuditEventDraft[]
  summary: {
    planned: number
    noop: number
    contradictions: number
    skipped: number
  }
}

export interface MigrationApplyResult {
  mode: MigrationMode
  wouldApply: MigrationOperation[]
  applied: MigrationOperation[]
  skippedContradictions: MigrationOperation[]
  noops: MigrationOperation[]
  evidence: MigrationEvidence
}

export interface MigrationEvidence {
  schemaVersion: 1
  runId: string
  mode: MigrationMode
  destructive: false
  accessPreserving: boolean
  reRunKey: string
  generatedAt: string
  summary: CanonicalMigrationPlan['summary']
  appliedKinds: MigrationOpKind[]
  contradictionCodes: string[]
  rollbackOps: MigrationRollbackSpec[]
  operationIds: string[]
}

export interface AliasCombinationInput {
  linkedOrgId?: unknown
  linkedUserId?: unknown
  allowedOrgIds?: unknown
  allowedUserIds?: unknown
}

/** Stable content id so re-runs map to the same planned op. */
export function migrationOpId(kind: MigrationOpKind, parts: Array<string | undefined | null>): string {
  const raw = [kind, ...parts.map((p) => clean(p) || '-')].join('|')
  return createHash('sha256').update(raw).digest('hex').slice(0, 24)
}

/**
 * Refuse direct writes that invent new legacy alias combinations. Identity
 * pointer sync (derived from PartnerIdentityLink) is the only sanctioned writer
 * of linkedOrgId/linkedUserId. allowedOrgIds/allowedUserIds must not expand via
 * ad-hoc direct writes during/after migration.
 */
export function assertNoNewLegacyAliasCombination(input: {
  existing: AliasCombinationInput
  proposed: AliasCombinationInput
  source?: 'direct_write' | 'identity_pointer_sync' | 'migration_compat'
}): { allowed: boolean; code?: string; message?: string } {
  const source = input.source ?? 'direct_write'
  const existing = extractLegacyPointers(input.existing)
  const proposed = extractLegacyPointers(input.proposed)

  const same =
    existing.linkedOrgId === proposed.linkedOrgId &&
    existing.linkedUserId === proposed.linkedUserId &&
    sameStringSet(existing.allowedOrgIds, proposed.allowedOrgIds) &&
    sameStringSet(existing.allowedUserIds, proposed.allowedUserIds)

  if (same) return { allowed: true }

  if (source === 'identity_pointer_sync') {
    // Identity service may refresh primary linkedOrgId/linkedUserId only.
    const onlyPrimaryPointers =
      sameStringSet(existing.allowedOrgIds, proposed.allowedOrgIds) &&
      sameStringSet(existing.allowedUserIds, proposed.allowedUserIds)
    if (onlyPrimaryPointers) return { allowed: true }
    return {
      allowed: false,
      code: 'new_legacy_alias_combination_forbidden',
      message: 'identity pointer sync cannot invent allowedOrgIds/allowedUserIds aliases',
    }
  }

  if (source === 'migration_compat') {
    // Migration never writes new legacy aliases — only reads them.
    return {
      allowed: false,
      code: 'new_legacy_alias_combination_forbidden',
      message: 'migration treats legacy aliases as read-only compatibility inputs',
    }
  }

  return {
    allowed: false,
    code: 'new_legacy_alias_combination_forbidden',
    message: 'direct writes cannot create new legacy alias combinations; use PartnerIdentityLink + pointer sync',
  }
}

export function planCanonicalOwnerFieldBackfill(input: CanonicalResourceOwnerInput): {
  decision: MigrationDecision
  patch?: Record<string, string>
  contradiction?: MigrationContradiction
  reason: string
} {
  const orgId = clean(input.orgId)
  const ownerOrgId = clean(input.ownerOrgId)
  const sourceOrgId = clean(input.sourceOrgId)
  const values = [orgId, ownerOrgId, sourceOrgId].filter(Boolean)
  const unique = Array.from(new Set(values))

  if (unique.length === 0) {
    return { decision: 'skip', reason: 'no owner field present' }
  }
  if (unique.length > 1) {
    return {
      decision: 'contradiction',
      reason: 'owner fields disagree',
      contradiction: {
        code: 'canonical_owner_conflict',
        message: `resource ${input.id} has conflicting owner fields`,
        subjectIds: [input.id],
        details: { orgId, ownerOrgId, sourceOrgId, resourceType: input.resourceType },
      },
    }
  }

  const owner = unique[0]
  if (orgId === owner && ownerOrgId === owner && sourceOrgId === owner) {
    return { decision: 'noop', reason: 'canonical owner fields already aligned' }
  }

  return {
    decision: 'plan',
    reason: 'backfill missing canonical owner fields from unambiguous owner',
    patch: {
      ownerOrgId: owner,
      sourceOrgId: owner,
      orgId: owner,
    },
  }
}

export function buildCanonicalMigrationPlan(
  snapshot: CanonicalMigrationSnapshot,
  options: { mode?: MigrationMode; runId?: string; now?: Date } = {},
): CanonicalMigrationPlan {
  const mode: MigrationMode = options.mode ?? 'dry-run'
  const now = options.now ?? new Date()
  const runId = options.runId ?? `mig_${now.toISOString().replace(/[:.]/g, '-')}`
  const operations: MigrationOperation[] = []
  const contradictions: MigrationContradiction[] = []
  const auditEvents: MigrationAuditEventDraft[] = []

  // 1) Partner links from active mirrored relationships
  const byLink = new Map<string, Array<LegacyRelationshipRow & { acceptedByUid?: unknown }>>()
  for (const row of snapshot.relationships) {
    const partnerLinkId = clean(row.partnerLinkId)
    if (!partnerLinkId) continue
    const list = byLink.get(partnerLinkId) ?? []
    list.push(row)
    byLink.set(partnerLinkId, list)
  }

  for (const [partnerLinkId, rows] of byLink) {
    let candidate: ReturnType<typeof promoteActiveRelationshipPair> = null
    for (let i = 0; i < rows.length && !candidate; i += 1) {
      for (let j = i + 1; j < rows.length && !candidate; j += 1) {
        candidate = promoteActiveRelationshipPair(rows[i], rows[j])
      }
    }
    if (!candidate) continue

    const existing = snapshot.existingLinks.find((link) => clean(link.partnerLinkId) === partnerLinkId)
    const opId = migrationOpId('promote_partner_link', [partnerLinkId, candidate.orgA, candidate.orgB])

    if (!existing) {
      const after = {
        id: partnerLinkId,
        partnerLinkId,
        orgA: candidate.orgA,
        orgB: candidate.orgB,
        relationshipIdA: candidate.relationshipIdA,
        relationshipIdB: candidate.relationshipIdB,
        negotiableCapabilities: candidate.negotiableCapabilities,
        status: 'active' as const,
        schemaVersion: CROSS_ORG_SCHEMA_VERSION,
      }
      operations.push({
        id: opId,
        kind: 'promote_partner_link',
        decision: 'plan',
        collection: 'partnerLinks',
        documentId: partnerLinkId,
        before: null,
        after,
        rollback: { action: 'delete', collection: 'partnerLinks', documentId: partnerLinkId },
        reason: 'promote active mirrored businessRelationships pair',
        preservesAccess: true,
        destructive: false,
      })
      continue
    }

    const existingOrgs = new Set([clean(existing.orgA), clean(existing.orgB)])
    const candidateOrgs = new Set([candidate.orgA, candidate.orgB])
    const orgsMatch =
      existingOrgs.size === 2 &&
      candidateOrgs.size === 2 &&
      [...candidateOrgs].every((org) => existingOrgs.has(org))

    const relIdsMatch =
      (clean(existing.relationshipIdA) === candidate.relationshipIdA &&
        clean(existing.relationshipIdB) === candidate.relationshipIdB) ||
      (clean(existing.relationshipIdA) === candidate.relationshipIdB &&
        clean(existing.relationshipIdB) === candidate.relationshipIdA)

    if (orgsMatch && relIdsMatch) {
      operations.push({
        id: opId,
        kind: 'promote_partner_link',
        decision: 'noop',
        collection: 'partnerLinks',
        documentId: existing.id,
        before: existing as unknown as Record<string, unknown>,
        after: existing as unknown as Record<string, unknown>,
        reason: 'canonical partner link already matches mirrored pair',
        preservesAccess: true,
        destructive: false,
      })
      continue
    }

    const contradiction: MigrationContradiction = {
      code: orgsMatch ? 'partner_link_relationship_mismatch' : 'partner_link_org_mismatch',
      message: `existing partner link ${partnerLinkId} disagrees with legacy mirrored pair`,
      subjectIds: [partnerLinkId, existing.id, candidate.relationshipIdA, candidate.relationshipIdB],
      details: {
        existing: {
          orgA: existing.orgA,
          orgB: existing.orgB,
          relationshipIdA: existing.relationshipIdA,
          relationshipIdB: existing.relationshipIdB,
        },
        candidate,
      },
    }
    contradictions.push(contradiction)
    operations.push({
      id: opId,
      kind: 'promote_partner_link',
      decision: 'contradiction',
      collection: 'partnerLinks',
      documentId: existing.id,
      before: existing as unknown as Record<string, unknown>,
      after: null,
      reason: contradiction.message,
      preservesAccess: true,
      destructive: false,
      contradiction,
    })
  }

  // 2) Resource grants from partner_record_shares
  for (const share of snapshot.shares) {
    const promoted = promoteShareToResourceGrant(share)
    if (!promoted) continue
    const opId = migrationOpId('promote_resource_grant', [share.id, promoted.resourceType, promoted.resourceId])
    const existing = snapshot.existingGrants.find((g) => g.id === share.id || clean(g.provenance?.sourceShareId) === share.id)

    if (!existing) {
      operations.push({
        id: opId,
        kind: 'promote_resource_grant',
        decision: 'plan',
        collection: 'partnerResourceGrants',
        documentId: promoted.id,
        before: null,
        after: promoted as unknown as Record<string, unknown>,
        rollback: { action: 'delete', collection: 'partnerResourceGrants', documentId: promoted.id },
        reason: 'promote active partner_record_shares row to PartnerResourceGrant',
        preservesAccess: true,
        destructive: false,
      })
      auditEvents.push({
        eventType: 'resource_grant.created',
        reason: 'migration.promote_share',
        partnerLinkId: promoted.partnerLinkId,
        resourceGrantId: promoted.id,
        metadata: { sourceShareId: share.id, dryRunDefault: true },
      })
      continue
    }

    if (clean(existing.ownerOrgId) !== clean(promoted.ownerOrgId)) {
      const contradiction: MigrationContradiction = {
        code: 'resource_grant_owner_mismatch',
        message: `grant ${existing.id} ownerOrgId disagrees with legacy share owner`,
        subjectIds: [existing.id, share.id],
        details: { existingOwnerOrgId: existing.ownerOrgId, shareOwnerOrgId: promoted.ownerOrgId },
      }
      contradictions.push(contradiction)
      operations.push({
        id: opId,
        kind: 'promote_resource_grant',
        decision: 'contradiction',
        collection: 'partnerResourceGrants',
        documentId: existing.id,
        before: existing as unknown as Record<string, unknown>,
        after: null,
        reason: contradiction.message,
        preservesAccess: true,
        destructive: false,
        contradiction,
      })
      continue
    }

    // Existing grant with same owner: preserve access exactly — do not shrink/expand actions.
    operations.push({
      id: opId,
      kind: 'promote_resource_grant',
      decision: 'noop',
      collection: 'partnerResourceGrants',
      documentId: existing.id,
      before: existing as unknown as Record<string, unknown>,
      after: existing as unknown as Record<string, unknown>,
      reason: 'canonical grant already present for share; leave actions untouched',
      preservesAccess: true,
      destructive: false,
    })
  }

  // 3) Identity joins from legacy pointers (read-only inputs)
  for (const row of snapshot.crmIdentityRows) {
    const seeds = seedIdentityLinksFromPointers(row)
    for (const seed of seeds) {
      const opId = migrationOpId('seed_identity_link', [
        seed.linkType,
        seed.sourceRef.kind,
        seed.sourceRef.id,
        seed.targetRef.kind,
        seed.targetRef.id,
      ])
      const exact = snapshot.existingIdentityLinks.find(
        (link) =>
          link.linkType === seed.linkType &&
          link.sourceRef.kind === seed.sourceRef.kind &&
          link.sourceRef.id === seed.sourceRef.id &&
          link.targetRef.kind === seed.targetRef.kind &&
          link.targetRef.id === seed.targetRef.id,
      )
      if (exact) {
        operations.push({
          id: opId,
          kind: 'seed_identity_link',
          decision: 'noop',
          collection: 'partnerIdentityLinks',
          documentId: exact.id,
          before: exact as unknown as Record<string, unknown>,
          after: exact as unknown as Record<string, unknown>,
          reason: 'identity link already exists for pointer target',
          preservesAccess: true,
          destructive: false,
        })
        continue
      }

      const verifiedConflict = snapshot.existingIdentityLinks.find(
        (link) =>
          link.status === 'verified' &&
          link.linkType === seed.linkType &&
          link.sourceRef.kind === seed.sourceRef.kind &&
          link.sourceRef.id === seed.sourceRef.id &&
          link.targetRef.id !== seed.targetRef.id,
      )
      if (verifiedConflict) {
        const contradiction: MigrationContradiction = {
          code: 'identity_pointer_conflicts_verified',
          message: `legacy pointer ${seed.targetRef.id} conflicts with verified identity link ${verifiedConflict.targetRef.id}`,
          subjectIds: [seed.sourceRef.id, verifiedConflict.id, seed.targetRef.id],
          details: {
            linkType: seed.linkType,
            pointerTarget: seed.targetRef,
            verifiedTarget: verifiedConflict.targetRef,
          },
        }
        contradictions.push(contradiction)
        operations.push({
          id: opId,
          kind: 'seed_identity_link',
          decision: 'contradiction',
          collection: 'partnerIdentityLinks',
          documentId: verifiedConflict.id,
          before: verifiedConflict as unknown as Record<string, unknown>,
          after: null,
          reason: contradiction.message,
          preservesAccess: true,
          destructive: false,
          contradiction,
        })
        continue
      }

      operations.push({
        id: opId,
        kind: 'seed_identity_link',
        decision: 'plan',
        collection: 'partnerIdentityLinks',
        documentId: undefined,
        before: null,
        after: seed as unknown as Record<string, unknown>,
        rollback: { action: 'delete', collection: 'partnerIdentityLinks' },
        reason: 'seed unverified PartnerIdentityLink from legacy pointer (read-only input)',
        preservesAccess: true,
        destructive: false,
      })
      auditEvents.push({
        eventType: 'identity_link.created',
        reason: 'migration.seed_identity',
        metadata: {
          linkType: seed.linkType,
          sourceRef: seed.sourceRef,
          targetRef: seed.targetRef,
          status: 'unverified',
        },
      })
    }
  }

  // 4) Scope acceptance bilateral backfill from mirrored relationship acceptors
  for (const agreement of snapshot.existingAgreements) {
    const partnerLinkId = clean(agreement.partnerLinkId)
    if (!partnerLinkId) continue
    if (agreement.acceptance?.grantor && agreement.acceptance?.grantee) {
      operations.push({
        id: migrationOpId('backfill_scope_acceptance', [agreement.id, 'complete']),
        kind: 'backfill_scope_acceptance',
        decision: 'noop',
        collection: 'partnerScopeAgreements',
        documentId: agreement.id,
        before: agreement as unknown as Record<string, unknown>,
        after: agreement as unknown as Record<string, unknown>,
        reason: 'bilateral acceptance already present',
        preservesAccess: true,
        destructive: false,
      })
      continue
    }

    const rels = snapshot.relationships.filter((r) => clean(r.partnerLinkId) === partnerLinkId)
    const grantorOrgId = clean(agreement.direction?.grantorOrgId)
    const granteeOrgId = clean(agreement.direction?.granteeOrgId)
    const grantorRel = rels.find((r) => clean(r.sourceOrgId) === grantorOrgId)
    const granteeRel = rels.find((r) => clean(r.sourceOrgId) === granteeOrgId)
    const grantorUid = clean(grantorRel?.acceptedByUid) || memberRefUid(agreement.acceptedByRef)
    const granteeUid = clean(granteeRel?.acceptedByUid)

    if (!grantorUid || !granteeUid) {
      operations.push({
        id: migrationOpId('backfill_scope_acceptance', [agreement.id, 'missing']),
        kind: 'backfill_scope_acceptance',
        decision: 'skip',
        collection: 'partnerScopeAgreements',
        documentId: agreement.id,
        before: agreement as unknown as Record<string, unknown>,
        after: null,
        reason: 'cannot infer both acceptance sides from relationship rows',
        preservesAccess: true,
        destructive: false,
      })
      continue
    }

    const after = {
      ...agreement,
      acceptance: {
        grantor: agreement.acceptance?.grantor ?? {
          byRef: memberRefFromUid(grantorUid),
        },
        grantee: agreement.acceptance?.grantee ?? {
          byRef: memberRefFromUid(granteeUid),
        },
      },
      // Preserve lifecycle status — do not silently activate from migration alone.
      status: agreement.status,
    }
    operations.push({
      id: migrationOpId('backfill_scope_acceptance', [agreement.id, grantorUid, granteeUid]),
      kind: 'backfill_scope_acceptance',
      decision: 'plan',
      collection: 'partnerScopeAgreements',
      documentId: agreement.id,
      before: agreement as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      rollback: {
        action: 'restore_fields',
        collection: 'partnerScopeAgreements',
        documentId: agreement.id,
        fields: {
          acceptance: agreement.acceptance ?? null,
          status: agreement.status,
        },
      },
      reason: 'backfill bilateral acceptance sides from mirrored relationship acceptors without silent activation',
      preservesAccess: true,
      destructive: false,
    })
  }

  // 5) Canonical owner fields
  for (const resource of snapshot.resources) {
    const result = planCanonicalOwnerFieldBackfill(resource)
    const opId = migrationOpId('backfill_canonical_owner', [String(resource.resourceType), resource.id])
    if (result.decision === 'skip') continue
    if (result.decision === 'noop') {
      operations.push({
        id: opId,
        kind: 'backfill_canonical_owner',
        decision: 'noop',
        collection: String(resource.resourceType),
        documentId: resource.id,
        before: resource as unknown as Record<string, unknown>,
        after: resource as unknown as Record<string, unknown>,
        reason: result.reason,
        preservesAccess: true,
        destructive: false,
      })
      continue
    }
    if (result.decision === 'contradiction' && result.contradiction) {
      contradictions.push(result.contradiction)
      operations.push({
        id: opId,
        kind: 'backfill_canonical_owner',
        decision: 'contradiction',
        collection: String(resource.resourceType),
        documentId: resource.id,
        before: resource as unknown as Record<string, unknown>,
        after: null,
        reason: result.reason,
        preservesAccess: true,
        destructive: false,
        contradiction: result.contradiction,
      })
      continue
    }
    const before = {
      orgId: clean(resource.orgId) || null,
      ownerOrgId: clean(resource.ownerOrgId) || null,
      sourceOrgId: clean(resource.sourceOrgId) || null,
    }
    operations.push({
      id: opId,
      kind: 'backfill_canonical_owner',
      decision: 'plan',
      collection: String(resource.resourceType),
      documentId: resource.id,
      before,
      after: result.patch ?? null,
      rollback: {
        action: 'restore_fields',
        collection: String(resource.resourceType),
        documentId: resource.id,
        fields: before,
      },
      reason: result.reason,
      preservesAccess: true,
      destructive: false,
    })
  }

  // 6) Orphan detection evidence (no destructive delete)
  if (snapshot.orphanTrigger && snapshot.orphanModuleRecords) {
    const orphans = detectOrphanedModuleRecords({
      trigger: snapshot.orphanTrigger,
      records: snapshot.orphanModuleRecords,
    })
    for (const orphan of orphans) {
      const opId = migrationOpId('report_orphan', [orphan.module, orphan.resourceId, orphan.reason])
      operations.push({
        id: opId,
        kind: 'report_orphan',
        decision: 'plan',
        collection: orphan.module,
        documentId: orphan.resourceId,
        before: { resourceId: orphan.resourceId, module: orphan.module },
        after: { ...orphan, action: 'report_only' },
        rollback: { action: 'none', collection: orphan.module, documentId: orphan.resourceId },
        reason: orphan.detail ?? orphan.reason,
        preservesAccess: true,
        destructive: false,
      })
      auditEvents.push({
        eventType: 'orphan.detected',
        reason: orphan.reason,
        partnerLinkId:
          snapshot.orphanTrigger && 'partnerLinkId' in snapshot.orphanTrigger
            ? clean((snapshot.orphanTrigger as { partnerLinkId?: string }).partnerLinkId)
            : undefined,
        metadata: {
          module: orphan.module,
          resourceId: orphan.resourceId,
          detail: orphan.detail,
        },
      })
    }
  }

  // 6) company_workspace grants for linked companies (dry-run first)
  for (const company of snapshot.linkedCompanies ?? []) {
    const partnerLinkId = clean(company.partnerLinkId)
      || findPartnerLinkIdForOrgs(snapshot.existingLinks, company.orgId, company.linkedOrgId)
    if (!partnerLinkId) {
      operations.push({
        id: migrationOpId('backfill_company_workspace_grant', [company.companyId, 'missing_link']),
        kind: 'backfill_company_workspace_grant',
        decision: 'skip',
        collection: 'partnerResourceGrants',
        reason: 'linked company has no partnerLinkId and no active PartnerLink between orgs',
        preservesAccess: true,
        destructive: false,
      })
      continue
    }
    const grantId = `cw:${partnerLinkId}:${company.orgId}:${company.companyId}`
    const existing = snapshot.existingGrants.find(
      (grant) => grant.id === grantId || (
        grant.resourceType === 'company_workspace'
        && grant.partnerLinkId === partnerLinkId
        && grant.ownerOrgId === company.orgId
        && grant.resourceId === company.companyId
      ),
    )
    if (existing) {
      operations.push({
        id: migrationOpId('backfill_company_workspace_grant', [grantId]),
        kind: 'backfill_company_workspace_grant',
        decision: 'noop',
        collection: 'partnerResourceGrants',
        documentId: existing.id,
        before: existing as unknown as Record<string, unknown>,
        after: existing as unknown as Record<string, unknown>,
        reason: 'company_workspace grant already exists',
        preservesAccess: true,
        destructive: false,
      })
      continue
    }
    const modules = Array.isArray(company.sharedCapabilities) && company.sharedCapabilities.length > 0
      ? company.sharedCapabilities
      : (['crm', 'projects', 'documents', 'campaigns', 'social', 'email', 'seo', 'ads', 'research', 'services', 'support', 'messages'] as SharedBusinessCapability[])
    operations.push({
      id: migrationOpId('backfill_company_workspace_grant', [grantId]),
      kind: 'backfill_company_workspace_grant',
      decision: 'plan',
      collection: 'partnerResourceGrants',
      documentId: grantId,
      before: null,
      after: {
        id: grantId,
        partnerLinkId,
        ownerOrgId: company.orgId,
        resourceType: 'company_workspace',
        resourceId: company.companyId,
        grantee: { orgIds: [company.linkedOrgId], userIds: [], teamIds: [] },
        actions: ['view', 'comment', 'approve'],
        items: modules,
        status: 'active',
      },
      rollback: { action: 'delete', collection: 'partnerResourceGrants', documentId: grantId },
      reason: 'backfill missing company_workspace grant for linked company',
      preservesAccess: true,
      destructive: false,
    })
    auditEvents.push({
      eventType: 'resource_grant.created',
      reason: 'backfill_company_workspace_grant',
      partnerLinkId,
      resourceGrantId: grantId,
      metadata: { companyId: company.companyId, ownerOrgId: company.orgId },
    })
  }

  auditEvents.push({
    eventType: 'reconciliation.ran',
    reason: 'canonical_migration_plan',
    metadata: {
      runId,
      mode,
      planned: operations.filter((o) => o.decision === 'plan').length,
      contradictions: contradictions.length,
    },
  })

  const summary = {
    planned: operations.filter((o) => o.decision === 'plan').length,
    noop: operations.filter((o) => o.decision === 'noop').length,
    contradictions: operations.filter((o) => o.decision === 'contradiction').length,
    skipped: operations.filter((o) => o.decision === 'skip').length,
  }

  return {
    mode,
    runId,
    generatedAt: now.toISOString(),
    destructive: false,
    operations,
    contradictions,
    auditEvents,
    summary,
  }
}

export async function applyMigrationPlan(
  plan: CanonicalMigrationPlan,
  options: {
    mode?: MigrationMode
    write?: (op: MigrationOperation) => void | Promise<void>
  } = {},
): Promise<MigrationApplyResult> {
  const mode: MigrationMode = options.mode ?? plan.mode ?? 'dry-run'
  const planned = plan.operations.filter((op) => op.decision === 'plan')
  const contradictions = plan.operations.filter((op) => op.decision === 'contradiction')
  const noops = plan.operations.filter((op) => op.decision === 'noop')
  const applied: MigrationOperation[] = []

  if (mode === 'apply' && options.write) {
    for (const op of planned) {
      // Never apply contradiction/skip; never destructive deletes of legacy rows.
      if (op.destructive) continue
      await options.write(op)
      applied.push(op)
    }
  }

  const evidence = buildMigrationEvidence(plan, {
    mode,
    wouldApply: planned,
    applied,
    skippedContradictions: contradictions,
    noops,
    evidence: null as unknown as MigrationEvidence,
  })

  return {
    mode,
    wouldApply: planned,
    applied,
    skippedContradictions: contradictions,
    noops,
    evidence,
  }
}

export function buildMigrationEvidence(
  plan: CanonicalMigrationPlan,
  result: Pick<MigrationApplyResult, 'mode' | 'wouldApply' | 'applied' | 'skippedContradictions' | 'noops'> & {
    evidence?: MigrationEvidence | null
  },
): MigrationEvidence {
  const relevant = result.mode === 'apply' ? result.applied : result.wouldApply
  const operationIds = relevant.map((op) => op.id).sort()
  const reRunKey = createHash('sha256')
    .update([plan.runId, result.mode, ...operationIds].join('|'))
    .digest('hex')
  const accessPreserving = plan.operations.every((op) => op.preservesAccess !== false)
  return {
    schemaVersion: 1,
    runId: plan.runId,
    mode: result.mode,
    destructive: false,
    accessPreserving,
    reRunKey,
    generatedAt: plan.generatedAt,
    summary: plan.summary,
    appliedKinds: Array.from(new Set(relevant.map((op) => op.kind))),
    contradictionCodes: Array.from(
      new Set(plan.contradictions.map((c) => c.code).concat(
        result.skippedContradictions.map((op) => op.contradiction?.code).filter(Boolean) as string[],
      )),
    ),
    rollbackOps: relevant.map((op) => op.rollback).filter((r): r is MigrationRollbackSpec => Boolean(r)),
    operationIds,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function findPartnerLinkIdForOrgs(
  links: PartnerLink[],
  orgA: string,
  orgB: string,
): string {
  const match = links.find((link) => {
    if (link.status !== 'active') return false
    return (link.orgA === orgA && link.orgB === orgB) || (link.orgA === orgB && link.orgB === orgA)
  })
  return match?.partnerLinkId || match?.id || ''
}

function mergeCapabilities(a: unknown, b: unknown): SharedBusinessCapability[] {
  const set = new Set<SharedBusinessCapability>()
  for (const list of [a, b]) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (typeof item === 'string' && item.length > 0) set.add(item as SharedBusinessCapability)
    }
  }
  return Array.from(set)
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((item) => set.has(item))
}

function memberRefUid(ref: unknown): string {
  if (!ref || typeof ref !== 'object') return ''
  const record = ref as Record<string, unknown>
  return clean(record.uid) || clean(record.id)
}

function memberRefFromUid(uid: string): MemberRef {
  return {
    uid,
    displayName: uid,
    kind: 'human',
  }
}
