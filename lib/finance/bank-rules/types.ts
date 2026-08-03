/** Phase-4 bank rules + smarter recon — suggestions only; human-gated apply; never auto-pay. */

export type BankRuleMatchField = 'description' | 'counterparty' | 'reference' | 'amount'

export type BankRuleMatchOperator =
  | 'contains'
  | 'starts_with'
  | 'equals'
  | 'amount_equals'
  | 'amount_between'

export type BankRuleActionKind =
  | 'suggest_expense_account'
  | 'suggest_counterparty'
  | 'suggest_match_payment'
  | 'flag_review'

export type BankRuleStatus = 'active' | 'inactive'

export type BankRuleSuggestionStatus = 'pending' | 'accepted' | 'dismissed'

export interface BankRuleMatchCondition {
  field: BankRuleMatchField
  operator: BankRuleMatchOperator
  value?: string
  amountMinor?: number
  amountMaxMinor?: number
}

export interface BankRuleAction {
  kind: BankRuleActionKind
  /** GL / expense account suggestion when kind=suggest_expense_account. */
  accountId?: string
  counterpartyName?: string
  note?: string
}

export interface BankRule {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  name: string
  priority: number
  status: BankRuleStatus
  match: BankRuleMatchCondition
  action: BankRuleAction
  schemaVersion: 1
  version: number
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  /** Hard gates */
  autoPosted: false
  externalPaymentInitiated: false
  sarsSubmissionInitiated: false
}

export interface BankRuleSuggestion {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  bankAccountId: string
  bankTransactionId: string
  ruleId: string
  ruleName: string
  status: BankRuleSuggestionStatus
  confidence: number
  reason: string
  action: BankRuleAction
  createdBy: string
  createdAt: string
  resolvedAt?: string
  resolvedBy?: string
  resolutionNote?: string
  schemaVersion: 1
  version: number
  /** Never true — apply is human-gated and never posts journals/payments. */
  autoPosted: false
  externalPaymentInitiated: false
  sarsSubmissionInitiated: false
}

export type BankRulesFinanceAction =
  | 'bank_rule.configure'
  | 'bank_rule.read'
  | 'bank_rule.evaluate'
  | 'bank_rule.suggestion.accept'
  | 'bank_rule.suggestion.dismiss'
