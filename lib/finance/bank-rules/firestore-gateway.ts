import { adminDb } from '@/lib/firebase/admin'
import type { FinanceActorContext } from '@/lib/finance/types'
import {
  BankRulesFinanceService,
  createEmptyBankRulesStore,
  type BankRulesStore,
  type EvaluateBankRulesCommand,
  type ResolveBankRuleSuggestionCommand,
  type UpsertBankRuleCommand,
} from './service'
import type { BankRule, BankRuleSuggestion } from './types'

function asMap<T extends { id: string }>(docs: FirebaseFirestore.QuerySnapshot): Map<string, T> {
  const map = new Map<string, T>()
  for (const doc of docs.docs) {
    const data = doc.data() as T
    if (data?.id) map.set(data.id, data)
    else map.set(doc.id, { ...(data as object), id: doc.id } as T)
  }
  return map
}

async function loadStore(orgId: string): Promise<BankRulesStore> {
  const db = adminDb
  const [rules, suggestions, claims] = await Promise.all([
    db.collection('finance_bank_rules').where('orgId', '==', orgId).get(),
    db.collection('finance_bank_rule_suggestions').where('orgId', '==', orgId).get(),
    db.collection('finance_bank_rules_claims').where('orgId', '==', orgId).get(),
  ])
  const store = createEmptyBankRulesStore()
  store.rules = asMap<BankRule>(rules)
  store.suggestions = asMap<BankRuleSuggestion>(suggestions)
  for (const doc of claims.docs) {
    const key = (doc.data() as { key?: string }).key || doc.id
    store.claims.add(key)
  }
  return store
}

async function saveStore(orgId: string, before: BankRulesStore, after: BankRulesStore): Promise<void> {
  const db = adminDb
  const batch = db.batch()
  const writeMap = <T extends { id: string }>(collection: string, prev: Map<string, T>, next: Map<string, T>) => {
    for (const [id, value] of next) {
      const prior = prev.get(id)
      if (prior && JSON.stringify(prior) === JSON.stringify(value)) continue
      batch.set(db.collection(collection).doc(id), value, { merge: true })
    }
  }
  writeMap('finance_bank_rules', before.rules, after.rules)
  writeMap('finance_bank_rule_suggestions', before.suggestions, after.suggestions)
  for (const key of after.claims) {
    if (before.claims.has(key)) continue
    const claimId = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(
      db.collection('finance_bank_rules_claims').doc(claimId),
      { id: claimId, orgId, key, createdAt: new Date().toISOString() },
      { merge: true },
    )
  }
  await batch.commit()
}

export class FirestoreBankRulesFinanceGateway {
  private service(orgId: string) {
    return new BankRulesFinanceService(
      () => loadStore(orgId),
      (before, after) => saveStore(orgId, before, after),
    )
  }

  upsertRule(actor: FinanceActorContext, command: UpsertBankRuleCommand) {
    return this.service(command.orgId).upsertRule(actor, command)
  }

  evaluate(actor: FinanceActorContext, command: EvaluateBankRulesCommand) {
    return this.service(command.orgId).evaluate(actor, command)
  }

  acceptSuggestion(actor: FinanceActorContext, command: ResolveBankRuleSuggestionCommand) {
    return this.service(command.orgId).acceptSuggestion(actor, command)
  }

  dismissSuggestion(actor: FinanceActorContext, command: ResolveBankRuleSuggestionCommand) {
    return this.service(command.orgId).dismissSuggestion(actor, command)
  }

  getBundle(actor: FinanceActorContext, orgId: string, legalEntityId: string, bookId: string) {
    return this.service(orgId).getBundle(actor, orgId, legalEntityId, bookId)
  }
}

export type { EvaluateBankRulesCommand, ResolveBankRuleSuggestionCommand, UpsertBankRuleCommand }
export { BankRulesFinanceService, createEmptyBankRulesStore }
