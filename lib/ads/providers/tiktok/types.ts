// lib/ads/providers/tiktok/types.ts
// Provider extension types for TikTok Phase 2 — Campaigns + AdGroups + Ads + Identities.
// Types declared here extend the canonical providerData slots on AdCampaign/AdSet/Ad.
// Phase 3 types (custom audiences, catalog integration) are excluded — they ship in Phase 3.

import type { Timestamp } from 'firebase-admin/firestore'

// ─── Entity Status Enums ──────────────────────────────────────────────────────

/** TikTok status enum used across campaign + adgroup + ad. */
export type TiktokEntityStatus = 'ENABLE' | 'DISABLE' | 'DELETE'

/** TikTok-side delivery status (read-only). */
export type TiktokDeliveryStatus =
  | 'STATUS_NOT_DELIVERY'
  | 'STATUS_DELIVERY_OK'
  | 'STATUS_REVIEW_IN_PROGRESS'
  | 'STATUS_REJECTED'
  | 'STATUS_DELETE'

// ─── Objective + Optimization Enums ──────────────────────────────────────────

/** TikTok objective enum. */
export type TiktokObjective =
  | 'TRAFFIC'
  | 'LEAD_GENERATION'
  | 'CONVERSIONS'
  | 'REACH'
  | 'ENGAGEMENT'
  | 'VIDEO_VIEWS'
  | 'PRODUCT_SALES'
  | 'APP_PROMOTION'
  | 'WEBSITE_CONVERSIONS'
  | 'CATALOG_SALES'

/** TikTok adgroup optimization goal. */
export type TiktokOptimizationGoal =
  | 'CLICK'
  | 'CONVERT'
  | 'REACH'
  | 'IMPRESSION'
  | 'VIDEO_VIEW'
  | 'LEAD_GENERATION'
  | 'INSTALL'

// ─── Campaign Extension (AdCampaign.providerData.tiktok) ──────────────────────

/** What we persist on AdCampaign.providerData.tiktok */
export interface TiktokCampaignExtension {
  /** Numeric TikTok campaign id */
  campaignId: string
  /** TikTok-side enable/disable */
  tkStatus?: TiktokEntityStatus
  /** Delivery status (read-only, populated from /campaign/get/) */
  tkDeliveryStatus?: TiktokDeliveryStatus
  /** TikTok objective enum */
  tkObjective?: TiktokObjective
  /** Total budget cap if set (account currency, numeric major units) */
  budget?: number
  budgetMode?: 'BUDGET_MODE_INFINITE' | 'BUDGET_MODE_DAY' | 'BUDGET_MODE_TOTAL'
}

// ─── AdSet Extension (AdSet.providerData.tiktok) — TikTok AdGroup ─────────────

/** What we persist on AdSet.providerData.tiktok (= TikTok AdGroup) */
export interface TiktokAdSetExtension {
  /** Numeric TikTok adgroup id */
  adgroupId: string
  /** Numeric parent TikTok campaign id (also stored on AdSet.campaignId via canonical foreign key) */
  campaignId: string
  tkStatus?: TiktokEntityStatus
  tkDeliveryStatus?: TiktokDeliveryStatus
  /** TikTok placement type. */
  placement?: ('PLACEMENT_TIKTOK' | 'PLACEMENT_PANGLE' | 'PLACEMENT_TOPBUZZ')[]
  optimizationGoal?: TiktokOptimizationGoal
  /** Numeric daily budget (account currency major units). */
  dailyBudget?: number
  /** Raw TikTok targeting object — populated alongside canonical AdTargeting. */
  tkTargeting?: TiktokTargeting
  /** Numeric bid price */
  bidPrice?: number
  /** Pacing mode */
  pacing?: 'PACING_MODE_SMOOTH' | 'PACING_MODE_FAST'
  /** Schedule type */
  scheduleType?: 'SCHEDULE_FROM_NOW' | 'SCHEDULE_START_END'
  scheduleStartTime?: string  // 'YYYY-MM-DD HH:MM:SS'
  scheduleEndTime?: string
}

// ─── Ad Extension (Ad.providerData.tiktok) ───────────────────────────────────

/** What we persist on Ad.providerData.tiktok */
export interface TiktokAdExtension {
  /** Numeric TikTok ad id */
  adId: string
  /** Numeric parent adgroup id */
  adgroupId: string
  /** Required: identity reference for the poster — see Identity types below. */
  identityId: string
  identityType: 'AUTH_CODE' | 'CUSTOMIZED_USER' | 'TT_USER'
  /** Ad format on TikTok */
  adFormat?: 'SINGLE_IMAGE' | 'SINGLE_VIDEO' | 'CAROUSEL' | 'COLLECTION'
  tkStatus?: TiktokEntityStatus
  tkDeliveryStatus?: TiktokDeliveryStatus
}

// ─── Identity (ad_identities collection — new in Sub-3c Phase 2) ──────────────

/** Identity record persisted under ad_identities collection. */
export interface TiktokIdentity {
  /** PiB-side identity id */
  id: string
  orgId: string
  /** Owning TikTok advertiser */
  advertiserId: string
  /** TikTok-side identity id */
  identityId: string
  identityType: 'AUTH_CODE' | 'CUSTOMIZED_USER' | 'TT_USER'
  /** Display name */
  displayName?: string
  /** Profile image URL if available */
  profileImageUrl?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ─── Targeting ────────────────────────────────────────────────────────────────

/** TikTok targeting object — superset of canonical AdTargeting. */
export interface TiktokTargeting {
  location_ids?: number[]
  gender?: 'GENDER_MALE' | 'GENDER_FEMALE' | 'GENDER_UNLIMITED'
  age_groups?: (
    | 'AGE_13_17'
    | 'AGE_18_24'
    | 'AGE_25_34'
    | 'AGE_35_44'
    | 'AGE_45_54'
    | 'AGE_55_100'
  )[]
  languages?: string[]
  interest_category_ids?: number[]
  behavior_ids?: number[]
  included_audiences?: string[]
  excluded_audiences?: string[]
}
