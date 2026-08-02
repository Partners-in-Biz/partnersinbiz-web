import type { DocumentData, Firestore } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { authorizeFinanceAction } from '@/lib/finance/policy'
import { canonicalDigest, scopedStorageId } from '@/lib/finance/integrity'
import type { FinanceActorContext, FinanceApprovalRecord, FinanceScope } from '@/lib/finance/types'
import {
  FinanceTaxService,
  InMemoryTaxStore,
  type ApproveTaxReturnCommand,
  type CalculateTaxCommand,
  type ChangeTaxPeriodStatusCommand,
  type CreateTaxCodeCommand,
  type CreateTaxPeriodCommand,
  type CreateTaxRuleVersionCommand,
  type PrepareTaxReturnCommand,
  type TaxServiceState,
} from './tax-service'

export type {
  ApproveTaxReturnCommand,
  CalculateTaxCommand,
  ChangeTaxPeriodStatusCommand,
  CreateTaxCodeCommand,
  CreateTaxPeriodCommand,
  CreateTaxRuleVersionCommand,
  PrepareTaxReturnCommand,
}
import type {
  TaxCode,
  TaxPeriod,
  TaxReturnSnapshot,
  TaxRuleVersion,
} from './tax-types'

function clean<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clean) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, clean(item)]),
    ) as T
  }
  return value
}

function matchesScope(data: DocumentData | undefined, scope: Required<FinanceScope>): boolean {
  return Boolean(
    data
    && data.orgId === scope.orgId
    && data.legalEntityId === scope.legalEntityId
    && data.bookId === scope.bookId,
  )
}

async function hydrateTaxStore(db: Firestore, scope: Required<FinanceScope>): Promise<InMemoryTaxStore> {
  const store = new InMemoryTaxStore()
  const [codes, rules, periods, returns, approvals, claims, idempotency, traces] = await Promise.all([
    db.collection('tax_codes').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('tax_rule_versions').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('tax_periods').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('tax_return_snapshots').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('finance_approvals').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('finance_unique_claims').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).get(),
    db.collection('finance_idempotency_claims').where('orgId', '==', scope.orgId).get(),
    db.collection('journal_tax_traces').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
  ])

  for (const doc of codes.docs) {
    const value = doc.data() as TaxCode
    if (matchesScope(value, scope)) store.taxCodes.set(value.id, value)
  }
  for (const doc of rules.docs) {
    const value = doc.data() as TaxRuleVersion
    if (matchesScope(value, scope)) store.taxRules.set(value.id, value)
  }
  for (const doc of periods.docs) {
    const value = doc.data() as TaxPeriod
    if (matchesScope(value, scope)) store.taxPeriods.set(value.id, value)
  }
  for (const doc of returns.docs) {
    const value = doc.data() as TaxReturnSnapshot
    if (matchesScope(value, scope)) store.taxReturns.set(value.id, value)
  }
  for (const doc of approvals.docs) {
    const value = doc.data() as FinanceApprovalRecord
    if (matchesScope(value, scope)) store.approvals.set(value.id, value)
  }
  for (const doc of claims.docs) {
    const data = doc.data()
    if (!data || data.orgId !== scope.orgId) continue
    if (data.bookId && data.bookId !== scope.bookId) continue
    if (typeof data.aggregateId === 'string') store.uniqueClaims.set(doc.id, data.aggregateId)
  }
  for (const doc of idempotency.docs) {
    const data = doc.data()
    if (!data || data.orgId !== scope.orgId) continue
    store.idempotency.set(doc.id, data as TaxServiceState['idempotency'] extends Map<string, infer V> ? V : never)
  }
  for (const doc of traces.docs) {
    store.journalTaxTraces.push(doc.data() as TaxServiceState['journalTaxTraces'][number])
  }
  return store
}

