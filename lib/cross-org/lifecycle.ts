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
  MemberRef,
} from '@/lib/orgMembers/memberRef'
import type {
  PartnerLink,
  PartnerResourceGrant,
  PartnerScopeAgreement,
  ScopeAgreementAcceptanceSide,
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

    const grantCapability = capabilityForGrant(grant)
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
  'document.version.read': 'documents',
  'document.download': 'documents',
  'document.comment': 'documents',
  'document.suggest': 'documents',
  'document.approve': 'documents',
  'document.accept': 'documents',
  'document.sign': 'documents',
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
  'messages.read': 'messages',
  'messages.write': 'messages',
  'messages.reply': 'messages',
  'messages.manage': 'messages',
  'conversation.read': 'messages',
  'conversation.reply': 'messages',
  'conversation.manage': 'messages',
  'attachment.read': 'messages',
  'attachment.upload': 'messages',
  'agent.append': 'messages',
}

const RESOURCE_CAPABILITY: Partial<Record<PartnerResourceGrant['resourceType'], SharedBusinessCapability>> = {
  research: 'research',
  property: 'properties',
  conversation: 'messages',
}

/**
 * Research and property grants use intentionally generic action labels
 * (`view`, `comment`, `contribute`, `approve`). Derive their lifecycle
 * capability from the typed resource, never from a generic action that could
 * collide with another module.
 */
export function capabilityForGrant(grant: PartnerResourceGrant): SharedBusinessCapability | undefined {
  return RESOURCE_CAPABILITY[grant.resourceType] ?? requiredCapabilityForActions(grant.actions)
}

export function requiredCapabilityForActions(actions: string[]): SharedBusinessCapability | undefined {
  for (const action of actions) {
    const capability = ACTION_CAPABILITY[action]
    if (capability) return capability
  }
  return undefined
}

// ── Bilateral directional scope acceptance ───────────────────────────────────

export type ScopeAgreementSide = 'grantor' | 'grantee'

/**
 * Record one side's acceptance of a directional scope agreement. The agreement
 * can only become `active` when BOTH the grantor and the grantee have accepted
 * (bilateral directional acceptance). Returns the next agreement snapshot plus
 * whether the agreement is now fully accepted and may activate.
 *
 * Idempotent: accepting the same side twice is a no-op that keeps the existing
 * acceptance record.
 */
export function recordScopeAgreementAcceptance(input: {
  agreement: PartnerScopeAgreement
  side: ScopeAgreementSide
  byRef: MemberRef
  at?: unknown
}): {
  agreement: PartnerScopeAgreement
  fullyAccepted: boolean
  canActivate: boolean
} {
  const { agreement, side, byRef } = input
  const at = input.at ?? new Date()
  const sideRecord: ScopeAgreementAcceptanceSide = { byRef, at }

  const acceptance = {
    grantor: agreement.acceptance?.grantor,
    grantee: agreement.acceptance?.grantee,
  }
  if (side === 'grantor') {
    acceptance.grantor = sideRecord
  } else {
    acceptance.grantee = sideRecord
  }

  const fullyAccepted = Boolean(acceptance.grantor && acceptance.grantee)
  const next: PartnerScopeAgreement = {
    ...agreement,
    acceptance,
    updatedAt: at,
    // Legacy compatibility pointer: keep acceptedByRef in sync with the
    // grantee side when that is the side being accepted (the historic meaning).
    ...(side === 'grantee' ? { acceptedByRef: byRef } : {}),
  }
  // Promote to active when both sides accepted and the agreement is not
  // already in a terminal state.
  const canActivate =
    fullyAccepted &&
    (agreement.status === 'draft' || agreement.status === 'proposed' || agreement.status === 'paused')
  if (canActivate && next.status !== 'active') {
    next.status = 'active'
    next.effectiveAt = next.effectiveAt ?? at
  }
  return { agreement: next, fullyAccepted, canActivate }
}

/**
 * True when the agreement has bilateral acceptance recorded (both sides).
 * Legacy rows that only carry `acceptedByRef` (single-side) are NOT fully
 * accepted; the missing side must be recorded before the agreement is treated
 * as active under the canonical model.
 */
export function hasBilateralAcceptance(agreement: PartnerScopeAgreement): boolean {
  return Boolean(agreement.acceptance?.grantor && agreement.acceptance?.grantee)
}

// ── Per-module cascade rules (capability-reduction state machine) ───────────

import type {
  CrossOrgModule,
  ModuleCascadeAction,
  ModuleCascadePlan,
  ModuleCascadeRule,
  ModuleCascadeTarget,
} from './types'

