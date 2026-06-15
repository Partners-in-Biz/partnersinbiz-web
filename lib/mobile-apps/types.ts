export type MobileAppPlatform = 'ios' | 'android' | 'huawei' | 'web' | 'other'
export type MobileAppStatus = 'planned' | 'live' | 'paused' | 'deprecated'
export type MobileAppAccessStatus = 'unknown' | 'no_access' | 'invited' | 'active' | 'blocked'
export type MobileAppProfileLinkType = 'developer_account' | 'store_account' | 'analytics' | 'support' | 'other'
export type MobileAppProfileLinkStatus = 'linked' | 'pending' | 'needs_review' | 'blocked'

export interface MobileAppProfileLink {
  id?: string
  type: MobileAppProfileLinkType
  label: string
  platform?: MobileAppPlatform
  url?: string
  accountId?: string
  notes?: string
  status: MobileAppProfileLinkStatus
  linkedBy?: string
  linkedByType?: 'user' | 'agent' | 'system'
  linkedAt?: unknown
}

export interface MobileAppListing {
  title?: string
  subtitle?: string
  shortDescription?: string
  longDescription?: string
  keywords?: string[]
  category?: string
  targetAudience?: string
  asoNotes?: string
  whatsNew?: string
  clientFeedback?: string
}

export interface MobileAppAssets {
  iconUrl?: string
  screenshotUrls?: string[]
  promoVideoUrl?: string
  featureGraphicUrl?: string
}

export interface MobileAppAnalyticsSnapshot {
  installs?: number
  activeUsers?: number
  averageRating?: number
  reviewCount?: number
  lastUpdatedAt?: string
}

export interface MobileAppReleaseManagement {
  currentVersion?: string
  buildNumber?: string
  upcomingVersion?: string
  releaseNotes?: string
  submissionStatus?: string
  launchDate?: string
  knownIssues?: string
}

export interface MobileAppAccess {
  appleDeveloperAccount?: string
  googlePlayAccount?: string
  accessStatus?: MobileAppAccessStatus
  accessNotes?: string
}

export interface MobileAppRecord {
  id?: string
  orgId: string
  name: string
  platform: MobileAppPlatform
  status: MobileAppStatus
  appStoreUrl?: string
  playStoreUrl?: string
  packageName?: string
  bundleId?: string
  developerName?: string
  supportUrl?: string
  privacyPolicyUrl?: string
  termsUrl?: string
  websiteUrl?: string
  primaryLanguage?: string
  regions?: string[]
  listing?: MobileAppListing
  assets?: MobileAppAssets
  analyticsSnapshot?: MobileAppAnalyticsSnapshot
  releaseManagement?: MobileAppReleaseManagement
  access?: MobileAppAccess
  profileLinks?: MobileAppProfileLink[]
  internalNotes?: string
  clientNotes?: string
  visibility?: {
    showInClientPortal?: boolean
    showAnalytics?: boolean
    showReleaseNotes?: boolean
  }
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  createdByType?: 'user' | 'agent' | 'system'
  updatedBy?: string
  updatedByType?: 'user' | 'agent' | 'system'
}

export type MobileAppInput = Partial<Omit<MobileAppRecord, 'id' | 'orgId' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByType' | 'updatedBy' | 'updatedByType'>> & {
  orgId?: string
}
