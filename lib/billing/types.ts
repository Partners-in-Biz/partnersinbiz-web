/**
 * Billing control-plane types.
 *
 * EFT-first / PayPal-second. NO Stripe. Subscriptions are platform-managed
 * records billed via the existing invoice system. Coupons are manual discount
 * codes applied to invoices (not Stripe coupons). Payouts to partners are EFT
 * or PayPal transfers tracked here, not Stripe Connect.
 */
import type { Timestamp } from 'firebase-admin/firestore'
import type { BillingInterval } from '@/lib/plans/types'

// --- Subscriptions -------------------------------------------------------

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'paused'
  | 'cancelled'
  | 'suspended'

export interface Subscription {
  id?: string
  orgId: string
  planId: string
  planKey: string
  status: SubscriptionStatus
  interval: BillingInterval
  /** Price snapshot in ZAR at the time of subscription */
  priceZar: number
  /** Applied coupon code, if any */
  couponCode?: string | null
  trialEndsAt?: Timestamp | null
  currentPeriodStart?: Timestamp | null
  currentPeriodEnd?: Timestamp | null
  cancelledAt?: Timestamp | null
  cancellationReason?: string | null
  startedAt?: Timestamp | null
  createdAt?: unknown
  updatedAt?: unknown
}

// --- Coupons -------------------------------------------------------------

export type CouponType = 'percent' | 'fixed'
export type CouponDuration = 'once' | 'repeating' | 'forever'

export interface Coupon {
  id?: string
  code: string
  type: CouponType
  /** percent: 0-100, fixed: ZAR amount in Rands */
  value: number
  duration: CouponDuration
  /** For 'repeating' — number of billing periods the discount applies */
  durationMonths?: number | null
  active: boolean
  /** Optional maximum total redemptions */
  maxRedemptions?: number | null
  redemptions: number
  /** Optional expiry date */
  expiresAt?: Timestamp | null
  /** Restrict to specific plan keys; empty = all plans */
  appliesToPlanKeys?: string[]
  notes?: string
  createdBy?: string
  createdAt?: unknown
  updatedAt?: unknown
}

export interface CouponRedemption {
  id?: string
  couponCode: string
  orgId: string
  invoiceId?: string | null
  /** Discount amount applied, in ZAR */
  discountZar: number
  redeemedBy?: string
  createdAt?: unknown
}

// --- Referrals -----------------------------------------------------------

export type ReferralStatus = 'pending' | 'approved' | 'disputed' | 'paid'

export interface Referral {
  id?: string
  /** Org that made the referral */
  referrerOrgId: string
  referrerName?: string
  /** Org that was referred (the new customer) */
  referredOrgId: string
  referredName?: string
  /** Credit amount in ZAR */
  creditZar: number
  status: ReferralStatus
  /** Reason if disputed */
  disputeReason?: string | null
  approvedBy?: string
  approvedAt?: Timestamp | null
  paidAt?: Timestamp | null
  createdAt?: unknown
  updatedAt?: unknown
}

export interface ReferralSettings {
  id?: string
  /** Credit awarded to the referrer per qualified referral, in ZAR */
  referrerCreditZar: number
  /** Credit/discount given to the referred org, in ZAR */
  referredCreditZar: number
  /** Whether new referrals require manual approval */
  requireApproval: boolean
  /** Minimum paid invoices before a referral qualifies */
  minPaidInvoices: number
  active: boolean
  updatedBy?: string
  updatedAt?: unknown
}

// --- Partners (referral / reseller programme) ----------------------------

export type PartnerApplicationStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'suspended'

export interface PartnerApplication {
  id?: string
  companyName: string
  contactName: string
  email: string
  phone?: string
  website?: string
  /** Free-text pitch / audience description */
  pitch?: string
  /** Expected monthly referral volume */
  expectedVolume?: string
  status: PartnerApplicationStatus
  /** Commission rate as a percent, set on approval */
  commissionPercent?: number
  /** Payout method chosen for this partner */
  payoutMethod?: 'eft' | 'paypal'
  payoutDetails?: PayoutDetails | null
  reviewedBy?: string
  reviewedAt?: Timestamp | null
  rejectionReason?: string | null
  /** Linked org id once the partner is also a platform customer */
  orgId?: string | null
  /** Aggregate stats (denormalised, updated on referral approval) */
  referralsCount?: number
  totalCommissionZar?: number
  createdAt?: unknown
  updatedAt?: unknown
}

export interface PayoutDetails {
  /** EFT */
  bankName?: string
  accountHolder?: string
  accountNumber?: string
  branchCode?: string
  /** PayPal */
  paypalEmail?: string
}

export interface PayoutSettings {
  id?: string
  /** Default commission percent applied to new partner approvals */
  defaultCommissionPercent: number
  /** Minimum payout threshold in ZAR before a payout is made */
  minPayoutZar: number
  /** Payout schedule */
  payoutSchedule: 'monthly' | 'quarterly' | 'on_request'
  /** Platform owner's banking details used as the payout source (display only) */
  payoutFromNote?: string
  updatedBy?: string
  updatedAt?: unknown
}

// --- Dunning (EFT reminder sequences — no card retries) ------------------

export interface DunningStage {
  /** Days after due date this stage fires (e.g. 1, 7, 14) */
  daysAfterDue: number
  /** Email subject template (supports {{invoiceNumber}}, {{amount}}, {{orgName}}) */
  subject: string
  /** Email body template */
  body: string
  /** Whether reaching this stage suspends the org's subscription */
  suspend: boolean
}

export interface DunningConfig {
  id?: string
  active: boolean
  stages: DunningStage[]
  updatedBy?: string
  updatedAt?: unknown
}

export interface DunningSequence {
  id?: string
  orgId: string
  invoiceId: string
  invoiceNumber: string
  /** Index of the next stage to run */
  currentStage: number
  /** Completed stage indices with timestamps */
  history: { stage: number; sentAt: Timestamp | unknown }[]
  status: 'active' | 'resolved' | 'suspended'
  resolvedAt?: Timestamp | null
  createdAt?: unknown
  updatedAt?: unknown
}

// --- Churn ---------------------------------------------------------------

export type ChurnReason =
  | 'too_expensive'
  | 'missing_features'
  | 'not_using'
  | 'switched_competitor'
  | 'business_closed'
  | 'other'

export interface ChurnEvent {
  id?: string
  orgId: string
  orgName?: string
  planKey?: string
  /** MRR lost when this org churned, in ZAR */
  mrrLostZar: number
  reason: ChurnReason
  reasonDetail?: string
  /** Whether a win-back attempt has been triggered */
  winBackTriggered?: boolean
  winBackTriggeredAt?: Timestamp | null
  churnedAt?: Timestamp | unknown
  createdAt?: unknown
}

export const CHURN_REASON_LABELS: Record<ChurnReason, string> = {
  too_expensive: 'Too expensive',
  missing_features: 'Missing features',
  not_using: 'Not using it',
  switched_competitor: 'Switched to competitor',
  business_closed: 'Business closed',
  other: 'Other',
}
