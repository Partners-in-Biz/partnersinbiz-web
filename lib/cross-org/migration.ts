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

import type {
  PartnerIdentityLinkType,
  PartnerResourceGrant,
  PartnerResourceType,
} from './types'
import type { SharedBusinessCapability } from '@/lib/business-relationships/types'

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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
