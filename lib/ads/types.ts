// lib/ads/types.ts
import type { Timestamp } from 'firebase-admin/firestore'
import type { EncryptedData } from '@/lib/social/encryption'

export type AdPlatform = 'meta' | 'google' | 'linkedin' | 'tiktok'

export const AD_PLATFORMS: readonly AdPlatform[] = ['meta', 'google', 'linkedin', 'tiktok'] as const

export function isAdPlatform(v: unknown): v is AdPlatform {
  return typeof v === 'string' && (AD_PLATFORMS as readonly string[]).includes(v)
}

/** A platform-side ad account (Meta act_xxx, Google customer, LinkedIn account, TikTok advertiser). */
export interface AdAccount {
  /** Platform-native ID. For Meta this is the `act_XXXXXXXXX` string. */
  id: string
  name: string
  currency: string // ISO 4217
  timezone: string // IANA tz string
  businessId?: string // Meta Business Manager ID when applicable
  status?: 'ACTIVE' | 'DISABLED' | 'UNSETTLED' | 'PENDING_RISK_REVIEW' | 'IN_GRACE_PERIOD' | 'UNKNOWN'
}

export type AdConnectionStatus = 'active' | 'expired' | 'revoked' | 'error'

export interface AdConnection {
  id: string
  orgId: string
  platform: AdPlatform
  status: AdConnectionStatus
  /** Platform-side user ID who granted access. For Meta this is the FB user ID. */
  userId: string
  scopes: string[]
  /** Cached discovery — refreshed on demand. */
  adAccounts: AdAccount[]
  defaultAdAccountId?: string
  /** 'user' = per-user OAuth token; 'system' = long-lived agency / system user token. */
  tokenType: 'user' | 'system'
  accessTokenEnc: EncryptedData
  refreshTokenEnc?: EncryptedData
  /** Long-lived Meta tokens last ~60 days. Stored as Firestore Timestamp. */
  expiresAt: Timestamp
  lastError?: string
  meta?: Record<string, unknown>
  createdAt: Timestamp
  updatedAt: Timestamp
}

/** Canonical campaign objectives. UI ships 3 in Phase 2; the rest are forward-compatible. */
export type AdObjective = 'TRAFFIC' | 'LEADS' | 'SALES' | 'AWARENESS' | 'ENGAGEMENT'

export const AD_OBJECTIVES_MVP: readonly AdObjective[] = ['TRAFFIC', 'LEADS', 'SALES'] as const

export type AdEntityStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'PAUSED'
  | 'ARCHIVED'
  | 'PENDING_REVIEW'

/** Canonical AdTargeting — Phase 2+ populates this; declared here for forward use. */
export interface AdTargeting {
  geo: {
    countries?: string[]
    regions?: Array<{ country: string; key: string; name: string }>
    cities?: Array<{
      country: string
      key: string
      name: string
      radius?: number
      distanceUnit?: 'mile' | 'kilometer'
    }>
    zips?: Array<{ country: string; key: string }>
    locationTypes?: Array<'home' | 'recent' | 'travel_in' | 'recently_in'>
  }
  demographics: {
    ageMin: number
    ageMax: number
    genders?: Array<'male' | 'female'>
    languages?: number[]
  }
  interests?: Array<{ id: string; name: string }>
  behaviors?: Array<{ id: string; name: string }>
  customAudiences?: { include: string[]; exclude: string[] }
  savedAudienceId?: string
  advantage?: {
    detailedTargetingExpansion?: boolean
    lookalikeExpansion?: boolean
  }
}

// ─── Campaign ────────────────────────────────────────────────────────────────

export type AdBidStrategy =
  | 'LOWEST_COST'
  | 'COST_CAP'
  | 'BID_CAP'
  | 'TARGET_COST'
  | 'ROAS_GOAL'

