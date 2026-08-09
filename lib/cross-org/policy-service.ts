// lib/cross-org/policy-service.ts
//
// Foundation - central cross-org policy decision service and audit decision API
// (task YKa9DWMexJ8Cx3yuRdgz, project JZ7TSJjnGYjv87h6OAst).
//
// The service hydrates the canonical decision inputs from Firestore
// (active membership, mirrored reciprocal relationship rows, canonical
// PartnerLink doc, directional scope agreement, resource grant), applies lazy
// expiry, evaluates the pure chain from ./decision.ts, maps the failure to a
// stable reason code, computes a safe projection (fields/items allowlists) and
// emits an append-only PartnerAuditEvent (access.decided) when requested.
//
// Tenant safety:
//   - actor orgId/userId come from the authenticated caller (route ctx), never
//     from a request body.
//   - The canonical link doc must be active AND the actor org must be one of
//     its two orgs; the pure chain additionally requires both mirrored
//     relationship rows to be active, non-deleted and share the partnerLinkId.
//   - Safe projections return only grant-allowed fields/items; the service
//     never returns foreign resource payloads.

import crypto from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { ActiveOrgMember } from '@/lib/orgMembers/active-membership'
import { loadActiveOrgMember } from '@/lib/orgMembers/active-membership'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import type { SharedBusinessCapability } from '@/lib/business-relationships/types'
import { evaluatePartnerAccess } from './decision'
import { evaluateExpiry } from './lifecycle'
import type {
  DecisionStep,
  PartnerAccessDecision,
  PartnerAuditDecision,
  PartnerAuditEvent,
  PartnerAuditEventType,
  PartnerLink,
  PartnerResourceGrant,
  PartnerResourceType,
  PartnerScopeAgreement,
} from './types'
import { PARTNER_AUDIT_EVENTS_COLLECTION } from './types'

// ── Reason codes ─────────────────────────────────────────────────────────────

export type CrossOrgReasonCode =
  | 'ALLOWED'
  | 'ACTOR_IDENTITY_REQUIRED'
  | 'ACTIVE_MEMBERSHIP_REQUIRED'
  | 'RECIPROCAL_LINK_REQUIRED'
  | 'SCOPE_AGREEMENT_REQUIRED'
  | 'CAPABILITY_REQUIRED'
  | 'FIELD_NOT_SHARED'
  | 'RESOURCE_GRANT_REQUIRED'
  | 'GRANT_NOT_ACTIVE'
  | 'GRANT_EXPIRED'
  | 'GRANT_DOES_NOT_COVER_ACTOR'
  | 'GRANT_COVERS_OTHER_RESOURCE'
  | 'GRANT_WRONG_LINK'
  | 'NAMED_USER_GRANT_REQUIRED'
  | 'RESOURCE_OWNER_MISMATCH'
  | 'ROLE_REQUIRED'
  | 'ACTION_NOT_GRANTED'
  | 'FIELD_NOT_GRANTED'
  | 'ITEM_NOT_GRANTED'
  | 'LIFECYCLE_NOT_ACTIVE'
  | 'DENIED'

/**
 * Map a pure decision's first failing chain step + detail onto a stable,
 * machine-readable reason code. The pure chain stops at the first failure, so
 * the first failed step IS the reason. ALLOWED when the decision passed.
 */
