import { FinanceAuthorizationError } from '@/lib/finance/policy'
import type { FinanceActorContext } from '@/lib/finance/types'
import type {
  CrossOrgFinanceAction,
  CrossOrgLinkEvidence,
  CrossOrgPaymentNotice,
  CrossOrgPaymentPerspective,
} from './types'

export class CrossOrgFinanceValidationError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'CrossOrgFinanceValidationError'
  }
}

export class CrossOrgFinanceNotFoundError extends Error {
  readonly statusCode = 404
  constructor(message: string) {
    super(message)
    this.name = 'CrossOrgFinanceNotFoundError'
  }
}

export interface NotifyCrossOrgPaymentCommand {
  id: string
  orgId: string
  recipientOrgId?: string
  sourceCompanyId?: string
  relationshipId?: string
  sourcePaymentId: string
  sourceLegalEntityId?: string
  sourceBookId?: string
  perspective: CrossOrgPaymentPerspective
  amountMinor: number
  currency: string
  description: string
  observedDate: string
  method?: CrossOrgPaymentNotice['method']
  externalReference?: string
  requestId: string
  idempotencyKey: string
}

export interface ResolveCrossOrgPaymentCommand {
  id: string
  orgId: string
  resolutionNote?: string
  /** Optional recipient-side payment observation id when confirming. */
  recipientPaymentId?: string
  requestId: string
  idempotencyKey: string
}

export interface CrossOrgFinanceStore {
  notices: Map<string, CrossOrgPaymentNotice>
  claims: Set<string>
}

export function createEmptyCrossOrgStore(): CrossOrgFinanceStore {
  return { notices: new Map(), claims: new Set() }
}

export function cloneCrossOrgStore(store: CrossOrgFinanceStore): CrossOrgFinanceStore {
  return {
    notices: new Map(store.notices),
    claims: new Set(store.claims),
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CrossOrgFinanceValidationError(`${field} is required`)
  }
  return value.trim()
}

function requiredInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new CrossOrgFinanceValidationError(`${field} must be an integer minor amount`)
  }
  return value
}

function claim(store: CrossOrgFinanceStore, key: string, message: string) {
  if (store.claims.has(key)) throw new CrossOrgFinanceValidationError(message)
  store.claims.add(key)
}

function hasFinanceRole(actor: FinanceActorContext, orgId: string): boolean {
  const isOrgAdmin = actor.membershipRole === 'owner' || actor.membershipRole === 'admin'
  if (isOrgAdmin) return true
  return actor.assignments.some(
    (a) =>
      a.orgId === orgId &&
      a.userId === actor.uid &&
      a.status === 'active' &&
      ['finance_admin', 'accountant', 'bookkeeper', 'finance_approver'].includes(a.role),
  )
}

function authorizeOrgFinanceAction(actor: FinanceActorContext, orgId: string, action: CrossOrgFinanceAction): void {
  if (!actor.membershipActive) throw new FinanceAuthorizationError('Active organization membership is required')
  if (actor.orgId !== orgId) throw new FinanceAuthorizationError('Actor organization does not match finance scope')
  if (!actor.financeModuleEnabled) throw new FinanceAuthorizationError('Persisted Finance module capability is required')
  if (!hasFinanceRole(actor, orgId)) {
    throw new FinanceAuthorizationError(`Finance role or org admin required for ${action}`)
  }
  if (actor.delegationId) {
    if (actor.delegationOrgId !== orgId) {
      throw new FinanceAuthorizationError('Delegation organization does not match finance scope')
    }
    const scopes = actor.delegationScopes ?? []
    const ok =
      scopes.includes('finance:*') ||
      scopes.some((s) => s.startsWith('finance:')) ||
      scopes.includes(`finance:${action}`) ||
      scopes.includes('finance:cross_org:*')
    if (!ok) throw new FinanceAuthorizationError('Delegation does not grant finance cross-org access')
  }
}

export type CrossOrgLinkResolver = (input: {
  sourceOrgId: string
  recipientOrgId?: string
  sourceCompanyId?: string
  relationshipId?: string
}) => Promise<CrossOrgLinkEvidence | null>