/**
 * Canonical per-module cascade rules. These encode the documented
 * capability-reduction state machine
 * (docs/architecture/cross-org-lifecycle-revocation.md): turning off a
 * capability or unlinking immediately revokes/freezes/reconciles the affected
 * module artifacts. `reconcile` is an evidence run (no state change) used for
 * agent caches and derived surfaces; `revoke` is permanent; `freeze` is a
 * temporary pause that can be reversed by restoring the capability.
 */
export const MODULE_CASCADE_RULES: ModuleCascadeRule[] = [
  {
    module: 'shares',
    onUnlink: 'revoke',
    onCapabilityRemoved: 'revoke',
    onFieldNarrowed: 'reconcile',
    rationale: 'partner_record_shares grant access to records; they cannot outlive the link or the capability that justified them.',
  },
  {
    module: 'project_grants',
    capability: 'projects',
    onUnlink: 'revoke',
    onCapabilityRemoved: 'revoke',
    onFieldNarrowed: 'reconcile',
    rationale: 'projectOrganizations rows grant workspace access; they must be revoked when projects capability is removed or the link dies.',
  },
  {
    module: 'catalogues',
    capability: 'orders',
    onUnlink: 'freeze',
    onCapabilityRemoved: 'freeze',
    onFieldNarrowed: 'reconcile',
    rationale: 'partner_catalog_items freeze (stop serving) when orders capability is removed or the link dies; history is retained for reconciliation.',
  },
  {
    module: 'open_orders',
    capability: 'orders',
    onUnlink: 'freeze',
    onCapabilityRemoved: 'freeze',
    onFieldNarrowed: 'reconcile',
    rationale: 'open orders freeze so they cannot be confirmed/fulfilled/settled after the capability is removed or the link dies; no data is deleted.',
  },
  {
    module: 'settlements',
    capability: 'invoices',
    onUnlink: 'freeze',
    onCapabilityRemoved: 'freeze',
    onFieldNarrowed: 'reconcile',
    rationale: 'cross-org settlement surfaces close (freeze) when invoices capability is removed or the link dies; outstanding settlements stay frozen for reconciliation.',
  },
  {
    module: 'attachments',
    capability: 'documents',
    onUnlink: 'revoke',
    onCapabilityRemoved: 'revoke',
    onFieldNarrowed: 'revoke',
    rationale: 'attachment URLs must stop resolving immediately when the link, capability, or shared field that exposed them is removed.',
  },
  {
    module: 'messages',
    onUnlink: 'freeze',
    onCapabilityRemoved: 'freeze',
    onFieldNarrowed: 'reconcile',
    rationale: 'relationship message threads freeze (read-only for the partner) when a capability is removed or the link dies; history is preserved.',
  },
  {
    module: 'agent_caches',
    onUnlink: 'reconcile',
    onCapabilityRemoved: 'reconcile',
    onFieldNarrowed: 'reconcile',
    rationale: 'agent caches are derived surfaces; any change triggers an evidence-only reconcile run that invalidates affected keys.',
  },
  {
    module: 'company_workspace_grants',
    onUnlink: 'revoke',
    onCapabilityRemoved: 'reconcile',
    onFieldNarrowed: 'reconcile',
    rationale: 'company_workspace PartnerResourceGrant items must revoke on unlink and narrow when a shared capability is removed.',
  },
]

export function moduleCascadeRule(module: CrossOrgModule): ModuleCascadeRule {
  const rule = MODULE_CASCADE_RULES.find((r) => r.module === module)
  if (!rule) throw new Error(`no cascade rule for module ${module}`)
  return rule
}

export function actionForModule(input: {
  module: CrossOrgModule
  trigger: ModuleCascadePlan['trigger']['type']
}): ModuleCascadeAction {
  const rule = moduleCascadeRule(input.module)
  switch (input.trigger) {
    case 'link.unlinked':
      return rule.onUnlink
    case 'capability.reduced':
      return rule.onCapabilityRemoved
    case 'field.narrowed':
      return rule.onFieldNarrowed
    case 'membership.offboarded':
      // Offboarding revokes everything the offboarded member could reach.
      return 'revoke'
  }
}

/**
 * Build the per-module cascade plan for a link unlink or capability reduction.
 * Pure and deterministic: the same inputs always produce the same plan, so the
 * reconciler can replay it idempotently (see replayModuleCascade).
 *
 * `resourcesByModule` maps module -> record ids affected by the trigger. When
 * `capability` is supplied, only modules whose rule depends on that capability
 * (or rules with no capability binding) are included. When `field` is
 * supplied, only field-narrowed modules are included.
 */
