/**
 * Shared admin billing model (EFT / manual — no Stripe).
 *
 * Per-org billing state lives at `organizations.{orgId}.adminBilling`. It is the
 * source of truth for the org's recurring price (MRR), billing cadence, trial,
 * granted free months, pause state, and dev-mode/feature-flag overrides that the
 * admin control plane manages.
 *
 * MRR is derived from this explicit admin-set monthly price (normalised to the
 * org's billing currency), NOT inferred from a plan-name lookup table — so the
 * dashboard never shows hardcoded demo numbers.
 */
import type { Timestamp } from 'firebase-admin/firestore'

export type BillingCadence = 'monthly' | 'quarterly' | 'annual'
export type AdminBillingState =
  | 'trial'
  | 'active'
  | 'past_due'
  | 'paused'
  | 'cancelled'

export interface AdminBillingEvent {
  type: string
  amount?: number
  currency?: string
  note?: string
  actorUid: string
  at: Timestamp | string | null
}

export interface AdminBilling {
  /** Recurring price charged per cadence, in the org currency. */
  recurringAmount?: number
  cadence?: BillingCadence
  currency?: 'USD' | 'EUR' | 'ZAR'
  state?: AdminBillingState
  /** ISO date the trial ends. */
  trialEndsAt?: string | null
  /** Count of free months granted (deducted from billable months). */
  freeMonthsRemaining?: number
  /** ISO date the org became a paying customer (first paid invoice / activation). */
  activatedAt?: string | null
  /** ISO date the org churned/cancelled. */
  cancelledAt?: string | null
  /** Manual payment method label. */
  paymentMethod?: 'eft' | 'manual' | 'paypal' | 'cash' | 'other'
  /** Audit trail of billing events (append-only). */
  events?: AdminBillingEvent[]
  updatedAt?: Timestamp | string | null
}

const CADENCE_MONTHS: Record<BillingCadence, number> = {
  monthly: 1,
  quarterly: 3,
  annual: 12,
}

/**
 * Normalise an org's admin-set recurring price to a monthly figure (MRR
 * contribution) in its own currency. Returns 0 when no price is set, the org is
 * not in a revenue-bearing state, or it is currently within free months / paused.
 */
export function monthlyRecurringForOrg(billing: AdminBilling | undefined | null): number {
  if (!billing) return 0
  const amount = typeof billing.recurringAmount === 'number' && billing.recurringAmount > 0
    ? billing.recurringAmount
    : 0
  if (amount === 0) return 0

  const state = billing.state ?? 'active'
  // Only active / past_due orgs contribute to MRR. Trials, paused and cancelled do not.
  if (state !== 'active' && state !== 'past_due') return 0

  // Orgs sitting on granted free months do not contribute to live MRR.
  if (typeof billing.freeMonthsRemaining === 'number' && billing.freeMonthsRemaining > 0) return 0

  const months = CADENCE_MONTHS[billing.cadence ?? 'monthly'] ?? 1
  return amount / months
}

/** A simple FX table for cross-currency MRR roll-ups (rates relative to ZAR). */
export const FX_TO_ZAR: Record<string, number> = {
  ZAR: 1,
  USD: 18.5,
  EUR: 20,
}

export function toZar(amount: number, currency: string | undefined): number {
  const rate = FX_TO_ZAR[currency ?? 'ZAR'] ?? 1
  return amount * rate
}
