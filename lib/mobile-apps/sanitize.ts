import type { MobileAppInput, MobileAppPlatform, MobileAppRecord, MobileAppStatus } from './types'

const PLATFORMS: MobileAppPlatform[] = ['ios', 'android', 'huawei', 'web', 'other']
const STATUSES: MobileAppStatus[] = ['planned', 'live', 'paused', 'deprecated']

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

function cleanStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const values = value.map((item) => cleanString(item)).filter((item): item is string => Boolean(item))
    return values.length ? values : undefined
  }
  if (typeof value === 'string') {
    const values = value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean)
    return values.length ? values : undefined
  }
  return undefined
}

function cleanObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>
}

export function sanitizeMobileAppInput(input: MobileAppInput): Omit<MobileAppRecord, 'id' | 'createdAt' | 'updatedAt'> {
  const listing = cleanObject(input.listing)
  const assets = cleanObject(input.assets)
  const analytics = cleanObject(input.analyticsSnapshot)
  const release = cleanObject(input.releaseManagement)
  const access = cleanObject(input.access)
  const visibility = cleanObject(input.visibility)

  const platform = PLATFORMS.includes(input.platform as MobileAppPlatform) ? input.platform as MobileAppPlatform : 'other'
  const status = STATUSES.includes(input.status as MobileAppStatus) ? input.status as MobileAppStatus : 'planned'

  return compact({
    orgId: cleanString(input.orgId) ?? '',
    name: cleanString(input.name) ?? 'Untitled app',
    platform,
    status,
    appStoreUrl: cleanString(input.appStoreUrl),
    playStoreUrl: cleanString(input.playStoreUrl),
    packageName: cleanString(input.packageName),
    bundleId: cleanString(input.bundleId),
    developerName: cleanString(input.developerName),
    supportUrl: cleanString(input.supportUrl),
    privacyPolicyUrl: cleanString(input.privacyPolicyUrl),
    termsUrl: cleanString(input.termsUrl),
    websiteUrl: cleanString(input.websiteUrl),
    primaryLanguage: cleanString(input.primaryLanguage),
    regions: cleanStringArray(input.regions),
    listing: compact({
      title: cleanString(listing.title),
      subtitle: cleanString(listing.subtitle),
      shortDescription: cleanString(listing.shortDescription),
      longDescription: cleanString(listing.longDescription),
      keywords: cleanStringArray(listing.keywords),
      category: cleanString(listing.category),
      targetAudience: cleanString(listing.targetAudience),
      asoNotes: cleanString(listing.asoNotes),
      whatsNew: cleanString(listing.whatsNew),
      clientFeedback: cleanString(listing.clientFeedback),
    }),
    assets: compact({
      iconUrl: cleanString(assets.iconUrl),
      screenshotUrls: cleanStringArray(assets.screenshotUrls),
      promoVideoUrl: cleanString(assets.promoVideoUrl),
      featureGraphicUrl: cleanString(assets.featureGraphicUrl),
    }),
    analyticsSnapshot: compact({
      installs: cleanNumber(analytics.installs),
      activeUsers: cleanNumber(analytics.activeUsers),
      averageRating: cleanNumber(analytics.averageRating),
      reviewCount: cleanNumber(analytics.reviewCount),
      lastUpdatedAt: cleanString(analytics.lastUpdatedAt),
    }),
    releaseManagement: compact({
      currentVersion: cleanString(release.currentVersion),
      buildNumber: cleanString(release.buildNumber),
      upcomingVersion: cleanString(release.upcomingVersion),
      releaseNotes: cleanString(release.releaseNotes),
      submissionStatus: cleanString(release.submissionStatus),
      launchDate: cleanString(release.launchDate),
      knownIssues: cleanString(release.knownIssues),
    }),
    access: compact({
      appleDeveloperAccount: cleanString(access.appleDeveloperAccount),
      googlePlayAccount: cleanString(access.googlePlayAccount),
      accessStatus: ['unknown', 'no_access', 'invited', 'active', 'blocked'].includes(access.accessStatus as string)
        ? access.accessStatus as 'unknown' | 'no_access' | 'invited' | 'active' | 'blocked'
        : 'unknown',
      accessNotes: cleanString(access.accessNotes),
    }),
    internalNotes: cleanString(input.internalNotes),
    clientNotes: cleanString(input.clientNotes),
    visibility: {
      showInClientPortal: visibility.showInClientPortal !== false,
      showAnalytics: visibility.showAnalytics !== false,
      showReleaseNotes: visibility.showReleaseNotes !== false,
    },
  }) as Omit<MobileAppRecord, 'id' | 'createdAt' | 'updatedAt'>
}

export function serializeMobileApp(id: string, data: FirebaseFirestore.DocumentData): MobileAppRecord {
  return { id, ...(JSON.parse(JSON.stringify(data)) as Omit<MobileAppRecord, 'id'>) }
}

export function clientSafeMobileApp(app: MobileAppRecord): MobileAppRecord {
  const safe = { ...app }
  delete safe.access
  delete safe.internalNotes
  return safe
}