export function reasonCodeFromDecision(decision: PartnerAccessDecision): CrossOrgReasonCode {
  if (decision.allowed) return 'ALLOWED'
  const failed = decision.chain.find((s) => !s.passed)
  if (!failed) return 'DENIED'
  const detail = failed.detail ?? ''
  switch (failed.step) {
    case 'actor':
      return 'ACTOR_IDENTITY_REQUIRED'
    case 'active_membership':
      return 'ACTIVE_MEMBERSHIP_REQUIRED'
    case 'reciprocal_link':
      return 'RECIPROCAL_LINK_REQUIRED'
    case 'capability':
      if (detail.includes('field') && detail.includes('not shared')) return 'FIELD_NOT_SHARED'
      if (detail.includes('scope agreement') || detail.includes('direction')) return 'SCOPE_AGREEMENT_REQUIRED'
      return 'CAPABILITY_REQUIRED'
    case 'resource_grant':
      if (detail.includes('named user grant required')) return 'NAMED_USER_GRANT_REQUIRED'
      if (detail.includes('expired')) return 'GRANT_EXPIRED'
      if (detail.includes('status')) return 'GRANT_NOT_ACTIVE'
      if (detail.includes('does not cover actor')) return 'GRANT_DOES_NOT_COVER_ACTOR'
      if (detail.includes('does not cover this resource')) return 'GRANT_COVERS_OTHER_RESOURCE'
      if (detail.includes('different partner link')) return 'GRANT_WRONG_LINK'
      return 'RESOURCE_GRANT_REQUIRED'
    case 'user_role':
      return 'ROLE_REQUIRED'
    case 'action_field':
      if (detail.includes('field')) return 'FIELD_NOT_GRANTED'
      if (detail.includes('item')) return 'ITEM_NOT_GRANTED'
      return 'ACTION_NOT_GRANTED'
    case 'lifecycle':
      return 'LIFECYCLE_NOT_ACTIVE'
    default:
      return 'DENIED'
  }
}

// ── Safe projection ──────────────────────────────────────────────────────────

export interface CrossOrgProjection {
  /** Field allowlist; null = all fields (still subject to scope field policy). */
  fields: string[] | null
  /** Item allowlist (e.g. document versions); null = all items. */
  items: string[] | null
}

/**
 * Compute the safe projection for a grant + directional scope agreement.
 * An explicit grant.fields/items allowlist narrows the surface; scope
 * fieldSharingPolicy entries marked false remove fields even from an explicit
 * allowlist. When grant fields are empty the projection is null (all fields),
 * and the scope agreement field policy continues to gate field-scoped actions
 * inside the pure decision.
 */
export function buildSafeProjection(
  grant: PartnerResourceGrant | null | undefined,
  scopeAgreement?: PartnerScopeAgreement | null,
): CrossOrgProjection {
  let fields: string[] | null = null
  if (Array.isArray(grant?.fields) && grant!.fields!.length > 0) {
    fields = [...grant!.fields!]
  }
  let items: string[] | null = null
  if (Array.isArray(grant?.items) && grant!.items!.length > 0) {
    items = [...grant!.items!]
  }

  const policy = scopeAgreement?.fieldSharingPolicy as Record<string, boolean> | undefined
  if (fields && policy) {
    fields = fields.filter((field) => {
      const resourceType = grant?.resourceType ?? ''
      const key = `${resourceType}.${field}`
      return policy[key] !== false && policy[field] !== false
    })
  }
  return { fields, items }
}

/**
 * Apply a safe projection to a foreign resource record. Returns a NEW object
 * containing only grant-allowed fields, and (when the record carries an
 * `items` array and the projection has an item allowlist) only allowed items.
 * Never mutates the source record.
 */
export function projectResourceRecord(
  record: Record<string, unknown>,
  projection: CrossOrgProjection,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key === 'items') continue
    if (projection.fields === null || projection.fields.includes(key)) {
      out[key] = value
    }
  }
  if (projection.items !== null && Array.isArray(record.items)) {
    out.items = (record.items as unknown[]).filter((item) => {
      if (item && typeof item === 'object') {
        const id = (item as { id?: unknown }).id
        return typeof id === 'string' && projection.items!.includes(id)
      }
      return typeof item === 'string' && projection.items!.includes(item)
    })
  }
  return out
}

// ── Audit event (append-only) ────────────────────────────────────────────────

export interface PartnerAuditEventInput {
  eventType: PartnerAuditEventType
  partnerLinkId?: string
  scopeAgreementId?: string
  resourceGrantId?: string
  identityLinkId?: string
  actorRef?: MemberRef
  actorOrgId: string
  resourceType?: string
  resourceId?: string
  decision?: PartnerAuditDecision
  reason?: string
  metadata?: Record<string, unknown>
  reconciliationKey?: string
}

