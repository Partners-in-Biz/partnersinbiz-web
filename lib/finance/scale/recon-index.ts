/**
 * Amount-indexed recon matching helpers.
 * Avoids O(unmatched × payments) full scans on large statement imports.
 */

export type PaymentCandidate = {
  id: string
  amountMinor: number
  description?: string
  externalReference?: string
  status: string
}

export type TxnCandidate = {
  id: string
  amountMinor: number
  description: string
  reference?: string
  counterpartyName?: string
}

export type ScoredPaymentMatch = {
  paymentId: string
  score: number
  reason: string
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function absAmountKey(amountMinor: number): number {
  return Math.abs(amountMinor)
}

/** Index verified payments by absolute amount for O(1) candidate lookup. */
export function indexPaymentsByAbsAmount(
  payments: readonly PaymentCandidate[],
): Map<number, PaymentCandidate[]> {
  const map = new Map<number, PaymentCandidate[]>()
  for (const payment of payments) {
    if (payment.status !== 'verified') continue
    const key = absAmountKey(payment.amountMinor)
    const bucket = map.get(key)
    if (bucket) bucket.push(payment)
    else map.set(key, [payment])
  }
  return map
}

export function scorePaymentMatch(
  txn: TxnCandidate,
  payment: PaymentCandidate,
): { score: number; reason: string } | null {
  if (payment.status !== 'verified') return null
  if (Math.abs(txn.amountMinor) !== Math.abs(payment.amountMinor)) return null

  const txnRef = normalize(txn.reference || '')
  const payRef = normalize(payment.externalReference || '')
  const txnDesc = normalize(txn.description || '')
  const payDesc = normalize(payment.description || '')

  if (txnRef && payRef && txnRef === payRef) {
    return { score: 0.95, reason: 'Exact external reference match on equal amount' }
  }
  if (txnDesc && payDesc && (txnDesc.includes(payDesc) || payDesc.includes(txnDesc))) {
    return { score: 0.8, reason: 'Description overlap on equal amount' }
  }
  if (txn.counterpartyName && payDesc && normalize(txn.counterpartyName) === payDesc) {
    return { score: 0.75, reason: 'Counterparty matches payment description on equal amount' }
  }
  return { score: 0.55, reason: 'Equal amount only; human review required' }
}

/**
 * Best unused payment for a txn among same-absolute-amount candidates only.
 * Early-exits on perfect (0.95) score.
 */
export function bestPaymentMatch(
  txn: TxnCandidate,
  byAbsAmount: Map<number, PaymentCandidate[]>,
  usedPaymentIds: Set<string>,
): ScoredPaymentMatch | null {
  const candidates = byAbsAmount.get(absAmountKey(txn.amountMinor))
  if (!candidates || candidates.length === 0) return null

  let best: ScoredPaymentMatch | null = null
  for (const payment of candidates) {
    if (usedPaymentIds.has(payment.id)) continue
    const scored = scorePaymentMatch(txn, payment)
    if (!scored) continue
    if (!best || scored.score > best.score) {
      best = { paymentId: payment.id, score: scored.score, reason: scored.reason }
      if (best.score >= 0.95) return best
    }
  }
  return best
}

/** Pending suggestion de-dupe key for bank-rules evaluate. */
export function pendingRuleSuggestionKey(bankTransactionId: string, ruleId: string): string {
  return `${bankTransactionId}::${ruleId}`
}
