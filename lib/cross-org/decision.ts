// lib/cross-org/decision.ts
//
// Canonical decision evaluation for cross-organisation access (ADR:
// docs/architecture/cross-org-access-model.md).
//
// Chain: actor -> active membership -> reciprocal live partner link ->
// capability -> resource grant -> user/team role -> action/field ->
// lifecycle state.
//
// The function is pure and unit-testable; Firestore-backed callers hydrate the
// inputs (membershipActive, relationships, scopeAgreement, grant) before
// calling, so the authority logic itself stays deterministic and auditable.

import type {
  PartnerAccessDecision,
  PartnerAccessInput,
  DecisionStep,
} from './types'

export const PARTNER_ACCESS_DENIED = 'denied'
export const PARTNER_ACCESS_ALLOWED = 'allowed'

function step(
  name: DecisionStep['step'],
  passed: boolean,
  detail?: string,
): DecisionStep {
  return { step: name, passed, detail }
}

function deny(chain: DecisionStep[], reason: string): PartnerAccessDecision {
  return { allowed: false, reason, chain }
}

/** Default rank comparator: exact-or-higher org/project role strings win. */
export function rankByList(ordered: readonly string[]): (
  actorRole: string | undefined,
  requiredRole: string,
) => boolean {
  const rank = new Map(ordered.map((role, index) => [role, index]))
  return (actorRole, requiredRole) => {
    const a = actorRole === undefined ? -1 : (rank.get(actorRole) ?? -1)
    const r = rank.get(requiredRole) ?? Number.MAX_SAFE_INTEGER
    return a >= r
  }
}

/** Rank comparator for project member roles (owner > manager > contributor > reviewer > viewer). */
export const projectRoleRank = rankByList([
  'viewer',
  'reviewer',
  'contributor',
  'manager',
  'owner',
])

/** Rank comparator for org roles (viewer < member < admin < owner). */
export const orgRoleRank = rankByList(['viewer', 'member', 'admin', 'owner'])

function timeMillis(value: unknown, fallback: number): number {
  if (!value) return fallback
  if (value instanceof Date) return value.getTime()
  const ts = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  const seconds = ts.seconds ?? ts._seconds
  if (typeof seconds === 'number') return seconds * 1000
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? fallback : parsed
  }
  return fallback
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Evaluate one cross-org access decision. Denies fast with the first failing
 * step recorded in `chain`; every step is present in the chain for audit.
 */
