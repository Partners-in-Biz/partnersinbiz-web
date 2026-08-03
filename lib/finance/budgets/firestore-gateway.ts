import { adminDb } from '@/lib/firebase/admin'
import type { FinanceActorContext } from '@/lib/finance/types'
import {
  BudgetsFinanceService,
  createEmptyBudgetsStore,
  type BudgetsStore,
  type BuildCashflowPlanCommand,
  type UpsertBudgetCommand,
  type UpsertForecastCommand,
} from './service'
import type { Budget, CashflowPlan, ForecastScenario } from './types'

function asMap<T extends { id: string }>(docs: FirebaseFirestore.QuerySnapshot): Map<string, T> {
  const map = new Map<string, T>()
  for (const doc of docs.docs) {
    const data = doc.data() as T
    if (data?.id) map.set(data.id, data)
    else map.set(doc.id, { ...(data as object), id: doc.id } as T)
  }
  return map
}

async function loadStore(orgId: string): Promise<BudgetsStore> {
  const db = adminDb
  const [budgets, forecasts, plans, claims] = await Promise.all([
    db.collection('finance_budgets').where('orgId', '==', orgId).get(),
    db.collection('finance_budget_forecasts').where('orgId', '==', orgId).get(),
    db.collection('finance_cashflow_plans').where('orgId', '==', orgId).get(),
    db.collection('finance_budgets_claims').where('orgId', '==', orgId).get(),
  ])
  const store = createEmptyBudgetsStore()
  store.budgets = asMap<Budget>(budgets)
  store.forecasts = asMap<ForecastScenario>(forecasts)
  store.cashflowPlans = asMap<CashflowPlan>(plans)
  for (const doc of claims.docs) {
    const key = (doc.data() as { key?: string }).key || doc.id
    store.claims.add(key)
  }
  return store
}

async function saveStore(orgId: string, before: BudgetsStore, after: BudgetsStore): Promise<void> {
  const db = adminDb
  const batch = db.batch()
  const writeMap = <T extends { id: string }>(collection: string, prev: Map<string, T>, next: Map<string, T>) => {
    for (const [id, value] of next) {
      const prior = prev.get(id)
      if (prior && JSON.stringify(prior) === JSON.stringify(value)) continue
      batch.set(db.collection(collection).doc(id), value, { merge: true })
    }
  }
  writeMap('finance_budgets', before.budgets, after.budgets)
  writeMap('finance_budget_forecasts', before.forecasts, after.forecasts)
  writeMap('finance_cashflow_plans', before.cashflowPlans, after.cashflowPlans)
  for (const key of after.claims) {
    if (before.claims.has(key)) continue
    const claimId = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(
      db.collection('finance_budgets_claims').doc(claimId),
      { id: claimId, orgId, key, createdAt: new Date().toISOString() },
      { merge: true },
    )
  }
  await batch.commit()
}

export class FirestoreBudgetsFinanceGateway {
  private service(orgId: string) {
    return new BudgetsFinanceService(
      () => loadStore(orgId),
      (before, after) => saveStore(orgId, before, after),
    )
  }

  upsertBudget(actor: FinanceActorContext, command: UpsertBudgetCommand) {
    return this.service(command.orgId).upsertBudget(actor, command)
  }

  upsertForecast(actor: FinanceActorContext, command: UpsertForecastCommand) {
    return this.service(command.orgId).upsertForecast(actor, command)
  }

  buildCashflowPlan(actor: FinanceActorContext, command: BuildCashflowPlanCommand) {
    return this.service(command.orgId).buildCashflowPlan(actor, command)
  }

  getBundle(actor: FinanceActorContext, orgId: string, legalEntityId: string, bookId: string) {
    return this.service(orgId).getBundle(actor, orgId, legalEntityId, bookId)
  }
}

export type { BuildCashflowPlanCommand, UpsertBudgetCommand, UpsertForecastCommand }
export { BudgetsFinanceService, createEmptyBudgetsStore, buildCashflowMonths } from './service'
