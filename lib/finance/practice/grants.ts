/**
 * Firm → client practice grants (beyond membership switcher).
 * Least-privilege tiers: prepare | review | file-export.
 * No client-visible messages; packaging remains egress-closed; no pay/SARS.
 */

import { FinanceAuthorizationError } from '@/lib/finance/policy'
import type { FinanceAction } from '@/lib/finance/policy'
import type { FinanceActorContext } from '@/lib/finance/types'
import type {
  PracticeClientGrant,
  PracticeClientLink,
  PracticeGrantAccessEvent,
  PracticeGrantRole,
  PracticeQueueItem,
} from './types'

export const PRACTICE_GRANT_ROLES: readonly PracticeGrantRole[] = ['prepare', 'review', 'file-export'] as const

/** Actions a grant role may perform on the client books (subset of FinanceAction). */
export const PRACTICE_GRANT_ALLOWED_ACTIONS: Record<PracticeGrantRole, readonly FinanceAction[]> = {
  prepare: [
    'foundation.read',
    'journal.create',
    'invoice.create',
    'invoice.read',
    'supplier_bill.create',
    'supplier_bill.read',
    'bank.import',
    'bank.read',
    'reconciliation.create',
    'reconciliation.match',
    'reconciliation.submit',
    'reconciliation.read',
    'expense_claim.create',
    'expense_claim.update',
    'expense_claim.submit',
    'expense_claim.receipt.attach',
    'expense_claim.ocr.assist',
    'expense_claim.ocr.confirm',
    'expense_claim.ocr.dismiss',
    'expense_claim.read',
    'report.read',
    'tax.read',
    'period_close.read',
    'attachment.add',
    'attachment.read',
    'aging.read',
    'payment.read',
    'statement.draft',
    'statement.read',
  ],
  review: [
    'foundation.read',
    'report.read',
    'tax.read',
    'invoice.read',
    'supplier_bill.read',
    'payment.read',
    'bank.read',
    'reconciliation.read',
    'audit.read',
    'period_close.read',
    'expense_claim.read',
    'payroll.statutory.read',
    'payroll.structure.read',
    'aging.read',
    'statement.read',
    'attachment.read',
    'revenue.read',
    'revenue.report.read',
    'asset.read',
    'asset.report.read',
    'inventory.read',
    'inventory.report.read',
    'job_costing.read',
    'consolidation.read',
    'intercompany.read',
  ],
  'file-export': [
    'foundation.read',
    'report.read',
    'tax.read',
    'invoice.read',
    'supplier_bill.read',
    'payment.read',
    'statement.read',
    'payroll.export.generate',
    'payroll.statutory.read',
    'expense_claim.payment_instruction.export',
    'attachment.read',
  ],
}

/** Hard-denied even if someone later widens grant maps (defense in depth). */
export const PRACTICE_GRANT_HARD_DENY_ACTIONS: readonly FinanceAction[] = [
  'payroll.run.approve',
  'payroll.run.reverse',
  'payroll.tax_year.lock',
  'payroll.statutory.approve',
  'payroll.export.approve',
  'period.close',
  'period.reopen',
  'journal.post',
  'journal.reverse',
  'reconciliation.approve',
  'role.assign',
  'foundation.configure',
  'book-policy.approve',
  'tax.return.approve',
  'intercompany.receive_approve',
  'consolidation.approve',
  'expense_claim.approve',
  'expense_claim.bulk_approve',
  'expense_claim.post',
  'revenue.recognition.run.post',
  'revenue.recognition.run.reverse',
] as const

export function isPracticeGrantRole(value: unknown): value is PracticeGrantRole {
  return value === 'prepare' || value === 'review' || value === 'file-export'
}

export function grantAllowsAction(role: PracticeGrantRole, action: FinanceAction): boolean {
  if ((PRACTICE_GRANT_HARD_DENY_ACTIONS as readonly string[]).includes(action)) return false
  return (PRACTICE_GRANT_ALLOWED_ACTIONS[role] as readonly string[]).includes(action)
}

export function findActiveGrant(input: {
  grants: Iterable<PracticeClientGrant>
  granteeUserId: string
  clientOrgId: string
  legalEntityId?: string
  bookId?: string
}): PracticeClientGrant | null {
  for (const grant of input.grants) {
    if (grant.status !== 'active') continue
    if (grant.granteeUserId !== input.granteeUserId) continue
    if (grant.clientOrgId !== input.clientOrgId) continue
    if (grant.legalEntityIds?.length) {
      if (!input.legalEntityId || !grant.legalEntityIds.includes(input.legalEntityId)) continue
    }
    if (grant.bookIds?.length) {
      if (!input.bookId || !grant.bookIds.includes(input.bookId)) continue
    }
    return grant
  }
  return null
}

/**
 * Authorize a grantee (firm staff) to act on client books via grant.
 * Does not require client org membership — that is the point of firm→client ACL.
 * Actor.orgId must be the firm that owns the grant (or equal client when dual-scoped tests set firm).
 */