/**
 * Content hash for tamper evidence: sha256 over the canonical (sorted-key)
 * JSON of every audit field except id/hash/createdAt. Stable for equal events.
 */
export function hashPartnerAuditEvent(input: PartnerAuditEventInput): string {
  const rest = { ...input } as PartnerAuditEventInput & {
    id?: string
    hash?: string
    createdAt?: unknown
  }
  delete rest.id
  delete rest.hash
  delete rest.createdAt
  const canonical = JSON.stringify(Object.fromEntries(
    Object.entries(rest).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ))
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

// ── Store contract (injectable for adapter contract tests) ──────────────────

export interface CrossOrgPolicyStore {
  /** Active orgMembers row for (orgId, uid); null when missing/inactive. */
  loadActiveOrgMember(orgId: string, uid: string): Promise<ActiveOrgMember | null>
  /** Canonical PartnerLink doc; null when missing. */
  loadPartnerLink(partnerLinkId: string): Promise<PartnerLink | null>
  /** Both mirrored businessRelationships rows carrying the partnerLinkId. */
  loadRelationships(partnerLinkId: string): Promise<Array<Record<string, unknown>>>
  /** Directional scope agreement; when scopeAgreementId is supplied it must match the grant's immutable provenance. */
  loadScopeAgreement(partnerLinkId: string, granteeOrgId: string, scopeAgreementId?: string): Promise<PartnerScopeAgreement | null>
  /** Active resource grant for the resource that covers the actor org/user/team. */
  loadResourceGrant(input: {
    resourceType: string
    resourceId: string
    orgId: string
    userId: string
    teamIds?: string[]
  }): Promise<PartnerResourceGrant | null>
  /** Append one audit event; returns the event id. Must be write-once. */
  appendAuditEvent(event: PartnerAuditEventInput): Promise<string>
}

// ── In-memory store (adapter contract tests) ─────────────────────────────────

export class InMemoryCrossOrgPolicyStore implements CrossOrgPolicyStore {
  memberships = new Map<string, ActiveOrgMember>()
  links = new Map<string, PartnerLink>()
  relationships: Array<Record<string, unknown>> = []
  scopeAgreements = new Map<string, PartnerScopeAgreement>()
  grants: PartnerResourceGrant[] = []
  auditEvents: PartnerAuditEvent[] = []

  seedMembership(orgId: string, uid: string, role: 'owner' | 'admin' | 'member' | 'viewer' = 'member'): void {
    this.memberships.set(`${orgId}_${uid}`, { orgId, uid, role, row: { role, status: 'active' } })
  }

  seedLink(link: PartnerLink | undefined): void {
    if (link) this.links.set(link.partnerLinkId, link)
  }

  seedRelationships(rows: Array<Record<string, unknown>>): void {
    this.relationships = [...rows]
  }

  seedScopeAgreement(agreement: PartnerScopeAgreement): void {
    this.scopeAgreements.set(agreement.id, agreement)
  }

  seedGrant(grant: PartnerResourceGrant): void {
    this.grants.push(grant)
  }

  async loadActiveOrgMember(orgId: string, uid: string): Promise<ActiveOrgMember | null> {
    return this.memberships.get(`${orgId}_${uid}`) ?? null
  }

  async loadPartnerLink(partnerLinkId: string): Promise<PartnerLink | null> {
    return this.links.get(partnerLinkId) ?? null
  }

  async loadRelationships(partnerLinkId: string): Promise<Array<Record<string, unknown>>> {
    return this.relationships.filter((row) => row.partnerLinkId === partnerLinkId)
  }

  async loadScopeAgreement(partnerLinkId: string, granteeOrgId: string, scopeAgreementId?: string): Promise<PartnerScopeAgreement | null> {
    if (scopeAgreementId) {
      const agreement = this.scopeAgreements.get(scopeAgreementId) ?? null
      return agreement
        && agreement.partnerLinkId === partnerLinkId
        && agreement.direction.granteeOrgId === granteeOrgId
        ? agreement
        : null
    }
    const matches = [...this.scopeAgreements.values()].filter(
      (agreement) =>
        agreement.partnerLinkId === partnerLinkId &&
        agreement.direction.granteeOrgId === granteeOrgId &&
        agreement.status === 'active',
    )
    return matches.sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0] ?? null
  }

  async loadResourceGrant(input: {
    resourceType: string
    resourceId: string
    orgId: string
    userId: string
    teamIds?: string[]
  }): Promise<PartnerResourceGrant | null> {
    const teamIds = input.teamIds ?? []
    const matches = this.grants.filter(
      (grant) =>
        grant.resourceType === input.resourceType &&
        grant.resourceId === input.resourceId,
    )
    const covering = matches.find(
      (grant) =>
        grant.grantee.orgIds.includes(input.orgId) ||
        grant.grantee.userIds.includes(input.userId) ||
        grant.grantee.teamIds.some((teamId) => teamIds.includes(teamId)),
    )
    return covering ?? null
  }

  async appendAuditEvent(event: PartnerAuditEventInput): Promise<string> {
    const id = `audit-${this.auditEvents.length + 1}`
    const createdAt = new Date()
    this.auditEvents.push({
      id,
      ...event,
      hash: hashPartnerAuditEvent(event),
      createdAt,
    } as PartnerAuditEvent)
    return id
  }
}