export function planModuleCascade(input: {
  trigger: ModuleCascadePlan['trigger']
  resourcesByModule: Partial<Record<CrossOrgModule, string[]>>
}): ModuleCascadePlan {
  const { trigger, resourcesByModule } = input
  const targets: ModuleCascadeTarget[] = []
  const events: ModuleCascadePlan['events'] = []

  for (const rule of MODULE_CASCADE_RULES) {
    // Capability-driven trigger: skip modules bound to a different capability.
    if (trigger.type === 'capability.reduced' && trigger.capability) {
      if (rule.capability && rule.capability !== trigger.capability) continue
    }
    // Field-narrowed trigger: only modules with field-level revocation rules
    // participate (attachments revoke URLs; everything else reconciles).
    if (trigger.type === 'field.narrowed' && !trigger.field) continue

    const resourceIds = resourcesByModule[rule.module]
    if (!resourceIds || resourceIds.length === 0) continue

    const action = actionForModule({ module: rule.module, trigger: trigger.type })
    targets.push({
      module: rule.module,
      action,
      resourceIds: [...resourceIds],
      trigger: trigger.capability ?? trigger.field,
    })

    const eventType =
      action === 'revoke' ? 'module.revoked' : action === 'freeze' ? 'module.frozen' : 'module.reconciled'
    events.push({
      eventType,
      reason: `${trigger.type}.${rule.module}`,
      partnerLinkId: trigger.partnerLinkId,
      scopeAgreementId: trigger.scopeAgreementId,
      resourceType: rule.module,
      metadata: {
        module: rule.module,
        action,
        resourceIds,
        rationale: rule.rationale,
      },
    })
  }

  return { trigger, targets, events }
}

/**
 * Idempotent replay: re-running a module cascade must not double-revoke or
 * double-freeze records that are already in the target state. `alreadyInState`
 * should return true when a record id is already revoked/frozen/reconciled.
 * Reconcile actions are always safe to replay (evidence only) and return true
 * so the evidence event is emitted once per run key.
 */
export function shouldApplyModuleAction(input: {
  action: ModuleCascadeAction
  recordId: string
  alreadyInState: (recordId: string) => boolean
}): boolean {
  if (input.action === 'reconcile') return true
  return !input.alreadyInState(input.recordId)
}

/**
 * Deterministic replay key for a module cascade: stable across replays so the
 * reconciler can deduplicate audit events and idempotently apply the same
 * cascade twice without side effects.
 */
export function moduleCascadeReplayKey(input: {
  trigger: ModuleCascadePlan['trigger']
  targets: ModuleCascadeTarget[]
}): string {
  const parts = [
    input.trigger.type,
    input.trigger.partnerLinkId ?? '',
    input.trigger.scopeAgreementId ?? '',
    input.trigger.capability ?? '',
    input.trigger.field ?? '',
    ...input.targets
      .sort((a, b) => (a.module < b.module ? -1 : a.module > b.module ? 1 : 0))
      .map((t) => `${t.module}:${t.action}:${[...t.resourceIds].sort().join(',')}`),
  ]
  return parts.join('|')
}

// ── Orphan detection ─────────────────────────────────────────────────────────

export interface OrphanRecord {
  module: CrossOrgModule
  resourceId: string
  reason: string
  detail?: string
}

/**
 * Detect orphaned module artifacts: records that still reference a
 * partnerLinkId / scopeAgreementId / capability that no longer exists or is no
 * longer active. Orphans are records the cascade should have handled but did
 * not (e.g. a share whose link was revoked before the canonical cascade ran).
 * The reconciler reports orphans as `orphan.detected` events and applies the
 * module rule to them.
 */
export function detectOrphanedModuleRecords(input: {
  trigger: ModuleCascadePlan['trigger']
  /** For each module, records carrying the partnerLinkId/agreement id. */
  records: Partial<Record<CrossOrgModule, string[]>>
}): OrphanRecord[] {
  const { trigger, records } = input
  const orphans: OrphanRecord[] = []
  for (const moduleName of Object.keys(records) as CrossOrgModule[]) {
    const ids = records[moduleName] ?? []
    for (const resourceId of ids) {
      const rule = moduleCascadeRule(moduleName)
      orphans.push({
        module: moduleName,
        resourceId,
        reason: `${trigger.type}.orphan`,
        detail: `${rule.module} record still references a ${trigger.type} trigger after cascade`,
      })
    }
  }
  return orphans
}