export class CrossOrgFinanceService {
  constructor(
    private readonly load: () => Promise<CrossOrgFinanceStore>,
    private readonly save: (before: CrossOrgFinanceStore, after: CrossOrgFinanceStore) => Promise<void>,
    private readonly resolveLink: CrossOrgLinkResolver,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async notifyPayment(
    actor: FinanceActorContext,
    command: NotifyCrossOrgPaymentCommand,
  ): Promise<CrossOrgPaymentNotice> {
    authorizeOrgFinanceAction(actor, command.orgId, 'cross_org.payment.notify')
    const id = requiredText(command.id, 'id')
    const sourcePaymentId = requiredText(command.sourcePaymentId, 'sourcePaymentId')
    const description = requiredText(command.description, 'description')
    const observedDate = requiredText(command.observedDate, 'observedDate')
    const amountMinor = requiredInt(command.amountMinor, 'amountMinor')
    if (amountMinor <= 0) throw new CrossOrgFinanceValidationError('amountMinor must be positive')
    if (command.perspective !== 'inbound_to_recipient' && command.perspective !== 'outbound_from_recipient') {
      throw new CrossOrgFinanceValidationError('perspective must be inbound_to_recipient or outbound_from_recipient')
    }
    if (command.recipientOrgId && command.recipientOrgId === command.orgId) {
      throw new CrossOrgFinanceValidationError('recipientOrgId must differ from source orgId')
    }

    const link = await this.resolveLink({
      sourceOrgId: command.orgId,
      recipientOrgId: command.recipientOrgId,
      sourceCompanyId: command.sourceCompanyId,
      relationshipId: command.relationshipId,
    })
    if (!link) {
      throw new CrossOrgFinanceValidationError(
        'No lawful cross-org link found (company.linkedOrgId or active businessRelationship required)',
      )
    }
    if (command.recipientOrgId && command.recipientOrgId !== link.recipientOrgId) {
      throw new CrossOrgFinanceValidationError('recipientOrgId does not match resolved CRM/relationship link')
    }
    if (link.recipientOrgId === command.orgId) {
      throw new CrossOrgFinanceValidationError('Resolved recipient org must differ from source org')
    }

    const before = await this.load()
    const after = cloneCrossOrgStore(before)
    claim(after, `idem:notify:${command.orgId}:${command.idempotencyKey}`, 'Duplicate idempotency key')
    claim(after, `notice:${id}`, 'Cross-org payment notice already exists')
    claim(
      after,
      `source-payment:${command.orgId}:${sourcePaymentId}:${link.recipientOrgId}`,
      'Source payment already notified to this recipient',
    )

    const now = this.now()
    const notice: CrossOrgPaymentNotice = {
      id,
      sourceOrgId: command.orgId,
      recipientOrgId: link.recipientOrgId,
      sourceCompanyId: link.sourceCompanyId || command.sourceCompanyId,
      relationshipId: link.relationshipId || command.relationshipId,
      sourcePaymentId,
      sourceLegalEntityId: command.sourceLegalEntityId,
      sourceBookId: command.sourceBookId,
      perspective: command.perspective,
      amountMinor,
      currency: (command.currency || 'ZAR').toUpperCase(),
      description,
      observedDate,
      method: command.method,
      externalReference: command.externalReference,
      status: 'notified',
      notifiedBy: actor.uid,
      notifiedAt: now,
      schemaVersion: 1,
      version: 1,
      externalPaymentInitiated: false,
    }
    after.notices.set(id, notice)
    await this.save(before, after)
    return notice
  }

  private async resolveAsRecipient(
    actor: FinanceActorContext,
    command: ResolveCrossOrgPaymentCommand,
    nextStatus: 'confirmed' | 'disputed' | 'dismissed',
    action: CrossOrgFinanceAction,
  ): Promise<CrossOrgPaymentNotice> {
    authorizeOrgFinanceAction(actor, command.orgId, action)
    const before = await this.load()
    const existing = before.notices.get(command.id)
    if (!existing || existing.recipientOrgId !== command.orgId) {
      throw new CrossOrgFinanceNotFoundError('Cross-org payment notice not found for recipient org')
    }
    if (existing.status !== 'notified') {
      throw new CrossOrgFinanceValidationError(`Only notified notices can be ${nextStatus}`)
    }
    if (existing.externalPaymentInitiated !== false) {
      throw new CrossOrgFinanceValidationError('Notice must not initiate external payment rails')
    }

    const after = cloneCrossOrgStore(before)
    claim(after, `idem:resolve:${command.orgId}:${command.idempotencyKey}`, 'Duplicate idempotency key')
    const now = this.now()
    const next: CrossOrgPaymentNotice = {
      ...existing,
      status: nextStatus,
      resolvedAt: now,
      resolvedBy: actor.uid,
      resolutionNote: command.resolutionNote?.trim() || undefined,
      recipientPaymentId: nextStatus === 'confirmed' ? command.recipientPaymentId : existing.recipientPaymentId,
      version: existing.version + 1,
      externalPaymentInitiated: false,
    }
    after.notices.set(existing.id, next)
    await this.save(before, after)
    return next
  }

  confirmPayment(actor: FinanceActorContext, command: ResolveCrossOrgPaymentCommand) {
    return this.resolveAsRecipient(actor, command, 'confirmed', 'cross_org.payment.confirm')
  }

  disputePayment(actor: FinanceActorContext, command: ResolveCrossOrgPaymentCommand) {
    return this.resolveAsRecipient(actor, command, 'disputed', 'cross_org.payment.dispute')
  }

  dismissPayment(actor: FinanceActorContext, command: ResolveCrossOrgPaymentCommand) {
    return this.resolveAsRecipient(actor, command, 'dismissed', 'cross_org.payment.dismiss')
  }

  async listForOrg(
    actor: FinanceActorContext,
    orgId: string,
    view: 'inbox' | 'sent' | 'all' = 'all',
  ): Promise<{ notices: CrossOrgPaymentNotice[]; externalPaymentInitiated: false }> {
    authorizeOrgFinanceAction(actor, orgId, 'cross_org.payment.read')
    const store = await this.load()
    const notices = [...store.notices.values()]
      .filter((n) => {
        if (view === 'inbox') return n.recipientOrgId === orgId
        if (view === 'sent') return n.sourceOrgId === orgId
        return n.recipientOrgId === orgId || n.sourceOrgId === orgId
      })
      .sort((a, b) => b.notifiedAt.localeCompare(a.notifiedAt))
    return { notices, externalPaymentInitiated: false }
  }
}