async function persistTaxStore(
  db: Firestore,
  scope: Required<FinanceScope>,
  before: TaxServiceState,
  after: TaxServiceState,
  actor: FinanceActorContext,
): Promise<void> {
  const batch = db.batch()
  const now = new Date().toISOString()

  const writeMap = <T extends { id: string }>(
    collection: string,
    previous: Map<string, T>,
    next: Map<string, T>,
  ) => {
    for (const [id, value] of next) {
      const prev = previous.get(id)
      if (prev && canonicalDigest(clean(prev)) === canonicalDigest(clean(value))) continue
      batch.set(db.collection(collection).doc(scopedStorageId(scope, id)), clean(value), { merge: false })
    }
  }

  writeMap('tax_codes', before.taxCodes, after.taxCodes)
  writeMap('tax_rule_versions', before.taxRules, after.taxRules)
  writeMap('tax_periods', before.taxPeriods, after.taxPeriods)
  writeMap('tax_return_snapshots', before.taxReturns, after.taxReturns)

  for (const [claimId, aggregateId] of after.uniqueClaims) {
    if (before.uniqueClaims.get(claimId) === aggregateId) continue
    batch.set(db.collection('finance_unique_claims').doc(claimId), clean({
      schemaVersion: 1,
      claimType: 'tax',
      orgId: scope.orgId,
      legalEntityId: scope.legalEntityId,
      bookId: scope.bookId,
      aggregateId,
      createdAt: now,
      createdBy: actor.uid,
    }), { merge: true })
  }

  for (const [idemId, record] of after.idempotency) {
    if (before.idempotency.has(idemId)) continue
    batch.set(db.collection('finance_idempotency_claims').doc(idemId), clean(record), { merge: false })
  }

  if (after.journalTaxTraces.length > before.journalTaxTraces.length) {
    const added = after.journalTaxTraces.slice(before.journalTaxTraces.length)
    for (const [index, trace] of added.entries()) {
      const id = `trace_${canonicalDigest({
        scope,
        index: before.journalTaxTraces.length + index,
        trace,
      }).slice(0, 40)}`
      batch.set(
        db.collection('journal_tax_traces').doc(scopedStorageId(scope, id)),
        clean({ ...scope, ...trace, id, schemaVersion: 1, createdAt: now }),
        { merge: false },
      )
    }
  }

  await batch.commit()
}

function snapshotState(store: InMemoryTaxStore): TaxServiceState {
  return {
    taxCodes: new Map(store.taxCodes),
    taxRules: new Map(store.taxRules),
    taxPeriods: new Map(store.taxPeriods),
    taxReturns: new Map(store.taxReturns),
    approvals: new Map(store.approvals),
    uniqueClaims: new Map(store.uniqueClaims),
    idempotency: new Map(store.idempotency),
    journalTaxTraces: structuredClone(store.journalTaxTraces),
  }
}

export class FirestoreFinanceTaxGateway {
  private readonly db: Firestore

  constructor(options: { db?: Firestore } = {}) {
    this.db = options.db ?? adminDb
  }

  private scopeOf(command: { orgId: string; legalEntityId: string; bookId: string }): Required<FinanceScope> {
    return { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
  }

  private async withService<T>(
    actor: FinanceActorContext,
    scope: Required<FinanceScope>,
    run: (service: FinanceTaxService) => Promise<T> | T,
  ): Promise<T> {
    const store = await hydrateTaxStore(this.db, scope)
    const before = snapshotState(store)
    const service = new FinanceTaxService(store)
    const result = await run(service)
    await persistTaxStore(this.db, scope, before, store, actor)
    return result
  }

  createTaxCode(actor: FinanceActorContext, command: CreateTaxCodeCommand) {
    return this.withService(actor, this.scopeOf(command), (service) => service.createTaxCode(actor, command))
  }

  createTaxRuleVersion(actor: FinanceActorContext, command: CreateTaxRuleVersionCommand) {
    return this.withService(actor, this.scopeOf(command), (service) => service.createTaxRuleVersion(actor, command))
  }

  createTaxPeriod(actor: FinanceActorContext, command: CreateTaxPeriodCommand) {
    return this.withService(actor, this.scopeOf(command), (service) => service.createTaxPeriod(actor, command))
  }

  changeTaxPeriodStatus(actor: FinanceActorContext, command: ChangeTaxPeriodStatusCommand) {
    return this.withService(actor, this.scopeOf(command), (service) => service.changeTaxPeriodStatus(actor, command))
  }

  prepareTaxReturn(actor: FinanceActorContext, command: PrepareTaxReturnCommand) {
    return this.withService(actor, this.scopeOf(command), (service) => service.prepareTaxReturn(actor, command))
  }

  approveTaxReturn(actor: FinanceActorContext, command: ApproveTaxReturnCommand) {
    return this.withService(actor, this.scopeOf(command), (service) => service.approveTaxReturn(actor, command))
  }

  async calculateTax(actor: FinanceActorContext, command: CalculateTaxCommand) {
    const store = await hydrateTaxStore(this.db, this.scopeOf(command))
    return new FinanceTaxService(store).calculateTax(actor, command)
  }

  async listBundle(actor: FinanceActorContext, scope: Required<FinanceScope>) {
    authorizeFinanceAction(actor, scope, 'tax.read')
    const store = await hydrateTaxStore(this.db, scope)
    return {
      taxCodes: [...store.taxCodes.values()].sort((a, b) => a.code.localeCompare(b.code)),
      taxRules: [...store.taxRules.values()].sort((a, b) => a.versionNumber - b.versionNumber),
      taxPeriods: [...store.taxPeriods.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      taxReturns: [...store.taxReturns.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }
  }
}
