// lib/cross-org/lifecycle.ts
//
// Lifecycle evaluation and cascade rules for the canonical cross-org contracts
// (ADR: docs/architecture/cross-org-access-model.md).
//
// Rules:
//   - Unlink revokes both relationship rows, the canonical link, every scope
//     agreement on the link, every grant on the link/agreements, and derived
//     identity links.
//   - Capability reduction / field narrowing re-evaluates downstream grants;
//     grants depending on the removed capability/field are revoked with reason
//     'capability.reduced'.
//   - Expiry is evaluated lazily at decision time and flipped to 'expired' by a
//     reconciler; a revoked grant is never silently resurrected.
//   - Offboarding (membership revoked/deleted/disabled) invalidates access
//     immediately; no grant can restore it.
//
// These helpers are pure; the Firestore-backed reconciler (foundation task
// YKa9DWMexJ8Cx3yuRdgz) hydrates and persists the produced plan.

import type {
  PartnerLink,
  PartnerResourceGrant,
  PartnerScopeAgreement,
} from './types'
import type { SharedBusinessCapability } from '@/lib/business-relationships/types'

// ── State machines ───────────────────────────────────────────────────────────

export interface LifecycleTransition {
  from: string[]
  to: string
}

export const PARTNER_LINK_TRANSITIONS: LifecycleTransition[] = [
  { from: ['active', 'paused'], to: 'active' },
  { from: ['active'], to: 'paused' },
  { from: ['active', 'paused'], to: 'revoked' },
  { from: ['revoked'], to: 'archived' },
]

export const SCOPE_AGREEMENT_TRANSITIONS: LifecycleTransition[] = [
  { from: ['draft', 'proposed'], to: 'proposed' },
  { from: ['draft', 'proposed', 'paused'], to: 'active' },
  { from: ['active'], to: 'paused' },
  { from: ['draft', 'proposed', 'active', 'paused'], to: 'revoked' },
  { from: ['draft', 'proposed', 'active', 'paused'], to: 'expired' },
]

export const RESOURCE_GRANT_TRANSITIONS: LifecycleTransition[] = [
  { from: ['active', 'paused'], to: 'active' },
  { from: ['active'], to: 'paused' },
  { from: ['active', 'paused'], to: 'revoked' },
  { from: ['active', 'paused'], to: 'expired' },
]

export function canTransition(
  transitions: LifecycleTransition[],
  from: string | undefined,
  to: string,
): boolean {
  return transitions.some((t) => t.to === to && t.from.includes(from ?? ''))
}

export function normalizeTransitionStatus(value: unknown, transitions: LifecycleTransition[]): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return transitions.some((t) => t.from.includes(trimmed) || t.to === trimmed) ? trimmed : ''
}

// ── Cascade planning ─────────────────────────────────────────────────────────

export type CascadeRevokeReason =
  | 'link.unlinked'
  | 'capability.reduced'
  | 'field.narrowed'
  | 'agreement.revoked'
  | 'membership.offboarded'
  | 'identity.link_revoked'

export interface CascadePlan {
  /** Scope agreements that must be revoked. */
  revokeAgreementIds: string[]
  /** Resource grants that must be revoked. */
  revokeGrantIds: string[]
  /** Identity links that must be revoked. */
  revokeIdentityLinkIds: string[]
  /** Grant ids that must be frozen (temporary pause) instead of revoked. */
  freezeGrantIds: string[]
  /** Grants that survive unchanged. */
  keepGrantIds: string[]
  /** Audit event types to emit as part of the cascade. */
  events: Array<{
    eventType: string
    reason: CascadeRevokeReason
    partnerLinkId?: string
    scopeAgreementId?: string
    resourceGrantId?: string
    identityLinkId?: string
    metadata?: Record<string, unknown>
  }>
}

/**
 * Plan the cascade from a link unlink. Revokes every agreement and grant on the
 * link, plus identity links derived from it. All-or-nothing: the caller must
 * apply every revoke in the plan.
 */
export function planLinkUnlinkCascade(input: {
  link: PartnerLink
  agreements: PartnerScopeAgreement[]
  grants: PartnerResourceGrant[]
  identityLinkIds: string[]
  freezeCapabilities?: SharedBusinessCapability[]
}): CascadePlan {
  const plan: CascadePlan = {
    revokeAgreementIds: [],
    revokeGrantIds: [],
    revokeIdentityLinkIds: [...input.identityLinkIds],
    freezeGrantIds: [],
    keepGrantIds: [],
    events: [],
  }

  const linkId = input.link.partnerLinkId || input.link.id

  for (const agreement of input.agreements) {
    if (agreement.partnerLinkId === linkId) {
      plan.revokeAgreementIds.push(agreement.id)
      plan.events.push({
        eventType: 'scope_agreement.revoked',
        reason: 'link.unlinked',
        partnerLinkId: linkId,
        scopeAgreementId: agreement.id,
        metadata: { fromStatus: agreement.status },
      })
    }
  }

  for (const grant of input.grants) {
    const onLink = grant.partnerLinkId === linkId
    const onRevokedAgreement = Boolean(
      grant.scopeAgreementId && plan.revokeAgreementIds.includes(grant.scopeAgreementId),
    )
    if (!onLink && !onRevokedAgreement) {
      plan.keepGrantIds.push(grant.id)
      continue
    }
    if (grant.status !== 'active') {
      plan.keepGrantIds.push(grant.id)
      continue
    }
    plan.revokeGrantIds.push(grant.id)
    plan.events.push({
      eventType: 'resource_grant.revoked',
      reason: 'link.unlinked',
      partnerLinkId: linkId,
      resourceGrantId: grant.id,
      metadata: { fromStatus: grant.status },
    })
  }

  return plan
}

