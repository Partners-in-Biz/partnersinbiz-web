/**
 * Plan types — platform-managed subscription plans.
 *
 * Partners in Biz is EFT-first / PayPal-second (South Africa). There is NO
 * Stripe. A "plan" is a platform-managed record that drives FeatureGate and
 * per-org limits; billing is realised through the existing EFT/PayPal invoice
 * system, not a card-on-file subscription processor.
 */
import type { Timestamp } from 'firebase-admin/firestore'

export type BillingInterval = 'monthly' | 'quarterly' | 'annual' | 'once_off'

/**
 * A numeric limit. `-1` means unlimited. `0` means the feature is unavailable
 * on this plan (use feature flags for boolean capabilities).
 */
export type PlanLimit = number

export interface PlanLimits {
  /** Max team members / seats */
  seats: PlanLimit
  /** Max client organisations the account can manage */
  organizations: PlanLimit
  /** Max scheduled social posts per month */
  socialPostsPerMonth: PlanLimit
  /** Max AI content generations per month */
  aiGenerationsPerMonth: PlanLimit
  /** Max emails sent per month */
  emailsPerMonth: PlanLimit
  /** Max storage in megabytes */
  storageMb: PlanLimit
  /** Max active SEO sprints */
  seoSprints: PlanLimit
  /** Arbitrary extra limits keyed by string */
  [key: string]: PlanLimit
}

export interface Plan {
  id?: string
  /** Stable machine key, e.g. "starter", "growth", "scale" */
  key: string
  name: string
  description: string
  /** Price in major ZAR units (Rands). e.g. 1499 = R1,499.00 */
  priceZar: number
  interval: BillingInterval
  /** Display sort order, ascending */
  sortOrder: number
  /** Whether the plan is publicly offered (drives pricing page) */
  active: boolean
  /** Archived plans are retained for historical subscriptions but not offered */
  archived: boolean
  /** Boolean capability flags consumed by FeatureGate, keyed by flag name */
  featureFlags: Record<string, boolean>
  /** Numeric usage limits consumed by the limit enforcement layer */
  limits: PlanLimits
  /** Optional marketing bullet points */
  highlights?: string[]
  /** Optional trial length in days offered on signup to this plan */
  trialDays?: number
  createdBy?: string
  createdAt?: Timestamp | unknown
  updatedAt?: Timestamp | unknown
}

export type PlanInput = Omit<Plan, 'id' | 'createdAt' | 'updatedAt'>

export const PLAN_INTERVALS: BillingInterval[] = [
  'monthly',
  'quarterly',
  'annual',
  'once_off',
]

/** Default empty limits so the editor always has a complete shape. */
export const DEFAULT_PLAN_LIMITS: PlanLimits = {
  seats: 1,
  organizations: 1,
  socialPostsPerMonth: 30,
  aiGenerationsPerMonth: 50,
  emailsPerMonth: 1000,
  storageMb: 1024,
  seoSprints: 1,
}

/** Known feature-flag keys surfaced in the plan editor UI. */
export const KNOWN_FEATURE_FLAGS: { key: string; label: string }[] = [
  { key: 'social_scheduling', label: 'Social scheduling' },
  { key: 'ai_content', label: 'AI content engine' },
  { key: 'seo_sprints', label: 'SEO sprints' },
  { key: 'email_marketing', label: 'Email marketing' },
  { key: 'crm', label: 'CRM' },
  { key: 'ads_manager', label: 'Ads manager' },
  { key: 'white_label', label: 'White label' },
  { key: 'priority_support', label: 'Priority support' },
  { key: 'api_access', label: 'API access' },
]

export function isUnlimited(limit: PlanLimit): boolean {
  return limit === -1
}