// ── Firestore store ──────────────────────────────────────────────────────────

export class FirestoreCrossOrgPolicyStore implements CrossOrgPolicyStore {
  async loadActiveOrgMember(orgId: string, uid: string): Promise<ActiveOrgMember | null> {
    return loadActiveOrgMember(orgId, uid)
  }

  async loadPartnerLink(partnerLinkId: string): Promise<PartnerLink | null> {
    const snap = await adminDb.collection('partnerLinks').doc(partnerLinkId).get()
    if (!snap.exists) return null
    return { id: snap.id, ...snap.data() } as PartnerLink
  }

  async loadRelationships(partnerLinkId: string): Promise<Array<Record<string, unknown>>> {
    const snap = await adminDb
      .collection('businessRelationships')
      .where('partnerLinkId', '==', partnerLinkId)
      .limit(10)
      .get()
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  }

  async loadScopeAgreement(partnerLinkId: string, granteeOrgId: string, scopeAgreementId?: string): Promise<PartnerScopeAgreement | null> {
    const snap = await adminDb
      .collection('partnerScopeAgreements')
      .where('partnerLinkId', '==', partnerLinkId)
      .limit(50)
      .get()
    const matches = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }) as PartnerScopeAgreement)
      .filter((agreement) => agreement.direction?.granteeOrgId === granteeOrgId)
    if (scopeAgreementId) return matches.find((agreement) => agreement.id === scopeAgreementId) ?? null
    return matches
      .filter((agreement) => agreement.status === 'active')
      .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0] ?? null
  }

  async loadResourceGrant(input: {
    resourceType: string
    resourceId: string
    orgId: string
    userId: string
    teamIds?: string[]
  }): Promise<PartnerResourceGrant | null> {
    // Single-field query (resourceId) stays composite-index-safe; filter the
    // bounded candidate set in memory for type/status/coverage.
    const snap = await adminDb
      .collection('partnerResourceGrants')
      .where('resourceId', '==', input.resourceId)
      .limit(100)
      .get()
    const teamIds = input.teamIds ?? []
    const matches = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }) as PartnerResourceGrant)
      .filter(
        (grant) =>
          grant.resourceType === input.resourceType &&
          (grant.grantee?.orgIds?.includes(input.orgId) ||
            grant.grantee?.userIds?.includes(input.userId) ||
            grant.grantee?.teamIds?.some((teamId) => teamIds.includes(teamId))),
      )
    return matches[0] ?? null
  }

  async appendAuditEvent(event: PartnerAuditEventInput): Promise<string> {
    // Append-only: `add` always creates a new document; this store exposes no
    // update/delete surface. Hash included for tamper evidence.
    const ref = await adminDb.collection(PARTNER_AUDIT_EVENTS_COLLECTION).add({
      ...event,
      hash: hashPartnerAuditEvent(event),
      createdAt: FieldValue.serverTimestamp(),
    })
    return ref.id
  }
}

