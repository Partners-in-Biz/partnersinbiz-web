import { adminDb } from '@/lib/firebase/admin'
import type { FinanceActorContext } from '@/lib/finance/types'
import { createChunkedBatchWriter } from '@/lib/finance/scale/firestore-write'
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

/**
 * Org-scoped bank rules load.
 * Single-field equality on orgId (no composite index required for these reads).
 */
async function loadStore(orgId: string): Promise<BankRulesStore> {
  const db = adminDb
  const [rules, suggestions, claims] = await Promise.all([
    db.collection('finance_bank_rules').where('orgId', '==', orgId).limit(2000).get(),
    db.collection('finance_bank_rule_suggestions').where('orgId', '==', orgId).limit(10_000).get(),
    db.collection('finance_bank_rules_claims').where('orgId', '==', orgId).limit(10_000).get(),
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
  const writer = createChunkedBatchWriter(adminDb)
  for (const [id, value] of after.rules) {
    const prior = before.rules.get(id)
    if (prior && JSON.stringify(prior) === JSON.stringify(value)) continue
    await writer.set('finance_bank_rules', id, value)
  }
  for (const [id, value] of after.suggestions) {
    const prior = before.suggestions.get(id)
    if (prior && JSON.stringify(prior) === JSON.stringify(value)) continue
    await writer.set('finance_bank_rule_suggestions', id, value)
  }
  for (const key of after.claims) {
    if (before.claims.has(key)) continue
    const claimId = Buffer.from(key).toString('base64url').slice(0, 700)
    await writer.set('finance_bank_rules_claims', claimId, {
      id: claimId,
      orgId,
      key,
      createdAt: new Date().toISOString(),
    })
  }
  await writer.flush()
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
