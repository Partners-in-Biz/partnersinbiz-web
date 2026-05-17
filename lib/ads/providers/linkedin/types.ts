// lib/ads/providers/linkedin/types.ts
// Provider extension types for LinkedIn Phase 2 — Campaign Group + Campaign + Creative.
// Types declared here extend the canonical providerData slots on AdCampaign/AdSet/Ad.
// Phase 3 types (audiences, saved audiences) are excluded — they ship in Phase 3.

// ─── Campaign Extension (AdCampaign.providerData.linkedin) ────────────────────

/** What we persist on AdCampaign.providerData.linkedin (PiB Campaign = LI Campaign Group) */
export interface LinkedinCampaignExtension {
  /** urn:li:sponsoredCampaignGroup:{id} */
  campaignGroupUrn: string
  /** LinkedIn campaign group status — separate state machine from PiB AdEntityStatus. */
  liStatus?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'PAUSED' | 'PENDING_DELETION' | 'REMOVED' | 'COMPLETED'
  /** Account-level total budget cap if set (decimal-string money object). */
  totalBudget?: { currencyCode: string; amount: string }
}

// ─── AdSet Extension (AdSet.providerData.linkedin) ────────────────────────────

/** What we persist on AdSet.providerData.linkedin (PiB AdSet = LI Campaign) */
export interface LinkedinAdSetExtension {
  /** urn:li:sponsoredCampaign:{id} */
  campaignUrn: string
  /** LinkedIn objective enum — distinct from PiB AdObjective; mapped in mappers.ts. */
  liObjectiveType:
    | 'BRAND_AWARENESS'
    | 'WEBSITE_VISIT'
    | 'ENGAGEMENT'
    | 'VIDEO_VIEW'
    | 'LEAD_GENERATION'
    | 'WEBSITE_CONVERSION'
    | 'JOB_APPLICANT'
    | 'TALENT_LEADS'
  /** Phase 2 ships SPONSORED_UPDATES only. */
  liCampaignType: 'TEXT_AD' | 'SPONSORED_UPDATES' | 'SPONSORED_INMAILS' | 'DYNAMIC'
  /** Bid type. */
  liCostType?: 'CPM' | 'CPC' | 'CPV' | 'CPA'
  /** Raw LinkedIn targeting criteria — populated alongside canonical AdTargeting. */
  liTargetingCriteria?: LinkedinTargetingCriteria
}

// ─── Ad Extension (Ad.providerData.linkedin) ──────────────────────────────────

/** What we persist on Ad.providerData.linkedin (PiB Ad = LI Creative) */
export interface LinkedinAdExtension {
  /** urn:li:sponsoredCreative:{id} */
  creativeUrn: string
  /** Asset URN backing this creative (image/video) — same value persists on platformRefs.linkedin.creativeId */
  contentReferenceUrn?: string
  /** Poster identity — usually the company page URN. Required for SPONSORED_UPDATES creatives. */
  posterUrn?: string
  liStatus?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'PAUSED' | 'PENDING_REVIEW' | 'REJECTED'
}

// ─── Targeting Criteria ───────────────────────────────────────────────────────

/** LinkedIn targeting criteria — superset of canonical AdTargeting */
export interface LinkedinTargetingCriteria {
  include: {
    and: Array<{ or: Record<string, string[]> }>
  }
  exclude?: {
    or: Record<string, string[]>
  }
}

// ─── Money Object ─────────────────────────────────────────────────────────────

/** Money object — LinkedIn uses decimal-string amounts ({ amount: "10.00", currencyCode: "USD" }) */
export interface LinkedinMoneyAmount {
  amount: string    // decimal string, NOT cents
  currencyCode: string  // ISO 4217 (USD, EUR, GBP, etc)
}