/**
 * Plan the cascade from a capability reduction on a directional scope
 * agreement. Grants that require the removed capability/field are revoked;
 * grants that still fit are kept. Optional `freezeCapabilities` freezes instead
 * of revoking (module-level freeze semantics).
 */
export function planCapabilityReductionCascade(input: {
  agreement: PartnerScopeAgreement
  removedCapabilities: SharedBusinessCapability[]
  narrowedFields?: string[]
  grants: PartnerResourceGrant[]
  freezeCapabilities?: SharedBusinessCapability[]
}): CascadePlan {
  const plan: CascadePlan = {
    revokeAgreementIds: [],
    revokeGrantIds: [],
    revokeIdentityLinkIds: [],
    freezeGrantIds: [],
    keepGrantIds: [],
    events: [],
  }

  const removed = new Set<string>(input.removedCapabilities)
  const narrowed = new Set<string>(input.narrowedFields ?? [])

  for (const grant of input.grants) {
    if (grant.scopeAgreementId !== input.agreement.id) {
      plan.keepGrantIds.push(grant.id)
      continue
    }
    if (grant.status !== 'active') {
      plan.keepGrantIds.push(grant.id)
      continue
    }

    const grantCapability = requiredCapabilityForActions(grant.actions)
    const dependsOnRemoved = grantCapability ? removed.has(grantCapability) : false
    const dependsOnNarrowedField = (grant.fields ?? []).some((field) => narrowed.has(field))
    const dependsOnNarrowedItem = (grant.items ?? []).some((item) => narrowed.has(item))

    if (!dependsOnRemoved && !dependsOnNarrowedField && !dependsOnNarrowedItem) {
      plan.keepGrantIds.push(grant.id)
      continue
    }

    const freeze = input.freezeCapabilities?.includes(grantCapability ?? ('' as SharedBusinessCapability))
    if (freeze) {
      plan.freezeGrantIds.push(grant.id)
      plan.events.push({
        eventType: 'resource_grant.revoked',
        reason: 'capability.reduced',
        scopeAgreementId: input.agreement.id,
        resourceGrantId: grant.id,
        metadata: { mode: 'freeze', removedCapabilities: input.removedCapabilities },
      })
    } else {
      plan.revokeGrantIds.push(grant.id)
      plan.events.push({
        eventType: 'resource_grant.revoked',
        reason: 'capability.reduced',
        scopeAgreementId: input.agreement.id,
        resourceGrantId: grant.id,
        metadata: { removedCapabilities: input.removedCapabilities },
      })
    }
  }

  plan.events.push({
    eventType: 'capability.reduced',
    reason: 'capability.reduced',
    scopeAgreementId: input.agreement.id,
    metadata: {
      removedCapabilities: input.removedCapabilities,
      narrowedFields: input.narrowedFields ?? [],
    },
  })

  return plan
}

/**
 * Evaluate expiry lazily. Returns the next status for a grant/agreement whose
 * expiresAt has passed, or the current status when not expired.
 */
export function evaluateExpiry(input: {
  status: string
  expiresAt?: unknown
  now?: Date
}): { status: string; expired: boolean } {
  if (input.status === 'revoked' || input.status === 'archived') {
    return { status: input.status, expired: false }
  }
  if (!input.expiresAt) return { status: input.status, expired: false }
  const now = input.now ?? new Date()
  const ts = input.expiresAt as {
    toMillis?: () => number
    seconds?: number
    _seconds?: number
    getTime?: () => number
  }
  let millis: number
  if (typeof ts === 'object' && ts && typeof ts.toMillis === 'function') {
    millis = ts.toMillis()
  } else if (typeof ts === 'object' && ts && typeof ts.seconds === 'number') {
    millis = ts.seconds * 1000
  } else if (typeof input.expiresAt === 'string') {
    millis = Date.parse(input.expiresAt)
    if (Number.isNaN(millis)) return { status: input.status, expired: false }
  } else if (input.expiresAt instanceof Date) {
    millis = input.expiresAt.getTime()
  } else {
    return { status: input.status, expired: false }
  }
  if (millis < now.getTime()) return { status: 'expired', expired: true }
  return { status: input.status, expired: false }
}

/**
 * Map grant actions to the capability family they depend on. Adapters declare
 * their own mapping; the default covers the known PiB modules.
 */
const ACTION_CAPABILITY: Record<string, SharedBusinessCapability> = {
  'crm.read': 'crm',
  'crm.write': 'crm',
  'project.read': 'projects',
  'project.write': 'projects',
  'document.read': 'documents',
  'document.write': 'documents',
  'order.read': 'orders',
  'order.write': 'orders',
  'shipment.read': 'shipments',
  'shipment.write': 'shipments',
  'inventory.read': 'inventory',
  'inventory.write': 'inventory',
  'invoice.read': 'invoices',
  'invoice.write': 'invoices',
  'analytics.read': 'analytics',
  'support.read': 'support',
  'support.write': 'support',
  'service.read': 'services',
  'service.write': 'services',
}

export function requiredCapabilityForActions(actions: string[]): SharedBusinessCapability | undefined {
  for (const action of actions) {
    const capability = ACTION_CAPABILITY[action]
    if (capability) return capability
  }
  return undefined
}