export function authorizePracticeGrantAction(input: {
  actor: FinanceActorContext
  firmOrgId: string
  clientOrgId: string
  action: FinanceAction
  grants: Iterable<PracticeClientGrant>
  legalEntityId?: string
  bookId?: string
}): PracticeClientGrant {
  const { actor, firmOrgId, clientOrgId, action } = input
  if (!actor.membershipActive) {
    throw new FinanceAuthorizationError('Active organization membership is required')
  }
  if (!actor.financeModuleEnabled) {
    throw new FinanceAuthorizationError('Persisted Finance module capability is required')
  }
  // Actor must be operating from the firm workspace that issued the grant.
  if (actor.orgId !== firmOrgId) {
    throw new FinanceAuthorizationError('Actor organization does not match practice firm scope')
  }
  if ((PRACTICE_GRANT_HARD_DENY_ACTIONS as readonly string[]).includes(action)) {
    throw new FinanceAuthorizationError(`Practice grant cannot perform ${action}`)
  }
  const grant = findActiveGrant({
    grants: input.grants,
    granteeUserId: actor.uid,
    clientOrgId,
    legalEntityId: input.legalEntityId,
    bookId: input.bookId,
  })
  if (!grant || grant.firmOrgId !== firmOrgId) {
    throw new FinanceAuthorizationError('No active practice grant covers this client scope')
  }
  if (!grantAllowsAction(grant.role, action)) {
    throw new FinanceAuthorizationError(`Practice grant role ${grant.role} cannot perform ${action}`)
  }
  if (grant.clientVisibleMessagesAllowed !== false) {
    throw new FinanceAuthorizationError('Practice grant must keep clientVisibleMessagesAllowed=false')
  }
  if (grant.externalEgressAllowed !== false) {
    throw new FinanceAuthorizationError('Practice grant must keep externalEgressAllowed=false')
  }
  return grant
}

export function buildPracticeQueue(input: {
  firmOrgId: string
  links: Iterable<PracticeClientLink>
  grants: Iterable<PracticeClientGrant>
}): PracticeQueueItem[] {
  const grantsByClient = new Map<string, PracticeClientGrant[]>()
  for (const g of input.grants) {
    if (g.firmOrgId !== input.firmOrgId || g.status !== 'active') continue
    const list = grantsByClient.get(g.clientOrgId) ?? []
    list.push(g)
    grantsByClient.set(g.clientOrgId, list)
  }

  const items: PracticeQueueItem[] = []
  for (const link of input.links) {
    if (link.firmOrgId !== input.firmOrgId || link.status !== 'active') continue
    const grants = grantsByClient.get(link.clientOrgId) ?? []
    const blockers = link.closeBlockerCount ?? 0
    const openPeriods = link.openPeriodCount ?? 0
    const recon = link.reconBacklogCount ?? 0

    let attention: PracticeQueueItem['attention'] = 'grant_only'
    let severity: PracticeQueueItem['severity'] = 'info'
    let summary = 'Client linked; no elevated attention signals'

    if (blockers > 0) {
      attention = 'close_blocker'
      severity = 'high'
      summary = `${blockers} close blocker(s) need attention`
    } else if (openPeriods > 0) {
      attention = 'open_period'
      severity = openPeriods >= 2 ? 'warning' : 'info'
      summary = `${openPeriods} open period(s)`
    } else if (recon > 0) {
      attention = 'recon_backlog'
      severity = recon >= 10 ? 'warning' : 'info'
      summary = `${recon} recon item(s) in backlog`
    } else if (grants.length === 0) {
      summary = 'Linked client with no active practice grants'
    } else {
      summary = `${grants.length} active grant(s); queue healthy`
    }

    items.push({
      clientOrgId: link.clientOrgId,
      clientName: link.clientName,
      attention,
      severity,
      summary,
      grantIds: grants.map((g) => g.id),
      openPeriodCount: openPeriods,
      closeBlockerCount: blockers,
      reconBacklogCount: recon,
      firmOrgId: input.firmOrgId,
    })
  }

  const rank = { high: 0, warning: 1, info: 2 }
  return items.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      a.clientName.localeCompare(b.clientName),
  )
}

export function grantSafetyFlags(): PracticeClientGrant['clientVisibleMessagesAllowed'] extends false
  ? {
      clientVisibleMessagesAllowed: false
      externalEgressAllowed: false
      externalPaymentInitiated: false
      sarsSubmissionInitiated: false
    }
  : never {
  return {
    clientVisibleMessagesAllowed: false,
    externalEgressAllowed: false,
    externalPaymentInitiated: false,
    sarsSubmissionInitiated: false,
  }
}

export function newGrantAccessEvent(input: {
  id: string
  grant: PracticeClientGrant
  actorUserId: string
  action: PracticeGrantAccessEvent['action']
  resource?: string
  financeAction?: string
  occurredAt: string
  reason?: string
  sequence: number
}): PracticeGrantAccessEvent {
  return {
    id: input.id,
    schemaVersion: 1,
    firmOrgId: input.grant.firmOrgId,
    clientOrgId: input.grant.clientOrgId,
    grantId: input.grant.id,
    actorUserId: input.actorUserId,
    action: input.action,
    resource: input.resource,
    financeAction: input.financeAction,
    occurredAt: input.occurredAt,
    reason: input.reason,
    sequence: input.sequence,
    externalEgressAllowed: false,
    clientVisibleMessagesAllowed: false,
  }
}