export interface AdCampaign {
  id: string
  orgId: string
  platform: AdPlatform
  adAccountId: string
  name: string
  objective: AdObjective
  status: AdEntityStatus
  dailyBudget?: number // cents in ad account currency
  lifetimeBudget?: number // cents
  cboEnabled: boolean
  bidStrategy?: AdBidStrategy
  startTime?: Timestamp
  endTime?: Timestamp
  specialAdCategories: string[] // [] | ['CREDIT'] | ['EMPLOYMENT'] | ['HOUSING'] | ['SOCIAL_ISSUES']
  providerData: { meta?: Record<string, unknown> }
  lastRefreshedAt?: Timestamp
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
  // ─── Approval workflow (Sub-2) ──
  reviewState?: CampaignReviewState
  submittedForReviewAt?: Timestamp
  submittedForReviewBy?: string  // admin uid
  approvedAt?: Timestamp
  approvedBy?: string  // portal uid
  rejectedAt?: Timestamp
  rejectedBy?: string  // portal uid
  rejectionReason?: string
  approvalHistory?: AdCampaignApprovalEntry[]
}

export type CreateAdCampaignInput = Omit<
  AdCampaign,
  'id' | 'orgId' | 'platform' | 'providerData' | 'createdBy' | 'createdAt' | 'updatedAt' | 'lastRefreshedAt'
>

export type UpdateAdCampaignInput = Partial<
  Omit<AdCampaign, 'id' | 'orgId' | 'platform' | 'adAccountId' | 'createdBy' | 'createdAt'>
>

// ─── AdSet ───────────────────────────────────────────────────────────────────

export type AdSetOptimizationGoal =
  | 'LINK_CLICKS'
  | 'IMPRESSIONS'
  | 'REACH'
  | 'POST_ENGAGEMENT'
  | 'CONVERSIONS'
  | 'LEAD_GENERATION'
  | 'OFFSITE_CONVERSIONS'
  | 'VIDEO_VIEWS'

export type AdSetBillingEvent = 'IMPRESSIONS' | 'LINK_CLICKS' | 'THRUPLAY'

export interface AdSetPlacements {
  feeds: boolean
  stories: boolean
  reels: boolean
  marketplace: boolean
}