// ── Decision service ─────────────────────────────────────────────────────────

export interface CrossOrgDecisionInput {
  actor: {
    userId: string
    orgId: string
    platformAdmin?: boolean
  }
  resourceType: PartnerResourceType | 'custom'
  resourceId: string
  /** Immutable owner loaded by the module adapter; never accepted from the caller. */
  resourceOwnerOrgId?: string
  action: string
  field?: string
  item?: string
  partnerLinkId?: string
  requiredCapability?: SharedBusinessCapability
  actorRole?: string
  actorTeamIds?: string[]
  roleRank?: (actorRole: string | undefined, requiredRole: string) => boolean
  /** Restrict a collaboration decision to a grant naming this exact user. */
  requireNamedUser?: boolean
  /** Emit an append-only access.decided audit event. Defaults to true. */
  recordDecision?: boolean
  /** Real caller identity for the audit event; defaults to a synthetic ref. */
  actorRef?: MemberRef
  now?: Date
}

export interface CrossOrgDecisionResult {
  allowed: boolean
  reason?: string
  reasonCode: CrossOrgReasonCode
  chain: DecisionStep[]
  partnerLinkId?: string
  scopeAgreementId?: string
  resourceGrantId?: string
  projection?: CrossOrgProjection
  auditEventId?: string
}

