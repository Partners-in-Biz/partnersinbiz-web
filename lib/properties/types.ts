// lib/properties/types.ts

export type PropertyType = 'web' | 'ios' | 'android' | 'universal'
export type PropertyStatus = 'draft' | 'active' | 'paused' | 'archived'

export const VALID_PROPERTY_TYPES: PropertyType[] = ['web', 'ios', 'android', 'universal']
export const VALID_PROPERTY_STATUSES: PropertyStatus[] = ['draft', 'active', 'paused', 'archived']

/** Per-property identifiers + currency/timezone needed by integration adapters. */
export interface PropertyRevenueConfig {
  /** Native currency for invoiced/IAP/subscription revenue (e.g. 'USD'). */
  currency?: 'ZAR' | 'USD' | 'EUR' | 'GBP' | 'AUD' | 'CAD' | 'NZD' | 'JPY'
  /** IANA timezone — daily-grain metric buckets close on this clock. */
  timezone?: string
  /** AdSense — `ca-pub-XXXXXXXX` */
  adsenseClientId?: string
  /** AdSense ad-client unit (web only) */
  adsenseAdClient?: string
  /** AdMob app id — `ca-app-pub-XXXX~YYYY` */
  admobAppId?: string
  /** RevenueCat project (org-level) and app id (per platform) */
  revenueCatProjectId?: string
  revenueCatAppId?: string
  /** Apple App Store numeric id, e.g. '1234567890' */
  appStoreAppId?: string
  /** Google Play package name, e.g. 'com.partnersinbiz.app' */
  playPackageName?: string
  /** Google Ads customer id 'XXX-XXX-XXXX' (no manager prefix) */
  googleAdsCustomerId?: string
  /** GA4 property id (numeric, no `properties/` prefix) */
  ga4PropertyId?: string
  /**
   * Firebase-linked GA4 property id (numeric, no `properties/` prefix).
   * Firebase Analytics data is served through the same GA4 Data API as
   * `ga4PropertyId` — this field only exists so an app's Firebase-linked
   * GA4 property can differ from a separate web `ga4PropertyId` on the
   * same property. Falls back to `ga4PropertyId` when unset.
   */
  firebaseAnalyticsPropertyId?: string
}

export interface PropertyConfig {
  appStoreUrl?: string
  playStoreUrl?: string
  primaryCtaUrl?: string
  siteUrl?: string
  killSwitch?: boolean
  featureFlags?: Record<string, boolean | string>
  customConfig?: Record<string, unknown>
  /** Integration / monetisation identifiers and currency/timezone settings. */
  revenue?: PropertyRevenueConfig
}

export interface Property {
  id: string
  orgId: string
  name: string
  domain: string
  type: PropertyType
  status: PropertyStatus
  config: PropertyConfig
  conversionSequenceId?: string
  emailSenderDomain?: string
  creatorLinkPrefix?: string
  ingestKey: string
  ingestKeyRotatedAt: unknown // Firestore Timestamp — serialised as { _seconds, _nanoseconds }
  /** Company work scope: the CRM company this property belongs to. */
  companyId?: string
  workOwner?: 'org' | 'company' | 'personal'
  marketingOwner?: 'org' | 'company' | 'personal'
  clientVisibility?: 'shared' | 'private'
  createdAt: unknown
  createdBy: string
  createdByType: 'user' | 'agent' | 'system'
  updatedAt: unknown
  updatedBy?: string
  updatedByType?: 'user' | 'agent' | 'system'
  deleted?: boolean
}

export interface CreatePropertyInput {
  orgId: string
  name: string
  domain: string
  type: PropertyType
  status?: PropertyStatus
  config?: PropertyConfig
  conversionSequenceId?: string
  emailSenderDomain?: string
  creatorLinkPrefix?: string
  companyId?: string
  sourceCompanyId?: string
  clientVisibility?: 'shared' | 'private'
}

export interface UpdatePropertyInput {
  name?: string
  domain?: string
  type?: PropertyType
  status?: PropertyStatus
  config?: PropertyConfig
  conversionSequenceId?: string
  emailSenderDomain?: string
  creatorLinkPrefix?: string
  clientVisibility?: 'shared' | 'private'
}