export interface AdSet {
  id: string
  orgId: string
  campaignId: string
  platform: AdPlatform
  name: string
  status: AdEntityStatus
  dailyBudget?: number
  lifetimeBudget?: number
  bidAmount?: number // cents
  optimizationGoal: AdSetOptimizationGoal
  billingEvent: AdSetBillingEvent
  targeting: AdTargeting
  placements: AdSetPlacements
  startTime?: Timestamp
  endTime?: Timestamp
  providerData: { meta?: Record<string, unknown> }
  lastRefreshedAt?: Timestamp
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type CreateAdSetInput = Omit<
  AdSet,
  'id' | 'orgId' | 'platform' | 'providerData' | 'createdAt' | 'updatedAt' | 'lastRefreshedAt'
>

export type UpdateAdSetInput = Partial<
  Omit<AdSet, 'id' | 'orgId' | 'platform' | 'campaignId' | 'createdAt'>
>

// ─── Ad ──────────────────────────────────────────────────────────────────────

export type AdFormat = 'SINGLE_IMAGE' | 'SINGLE_VIDEO' | 'CAROUSEL'

export type AdCallToAction =
  | 'SHOP_NOW'
  | 'LEARN_MORE'
  | 'SIGN_UP'
  | 'CONTACT_US'
  | 'GET_OFFER'
  | 'SUBSCRIBE'
  | 'DOWNLOAD'
  | 'BOOK_NOW'
  | 'APPLY_NOW'
  | 'GET_QUOTE'

export interface AdCopy {
  primaryText: string
  headline: string
  description?: string
  callToAction?: AdCallToAction
  destinationUrl?: string
}

export interface Ad {
  id: string
  orgId: string
  adSetId: string
  campaignId: string
  platform: AdPlatform
  name: string
  status: AdEntityStatus
  format: AdFormat
  /** Phase 3+: references ad_creatives. Phase 2: empty array; image lives on inlineImageUrl. */
  creativeIds: string[]
  /**
   * Phase 2 only — DEPRECATED in Phase 3. New ads should use creativeIds[].
   * Kept for backward compat: existing Phase-2 ads continue to launch via this URL
   * through the legacy single-image path in metaProvider.upsertAd.
   */
  inlineImageUrl?: string
  /** For CAROUSEL format in Phase 2: array of inline image URLs (Phase 3 swaps to creative IDs). */
  inlineCarouselUrls?: string[]
  copy: AdCopy
  trackingUrls?: {
    utm_source?: string
    utm_medium?: string
    utm_campaign?: string
    utm_content?: string
    utm_term?: string
  }
  providerData: { meta?: Record<string, unknown> }
  lastRefreshedAt?: Timestamp
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type CreateAdInput = Omit<
  Ad,
  'id' | 'orgId' | 'platform' | 'providerData' | 'createdAt' | 'updatedAt' | 'lastRefreshedAt'
>

export type UpdateAdInput = Partial<
  Omit<Ad, 'id' | 'orgId' | 'platform' | 'adSetId' | 'campaignId' | 'createdAt'>
>

// ─── Creatives (Phase 3) ─────────────────────────────────────────────────────

export type AdCreativeType = 'image' | 'video' | 'carousel_card'

export type AdCreativeStatus =
  | 'UPLOADING'   // signed URL issued, browser hasn't finalized yet
  | 'PROCESSING'  // finalize started — probing + preview gen
  | 'READY'       // metadata complete, ready to use in ads
  | 'FAILED'      // probe/preview failed
  | 'ARCHIVED'    // soft-deleted

export type AdCreativeSourceType =
  | 'direct_upload'
  | 'content_asset'
  | 'content_package'
  | 'social_post'
  | 'campaign_asset'
  | 'client_document'
  | 'research_item'

export type AdCreativeApprovalStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'changes_requested'
  | 'rejected'

export interface AdCreativeUtmDefaults {
  source?: string
  medium?: string
  campaign?: string
  content?: string
  term?: string
}

export interface AdCreativePlacementSuitability {
  platform: AdPlatform
  placement: string
  status: 'suitable' | 'warning' | 'blocked' | 'unknown'
  reason?: string
  checkedAt?: Timestamp
}

export interface AdCreativeSpecValidationCheck {
  key: string
  status: 'pass' | 'warning' | 'fail'
  message?: string
}

export interface AdCreativeSpecValidation {
  status: 'valid' | 'warning' | 'invalid' | 'not_checked'
  checkedAt?: Timestamp
  checks: AdCreativeSpecValidationCheck[]
}

export interface AdCreativeUsageBacklink {
  adId?: string
  adSetId?: string
  campaignId?: string
  platform?: AdPlatform
  attachedAt?: Timestamp
}

export interface PlatformCreativeRef {
  /** Platform-side creative id. For Meta images this is the image_hash. For videos, video_id. */
  creativeId: string
  /** Optional content hash for change detection. */
  hash?: string
  syncedAt: Timestamp
}

export interface AdCreativeImportedSource {
  type: AdCreativeSourceType
  id: string
  collection: string
  assetIndex?: number
  approvedAt?: Timestamp | string | null
  approvedBy?: string | null
  snapshot: {
    copy: string
    landingUrl: string
    utm: Record<string, string>
    asset: {
      type: AdCreativeType
      name: string
      sourceUrl: string
      storagePath: string
      mimeType: string
      fileSize: number
      width?: number
      height?: number
      duration?: number
    }
  }
}

export interface AdCreative {
  id: string
  orgId: string
  type: AdCreativeType
  name: string
  /** Firebase Storage path of the canonical asset (the source file the user uploaded). */
  storagePath: string
  /** Signed public-read URL of the canonical asset (for browser preview). */
  sourceUrl: string
  /** Auto-generated 360p preview URL (for fast UI loads). */
  previewUrl?: string
  width?: number
  height?: number
  /** For videos: duration in seconds. */
  duration?: number
  fileSize: number
  mimeType: string
  status: AdCreativeStatus
  /** Brand copy attached to the creative — optional, can be overridden per-ad. */
  copy?: Partial<AdCopy>
  /** Immutable source lineage and approved content/campaign snapshot for imported assets. */
  source?: AdCreativeImportedSource
  sourceType?: AdCreativeSourceType
  sourceId?: string
  sourceVersionId?: string
  sourceOrgId?: string
  projectId?: string
  /** Paid-media approval state and durable approval references. */
  approvalStatus?: AdCreativeApprovalStatus
  approvalTaskId?: string
  approvalDocumentId?: string
  approvalVersionId?: string
  approvalCommentId?: string
  /** Package-level visual defaults used by pickers and provider adapters. */
  thumbnailUrl?: string
  videoCoverUrl?: string
  /** Default destination and UTM snapshot for ads cloned from this immutable version. */
  landingUrl?: string
  utmDefaults?: AdCreativeUtmDefaults
  /** Provider/placement suitability and spec validation captured for this exact version. */
  placementSuitability?: AdCreativePlacementSuitability[]
  specValidation?: AdCreativeSpecValidation
  /** Immutable creative package version chain. */
  versionGroupId: string
  versionNumber: number
  supersedes?: string
  changeSummary?: string
  isLatest: boolean
  /** Ads/campaigns that consumed this creative version. */
  usageBacklinks?: AdCreativeUsageBacklink[]
  /** Cross-platform sync state. Each provider gets a slot; Meta is the only one populated in Phase 3. */
  platformRefs: {
    meta?: PlatformCreativeRef
    google?: PlatformCreativeRef
    linkedin?: PlatformCreativeRef
    tiktok?: PlatformCreativeRef
  }
  /** For carousel parents (type !== 'carousel_card'), the ordered list of card creative IDs. */
  carouselCardIds?: string[]
  /** Set when archived; ad_creatives table is append-only otherwise. */
  archivedAt?: Timestamp
  /** Error message if status === 'FAILED' (e.g. probe error). */
  lastError?: string
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type CreateAdCreativeInput = Omit<
  AdCreative,
  | 'id'
  | 'orgId'
  | 'platformRefs'
  | 'createdBy'
  | 'createdAt'
  | 'updatedAt'
  | 'archivedAt'
  | 'previewUrl'
  | 'lastError'
  | 'versionGroupId'
  | 'versionNumber'
  | 'isLatest'
>

export type UpdateAdCreativeInput = Partial<
  Pick<AdCreative, 'name' | 'copy' | 'status' | 'previewUrl' | 'width' | 'height' | 'duration' | 'lastError'>
>

// ─── Custom Audiences (Phase 4) ──────────────────────────────────────────────

export type AdCustomAudienceType =
  | 'CUSTOMER_LIST'
  | 'WEBSITE'
  | 'LOOKALIKE'
  | 'APP'
  | 'ENGAGEMENT'

export type AdCustomAudienceStatus =
  | 'BUILDING'       // upload sent to Meta, awaiting match
  | 'READY'          // matched, usable
  | 'EMPTY'          // matched but too few users
  | 'TOO_SMALL'      // Meta minimum (typically 1000) not met
  | 'ARCHIVED'       // archived or deleted at provider
  | 'ERROR'          // Meta rejected the audience

export interface CustomerListSource {
  kind: 'CUSTOMER_LIST'
  /** Firebase Storage path of the original CSV (deleted after 24h). */
  csvStoragePath: string
  /** Count of hashed rows sent to Meta. */
  hashCount: number
  uploadedAt: Timestamp
}

export interface WebsiteCAUrlRule {
  op: 'url_contains' | 'url_equals' | 'url_not_contains'
  value: string
}

export interface WebsiteCASource {
  kind: 'WEBSITE'
  pixelId: string
  retentionDays: number // typically 30, 60, 90, 180
  rules: WebsiteCAUrlRule[]
}

export interface LookalikeSource {
  kind: 'LOOKALIKE'
  /** PiB-side ID of the source AdCustomAudience. */
  sourceAudienceId: string
  /** 1-10. Meta interprets as 1% being the most similar. */
  percent: number
  /** ISO country code (Meta lookalikes are per-country). */
  country: string
}

export interface AppCASource {
  kind: 'APP'
  /** PiB Property ID — see [[properties-module-live]]. */
  propertyId: string
  /** Event name as recorded in PiB analytics, e.g. 'Purchase' or 'CompleteRegistration'. */
  event: string
  retentionDays: number
}

export type EngagementType =
  | 'PAGE'           // engaged with a Facebook Page
  | 'VIDEO'          // watched a Facebook video
  | 'LEAD_FORM'      // opened or submitted a lead form
  | 'EVENT'          // RSVPed to a Facebook event
  | 'INSTAGRAM_ACCOUNT'

export interface EngagementCASource {
  kind: 'ENGAGEMENT'
  engagementType: EngagementType
  /** Page ID / video ID / lead form ID / event ID / IG account ID, depending on engagementType. */
  sourceObjectId: string
  retentionDays: number
}

export type CustomAudienceSource =
  | CustomerListSource
  | WebsiteCASource
  | LookalikeSource
  | AppCASource
  | EngagementCASource

export interface AdCustomAudience {
  id: string
  orgId: string
  platform: AdPlatform
  name: string
  description?: string
  type: AdCustomAudienceType
  status: AdCustomAudienceStatus
  approximateSize?: number
  source: CustomAudienceSource
  providerData: { meta?: { customAudienceId?: string; [key: string]: unknown } }
  lastSyncedAt?: Timestamp
  lastError?: string
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type CreateAdCustomAudienceInput = Omit<
  AdCustomAudience,
  'id' | 'orgId' | 'platform' | 'providerData' | 'createdBy' | 'createdAt' | 'updatedAt' | 'lastSyncedAt' | 'approximateSize' | 'lastError'
>

export type UpdateAdCustomAudienceInput = Partial<
  Pick<AdCustomAudience, 'name' | 'description' | 'status' | 'approximateSize' | 'lastError'>
>

// ─── Saved Audiences (Phase 4) ───────────────────────────────────────────────

export interface AdSavedAudience {
  id: string
  orgId: string
  platform: AdPlatform
  name: string
  description?: string
  targeting: AdTargeting
  providerData: { meta?: { savedAudienceId?: string } }
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type CreateAdSavedAudienceInput = Omit<
  AdSavedAudience,
  'id' | 'orgId' | 'platform' | 'providerData' | 'createdBy' | 'createdAt' | 'updatedAt'
>

export type UpdateAdSavedAudienceInput = Partial<Pick<AdSavedAudience, 'name' | 'description' | 'targeting'>>

// ─── Pixel + CAPI (Phase 6) ──────────────────────────────────────────────────

export interface AdPixelConfigPlatform {
  pixelId: string
  capiTokenEnc?: EncryptedData
  testEventCode?: string
}

export interface AdPixelEventMapping {
  /** PiB analytics event name (e.g. 'purchase'). */
  pibEventName: string
  /** Meta CAPI standard event name (e.g. 'Purchase'). */
  metaEventName: string
  /** Optional field on the event payload to use as the `value` for Meta CAPI. */
  valueField?: string
}

export interface AdPixelConfig {
  id: string
  orgId: string
  /** Optional PiB Property reference (see [[properties-module-live]]); null for org-wide configs. */
  propertyId?: string
  name: string
  meta?: AdPixelConfigPlatform
  google?: AdPixelConfigPlatform
  linkedin?: AdPixelConfigPlatform
  tiktok?: AdPixelConfigPlatform
  eventMappings: AdPixelEventMapping[]
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type CreateAdPixelConfigInput = Omit<
  AdPixelConfig,
  'id' | 'orgId' | 'createdBy' | 'createdAt' | 'updatedAt'
>

export type UpdateAdPixelConfigInput = Partial<
  Pick<AdPixelConfig, 'name' | 'meta' | 'google' | 'linkedin' | 'tiktok' | 'eventMappings'>
>

// ─── CAPI Event Log (Phase 6) ────────────────────────────────────────────────

export type CapiActionSource = 'website' | 'email' | 'phone_call' | 'system_generated' | 'other'

export interface CapiUserHash {
  em?: string       // email SHA-256
  ph?: string       // phone SHA-256
  fn?: string       // first name SHA-256
  ln?: string       // last name SHA-256
  ge?: string       // gender SHA-256
  ct?: string       // city SHA-256
  st?: string       // state SHA-256
  country?: string  // country SHA-256
  zp?: string       // zip SHA-256
  db?: string       // dob SHA-256
  external_id?: string  // SHA-256
  fbp?: string      // raw (already hashed by Meta browser pixel)
  fbc?: string      // raw
}

export interface CapiCustomData {
  value?: number
  currency?: string
  content_ids?: string[]
  content_type?: string
  num_items?: number
}

export interface CapiFanoutResult {
  status: 'sent' | 'failed' | 'skipped'
  metaResponseId?: string  // Meta returns events_received count, not per-event id
  error?: string
  sentAt: Timestamp
}

export interface AdCapiEvent {
  id: string  // = event_id from client (dedupe key; matches browser Pixel eventID)
  orgId: string
  pixelConfigId: string
  propertyId?: string
  eventName: string  // e.g. 'Purchase', 'Lead'
  eventTime: Timestamp
  userHash: CapiUserHash
  customData?: CapiCustomData
  actionSource: CapiActionSource
  eventSourceUrl?: string
  optOut: boolean
  fanout: {
    meta?: CapiFanoutResult
    google?: CapiFanoutResult
    linkedin?: CapiFanoutResult
    tiktok?: CapiFanoutResult
  }
  createdAt: Timestamp
}

// ─── Approval workflow (Sub-2) ───────────────────────────────────────────────

export type CampaignReviewState = 'awaiting' | 'approved' | 'rejected'

export interface AdCampaignApprovalEntry {
  state: 'submitted' | 'approved' | 'rejected'
  actorUid: string
  actorRole: 'admin' | 'member' | 'viewer' | 'owner'
  reason?: string
  at: Timestamp
}

// ─── Canonical Keyword type (Sub-3a Phase 2) — used by Google, future LinkedIn/Bing ─

export type { AdKeywordMatchType } from '@/lib/ads/providers/google/mappers'
import type { AdKeywordMatchType } from '@/lib/ads/providers/google/mappers'

export interface AdKeyword {
  id: string
  orgId: string
  campaignId: string
  adSetId: string  // canonical adSet = Google Ad Group
  text: string
  matchType: AdKeywordMatchType
  status: AdEntityStatus
  negativeKeyword: boolean
  cpcBidMicros?: string  // optional override; falls back to ad-group default
  providerData?: {
    google?: {
      keywordResourceName: string  // 'customers/{cid}/adGroupCriteria/{adGroupId}~{criterionId}'
      cpcBidMicros?: string
    }
  }
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ─── Google Ads provider extensions (Sub-3a) ─────────────────────────────────
// Additive only — `AdPlatform` already includes `'google'`. `AdConnection.meta`
// is loosely typed as `Record<string, unknown>`, so callers can stash
// `GoogleAdsConnectionData` there directly without breaking existing Meta callers.

export interface GoogleAdsConnectionData {
  /**
   * Pointer to encrypted dev token in tokens collection — or env-derived if
   * shared with the analytics adapter.
   */
  developerToken: string
  /** MCC (Manager) customer ID. Required when client has manager hierarchy. */
  loginCustomerId?: string
  refreshTokenExpiresAt?: Timestamp
}

// ─── Merchant Center (Sub-3a Phase 4) ────────────────────────────────────────

export interface AdMerchantCenter {
  id: string
  orgId: string
  merchantId: string  // Google Merchant Center account ID (numeric, but stored as string)
  accessTokenRef: string  // pointer to encrypted access token (e.g. tokens collection doc id)
  refreshTokenRef: string  // pointer to encrypted refresh token
  primaryFeedId?: string  // selected default feed for Shopping campaigns
  feedLabels: string[]  // available country/feed labels populated at connect time
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ─── Google Ads audience extensions (Sub-3a Phase 5) ─────────────────────────

export type GoogleAdsAudienceSubtype =
  | 'CUSTOMER_MATCH'
  | 'REMARKETING'
  | 'CUSTOM_SEGMENT'
  | 'AFFINITY'
  | 'IN_MARKET'
  | 'DETAILED_DEMOGRAPHICS'

export interface GoogleAdsCustomerMatchData {
  subtype: 'CUSTOMER_MATCH'
  userListResourceName: string  // 'customers/{cid}/userLists/{id}'
  uploadKeyType: 'CONTACT_INFO' | 'CRM_ID' | 'MOBILE_ADVERTISING_ID'
  memberCount?: number
}

export interface GoogleAdsRemarketingData {
  subtype: 'REMARKETING'
  userListResourceName: string
  membershipLifeSpanDays: number
  ruleType: 'WEBSITE' | 'APP' | 'COMBINED'
  ruleDescription?: string
}

export interface GoogleAdsCustomSegmentData {
  subtype: 'CUSTOM_SEGMENT'
  customAudienceResourceName: string
  segmentType: 'KEYWORD' | 'URL' | 'APP'
  values: string[]
}

export interface GoogleAdsPredefinedAudienceData {
  subtype: 'AFFINITY' | 'IN_MARKET' | 'DETAILED_DEMOGRAPHICS'
  audienceResourceName: string
  categoryName: string
}

export type GoogleAdsAudienceData =
  | GoogleAdsCustomerMatchData
  | GoogleAdsRemarketingData
  | GoogleAdsCustomSegmentData
  | GoogleAdsPredefinedAudienceData

// ─── LinkedIn Ads provider extensions (Sub-3b) ────────────────────────────────

export interface LinkedinAdConnectionData {
  /** LinkedIn member URN of the OAuth grant owner: 'urn:li:person:{id}' */
  memberUrn?: string
  /** LinkedIn organization URN: 'urn:li:organization:{id}' */
  organizationUrn?: string
  /** Selected ad account URN: 'urn:li:sponsoredAccount:{id}' */
  selectedAdAccountUrn?: string
  /** Refresh token expiration (LinkedIn refresh tokens have a TTL, typically 365 days) */
  refreshTokenExpiresAt?: Timestamp
}

// ─── TikTok Ads provider extensions (Sub-3c) ──────────────────────────────────

export interface TiktokAdConnectionData {
  /** TikTok advertiser ID (numeric string). The currently selected default. */
  selectedAdvertiserId?: string
  /** All advertiser IDs the OAuth grant gave access to (cached at connect time). */
  advertiserIds?: string[]
  /** Granted scopes (numeric codes — 1=ads_read, 4=ads_management, 7=events_api, 8=audiences, 100=reporting) */
  tokenScope?: string[]
  /** Refresh token expiry (TikTok refresh tokens have a TTL, typically 365 days) */
  refreshTokenExpiresAt?: Timestamp
}

// ─── Cross-platform Conversion Actions (Sub-3a Phase 6) ───────────────────────

export type AdConversionCategory =
  | 'PAGE_VIEW' | 'PURCHASE' | 'SIGNUP' | 'LEAD' | 'DOWNLOAD'
  | 'ADD_TO_CART' | 'BEGIN_CHECKOUT' | 'SUBSCRIBE_PAID'
  | 'PHONE_CALL_LEAD' | 'IMPORTED_LEAD' | 'SUBMIT_LEAD_FORM'
  | 'BOOK_APPOINTMENT' | 'REQUEST_QUOTE' | 'GET_DIRECTIONS'
  | 'OUTBOUND_CLICK' | 'CONTACT' | 'ENGAGEMENT'
  | 'STORE_VISIT' | 'STORE_SALE'
  | 'QUALIFIED_LEAD' | 'CONVERTED_LEAD' | 'OTHER'

export type AdConversionPlatform = 'meta' | 'google' | 'linkedin' | 'tiktok'

export type AdConversionCountingType = 'ONE_PER_CLICK' | 'MANY_PER_CLICK'

export type AdConversionAttributionModel =
  | 'LAST_CLICK' | 'GOOGLE_SEARCH_ATTRIBUTION_DATA_DRIVEN' | 'LINEAR'
  | 'TIME_DECAY' | 'POSITION_BASED'

export interface AdConversionActionValueSettings {
  defaultValue?: number
  defaultCurrencyCode?: string
  alwaysUseDefault?: boolean
}

export interface AdConversionAction {
  id: string
  orgId: string
  platform: AdConversionPlatform
  name: string
  category: AdConversionCategory
  valueSettings: AdConversionActionValueSettings
  countingType: AdConversionCountingType
  attributionModel?: AdConversionAttributionModel
  providerData?: {
    google?: { conversionActionResourceName: string }
    meta?: { customEventType?: string; pixelId?: string }
    linkedin?: {
      /** LinkedIn conversion URN: 'urn:lla:llaPartnerConversion:{id}' — preferred. */
      conversionUrn?: string
      /** Bare numeric partner conversion ID — used when URN is not yet composed. */
      partnerConversionId?: string
    }
    tiktok?: {
      /**
       * TikTok standard event name to fire.
       * Examples: 'Purchase' | 'CompletePayment' | 'AddToCart' | 'Subscribe' |
       *           'Lead' | 'CompleteRegistration' | 'ViewContent'
       */
      eventName?: string
    }
  }
  createdAt: Timestamp
  updatedAt: Timestamp
}