export class CrossOrgPolicyService {
  constructor(
    private readonly store: CrossOrgPolicyStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async decide(input: CrossOrgDecisionInput): Promise<CrossOrgDecisionResult> {
    const now = input.now ?? this.now()
    const actor = input.actor
    const { userId, orgId } = actor

    // ── 1. Actor identity (fail fast, deterministic chain) ──────────────────
    if (!userId || !orgId) {
      const chain: DecisionStep[] = [
        { step: 'actor', passed: false, detail: 'actor userId/orgId required' },
      ]
      return { allowed: false, reason: 'actor identity required', reasonCode: 'ACTOR_IDENTITY_REQUIRED', chain }
    }

    // ── 2. Hydrate canonical inputs ──────────────────────────────────────────
    const membership = await this.store.loadActiveOrgMember(orgId, userId)
    const membershipActive = membership !== null

    let link: PartnerLink | null = null
    let relationships: Array<Record<string, unknown>> | undefined
    let scopeAgreement: PartnerScopeAgreement | null | undefined
    let grant: PartnerResourceGrant | null | undefined

    if (input.partnerLinkId) {
      link = await this.store.loadPartnerLink(input.partnerLinkId)
      relationships = await this.store.loadRelationships(input.partnerLinkId)
      grant = await this.store.loadResourceGrant({
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        orgId,
        userId,
        teamIds: input.actorTeamIds,
      })
      if (grant) {
        const expiry = evaluateExpiry({ status: grant.status, expiresAt: grant.expiresAt, now })
        if (expiry.expired) grant = { ...grant, status: 'expired' }
      }
      if (input.requiredCapability) {
        // A canonical external grant is bound to the exact directional scope
        // that approved it. Legacy/unbound grants must be migrated before use;
        // they may never inherit authority from a newer active agreement.
        scopeAgreement = grant
          ? (grant.scopeAgreementId
            ? await this.store.loadScopeAgreement(input.partnerLinkId, orgId, grant.scopeAgreementId)
            : null)
          : await this.store.loadScopeAgreement(input.partnerLinkId, orgId)
        if (scopeAgreement) {
          const expiry = evaluateExpiry({ status: scopeAgreement.status, expiresAt: scopeAgreement.expiresAt, now })
          if (expiry.expired) scopeAgreement = { ...scopeAgreement, status: 'expired' }
        }
      }
    }

    // ── 3. Canonical link doc gate (service-level, on top of pure chain) ─────
    // The pure decision validates the mirrored relationship rows; the ADR also
    // requires the canonical PartnerLink doc itself to be active and to name
    // the actor org. A missing/revoked canonical doc with stale relationship
    // rows must deny with the reciprocal-link reason.
    if (input.partnerLinkId) {
      const linkId = input.partnerLinkId
      const linkActive = link !== null && link.status === 'active'
      const linkCoversActor = linkActive && link !== null && (link.orgA === orgId || link.orgB === orgId)
      if (!linkActive || !linkCoversActor) {
        const chain: DecisionStep[] = [
          { step: 'actor', passed: true },
          { step: 'active_membership', passed: membershipActive },
          { step: 'reciprocal_link', passed: false, detail: 'canonical partner link not active or does not cover actor org' },
        ]
        return {
          allowed: false,
          reason: 'reciprocal partner link required',
          reasonCode: 'RECIPROCAL_LINK_REQUIRED',
          chain,
          partnerLinkId: linkId,
        }
      }
    }

    // ── 4. Pure decision chain ───────────────────────────────────────────────
    let decision = evaluatePartnerAccess({
      actor,
      context: input.partnerLinkId ? 'cross_org_grant' : 'within_org',
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      action: input.action,
      field: input.field,
      item: input.item,
      partnerLinkId: input.partnerLinkId,
      requiredCapability: input.requiredCapability,
      scopeAgreement: scopeAgreement ?? undefined,
      grant: grant ?? undefined,
      relationships,
      actorRole: input.actorRole,
      actorTeamIds: input.actorTeamIds,
      roleRank: input.roleRank,
      requireNamedUser: input.requireNamedUser,
      membershipActive,
      now,
    })
    const resourceOwnerMismatch = Boolean(
      input.resourceOwnerOrgId && grant?.ownerOrgId !== input.resourceOwnerOrgId,
    )
    if (resourceOwnerMismatch) {
      decision = {
        allowed: false,
        reason: 'resource grant owner does not match the immutable module resource owner',
        chain: [...decision.chain, { step: 'resource_grant', passed: false, detail: 'resource grant owner does not match module resource owner' }],
      }
    }

    const reasonCode = resourceOwnerMismatch
      ? 'RESOURCE_OWNER_MISMATCH'
      : reasonCodeFromDecision(decision)
    const projection = decision.allowed
      ? buildSafeProjection(grant, scopeAgreement)
      : undefined

    // ── 5. Append-only audit (no foreign data in metadata) ───────────────────
    let auditEventId: string | undefined
    if (input.recordDecision !== false) {
      const metadata: Record<string, unknown> = {
        action: input.action,
        reasonCode,
      }
      if (input.field) metadata.field = input.field
      if (input.item) metadata.item = input.item
      if (input.requiredCapability) metadata.requiredCapability = input.requiredCapability
      if (input.actorRole) metadata.actorRole = input.actorRole

      auditEventId = await this.store.appendAuditEvent({
        eventType: 'access.decided',
        partnerLinkId: input.partnerLinkId,
        scopeAgreementId: scopeAgreement?.id,
        resourceGrantId: grant?.id,
        actorRef: input.actorRef ?? { uid: userId, displayName: userId, kind: 'human' },
        actorOrgId: orgId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        decision: decision.allowed ? 'allowed' : 'denied',
        reason: decision.reason,
        metadata,
        reconciliationKey: `${orgId}:${input.resourceType}:${input.resourceId}:${input.action}:${now.toISOString()}`,
      })
    }

    return {
      allowed: decision.allowed,
      reason: decision.reason,
      reasonCode,
      chain: decision.chain,
      partnerLinkId: input.partnerLinkId,
      scopeAgreementId: scopeAgreement?.id,
      resourceGrantId: grant?.id,
      projection,
      auditEventId,
    }
  }
}

export function createCrossOrgPolicyService(
  store?: CrossOrgPolicyStore,
  now?: () => Date,
): CrossOrgPolicyService {
  return new CrossOrgPolicyService(store ?? new FirestoreCrossOrgPolicyStore(), now)
}