export function evaluatePartnerAccess(input: PartnerAccessInput): PartnerAccessDecision {
  const now = input.now ?? new Date()
  const chain: DecisionStep[] = []
  const actor = input.actor
  const actorUserId = clean(actor.userId)
  const actorOrgId = clean(actor.orgId)

  // ── 1. Actor identity ──────────────────────────────────────────────────────
  if (!actorUserId || !actorOrgId) {
    chain.push(step('actor', false, 'actor userId/orgId required'))
    return deny(chain, 'actor identity required')
  }
  chain.push(step('actor', true))

  // Platform super admins / AI with global authority short-circuit ONLY on the
  // within-org surface (never for cross-org grant evaluation).
  if (input.context === 'within_org' && actor.platformAdmin === true) {
    chain.push(step('active_membership', true, 'platform admin within org'))
    chain.push(step('reciprocal_link', true, 'within-org access'))
    chain.push(step('capability', true, 'platform admin'))
    chain.push(step('resource_grant', true, 'platform admin'))
    chain.push(step('user_role', true, 'platform admin'))
    chain.push(step('action_field', true, 'platform admin'))
    chain.push(step('lifecycle', true, 'platform admin'))
    return { allowed: true, reason: undefined, chain }
  }

  // ── 2. Active membership ───────────────────────────────────────────────────
  if (input.membershipActive !== true) {
    chain.push(step('active_membership', false, 'no active orgMembers row'))
    return deny(chain, 'active membership required')
  }
  chain.push(step('active_membership', true))

  // ── 3. Reciprocal live partner link ────────────────────────────────────────
  const crossOrg = Boolean(input.partnerLinkId)
  if (crossOrg) {
    const relationships = input.relationships ?? []
    if (relationships.length !== 2) {
      chain.push(step('reciprocal_link', false, 'expected exactly two mirrored relationship rows'))
      return deny(chain, 'reciprocal partner link required')
    }
    const linkId = clean(input.partnerLinkId)
    const valid = relationships.every((row) => {
      const status = clean(row.status)
      const deleted = row.deleted === true
      const rowLinkId = clean(row.partnerLinkId)
      return !deleted && status === 'active' && rowLinkId === linkId
    })
    const coversActorOrg = relationships.some((row) => {
      const sourceOrgId = clean(row.sourceOrgId)
      const targetOrgId = clean(row.targetOrgId)
      return sourceOrgId === actorOrgId || targetOrgId === actorOrgId
    })
    if (!valid || !coversActorOrg) {
      chain.push(step('reciprocal_link', false, 'partner link not live for both tenants'))
      return deny(chain, 'reciprocal partner link required')
    }
    chain.push(step('reciprocal_link', true))
  } else {
    chain.push(step('reciprocal_link', true, 'within-org, no link needed'))
  }

  // ── 4. Capability + field policy (directional scope agreement) ────────────
  if (input.requiredCapability) {
    const agreement = input.scopeAgreement
    if (!agreement || agreement.status !== 'active') {
      chain.push(step('capability', false, 'scope agreement missing or not active'))
      return deny(chain, 'active directional scope agreement required')
    }
    // Direction check: actor org must be the grantee in the agreement.
    if (clean(agreement.direction.granteeOrgId) !== actorOrgId) {
      chain.push(step('capability', false, 'scope agreement direction does not cover actor org'))
      return deny(chain, 'directional scope agreement required')
    }
    const capabilities = Array.isArray(agreement.capabilities) ? agreement.capabilities : []
    if (!capabilities.includes(input.requiredCapability)) {
      chain.push(step('capability', false, `capability ${input.requiredCapability} not shared`))
      return deny(chain, `capability ${input.requiredCapability} required`)
    }
    // Field-level check: only when the action is field-scoped.
    if (input.field && agreement.fieldSharingPolicy) {
      const policy = agreement.fieldSharingPolicy as Record<string, boolean>
      const policyKey = `${input.resourceType}.${input.field}`
      if (policy[policyKey] === false || policy[input.field] === false) {
        chain.push(step('capability', false, `field ${input.field} not shared`))
        return deny(chain, `field ${input.field} not shared`)
      }
    }
    chain.push(step('capability', true))
  } else {
    chain.push(step('capability', true, 'no capability gate'))
  }

  // ── 5. Resource grant ──────────────────────────────────────────────────────
  if (input.grant) {
    const grant = input.grant
    if (grant.status !== 'active') {
      chain.push(step('resource_grant', false, `grant status ${grant.status}`))
      return deny(chain, 'active resource grant required')
    }
    if (clean(grant.resourceType) !== input.resourceType || clean(grant.resourceId) !== input.resourceId) {
      chain.push(step('resource_grant', false, 'grant does not cover this resource'))
      return deny(chain, 'resource grant does not cover resource')
    }
    if (grant.partnerLinkId && clean(grant.partnerLinkId) !== clean(input.partnerLinkId)) {
      chain.push(step('resource_grant', false, 'grant belongs to a different partner link'))
      return deny(chain, 'resource grant does not cover this partner link')
    }
    const orgIds = Array.isArray(grant.grantee?.orgIds) ? grant.grantee.orgIds : []
    const userIds = Array.isArray(grant.grantee?.userIds) ? grant.grantee.userIds : []
    const teamIds = Array.isArray(grant.grantee?.teamIds) ? grant.grantee.teamIds : []
    const coversOrg = orgIds.includes(actorOrgId)
    const coversUser = userIds.includes(actorUserId)
    const coversTeam = (input.actorTeamIds ?? []).some((teamId) => teamId && teamIds.includes(teamId))
    if (!coversOrg && !coversUser && !coversTeam) {
      chain.push(step('resource_grant', false, 'grant does not cover actor org/user/team'))
      return deny(chain, 'resource grant does not cover actor')
    }
    if (input.requireNamedUser === true && !coversUser) {
      chain.push(step('resource_grant', false, 'named user grant required'))
      return deny(chain, 'named user grant required')
    }
    // Expiry is a lifecycle check but belongs with the grant read.
    const expiresAt = timeMillis(grant.expiresAt, Number.POSITIVE_INFINITY)
    if (expiresAt < now.getTime()) {
      chain.push(step('resource_grant', false, 'grant expired'))
      return deny(chain, 'resource grant expired')
    }
    chain.push(step('resource_grant', true))
  } else if (crossOrg) {
    // Cross-org access always requires an explicit grant (or platform admin),
    // except pure capability-only checks where the caller explicitly opts out.
    const requireGrant = input.requireGrant !== false
    if (requireGrant) {
      chain.push(step('resource_grant', false, 'no resource grant for cross-org access'))
      return deny(chain, 'resource grant required for cross-org access')
    }
    chain.push(step('resource_grant', true, 'capability-only check'))
  } else {
    chain.push(step('resource_grant', true, 'within-org, no grant needed'))
  }

  // ── 6. User/team role on the resource ──────────────────────────────────────
  if (input.grant?.role && input.actorRole === undefined) {
    chain.push(step('user_role', false, 'grant requires a role but actor has none'))
    return deny(chain, 'role required for this grant')
  }
  if (input.grant?.role) {
    const requiredRole = input.grant.role
    const comparator = input.roleRank ?? orgRoleRank
    if (!comparator(input.actorRole, requiredRole)) {
      chain.push(step('user_role', false, `actor role insufficient for ${requiredRole}`))
      return deny(chain, `role ${requiredRole} required`)
    }
  }
  chain.push(step('user_role', true))

  // ── 7. Action / field / item allowlists ────────────────────────────────────
  const grant = input.grant
  if (grant) {
    const actions = Array.isArray(grant.actions) && grant.actions.length > 0 ? grant.actions : null
    if (actions && !actions.includes(input.action)) {
      chain.push(step('action_field', false, `action ${input.action} not granted`))
      return deny(chain, `action ${input.action} not granted`)
    }
    if (input.field) {
      const fields = Array.isArray(grant.fields) && grant.fields.length > 0 ? grant.fields : null
      if (fields && !fields.includes(input.field)) {
        chain.push(step('action_field', false, `field ${input.field} not granted`))
        return deny(chain, `field ${input.field} not granted`)
      }
    }
    if (input.item) {
      const items = Array.isArray(grant.items) && grant.items.length > 0 ? grant.items : null
      if (items && !items.includes(input.item)) {
        chain.push(step('action_field', false, `item ${input.item} not granted`))
        return deny(chain, `item ${input.item} not granted`)
      }
    }
  }
  chain.push(step('action_field', true))

  // ── 8. Lifecycle state ─────────────────────────────────────────────────────
  if (crossOrg) {
    const relationshipRows = input.relationships ?? []
    const linkLive = relationshipRows.length === 2 && relationshipRows.every((row) => {
      const status = clean(row.status)
      const deleted = row.deleted === true
      return !deleted && status === 'active'
    })
    if (!linkLive) {
      chain.push(step('lifecycle', false, 'partner link not in active lifecycle state'))
      return deny(chain, 'partner link lifecycle not active')
    }
    if (input.scopeAgreement && input.scopeAgreement.status !== 'active') {
      chain.push(step('lifecycle', false, `scope agreement status ${input.scopeAgreement.status}`))
      return deny(chain, 'scope agreement lifecycle not active')
    }
    if (input.grant && input.grant.status !== 'active') {
      chain.push(step('lifecycle', false, `grant status ${input.grant.status}`))
      return deny(chain, 'grant lifecycle not active')
    }
  }
  chain.push(step('lifecycle', true))

  return { allowed: true, reason: undefined, chain }
}

/**
 * Shortcut for the common "does this actor hold this capability on this link"
 * question used by commerce/finance adapters before they look for a grant.
 */
export function evaluatePartnerCapability(input: {
  actorOrgId: string
  partnerLinkId: string
  relationships: Array<Record<string, unknown>>
  scopeAgreement: PartnerAccessInput['scopeAgreement']
  requiredCapability: NonNullable<PartnerAccessInput['requiredCapability']>
  membershipActive: boolean
}): PartnerAccessDecision {
  return evaluatePartnerAccess({
    actor: { userId: 'capability-check', orgId: input.actorOrgId },
    resourceType: 'custom',
    resourceId: input.partnerLinkId,
    action: 'capability',
    partnerLinkId: input.partnerLinkId,
    requiredCapability: input.requiredCapability,
    scopeAgreement: input.scopeAgreement,
    relationships: input.relationships,
    membershipActive: input.membershipActive,
    requireGrant: false,
  })
}
