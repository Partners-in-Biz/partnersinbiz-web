import { adminDb } from '@/lib/firebase/admin'
import type { ApiRole } from '@/lib/api/types'
import type { ChatContextAdapter } from '@/lib/chat-context/access'
import { unavailableContextResult } from '@/lib/chat-context/access'
import type { ChatContextReadModel, ContextDisplayState } from '@/lib/chat-context/types'
import { clientSafeMobileApp, serializeMobileApp } from '@/lib/mobile-apps/sanitize'
import type { MobileAppAccessStatus, MobileAppRecord, MobileAppStatus } from '@/lib/mobile-apps/types'
import { isPortalModuleEnabled } from '@/lib/organizations/portal-modules'
import { canAccessModule } from '@/lib/orgMembers/access-policy'
import { assertUserCanPerformOrganizationModuleAction } from '@/lib/organizations/module-policy-access'
import { parseStudioArtifactContextId, studioArtifactContextId } from '@/lib/chat-context/studioArtifactIdentity'
import { safePreviewUrl } from '@/lib/chat-context/safeUrl'

const MAX_ASSETS = 12
const MAX_LINKS = 10
const MAX_URL_LENGTH = 2_048

function clean(value: unknown, max = 160): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function dateString(value: unknown): string | undefined {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : undefined
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  if (value && typeof value === 'object') {
    try { return (value as { toDate?: () => Date }).toDate?.().toISOString() } catch { return undefined }
  }
  return undefined
}

function label(value: string): string {
  return clean(value, 120).replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function platformLabel(value: MobileAppRecord['platform']): string {
  if (value === 'ios') return 'iOS'
  if (value === 'web') return 'Web'
  return label(value)
}

function appState(status: MobileAppStatus): ContextDisplayState {
  if (status === 'live') return 'published'
  if (status === 'paused') return 'blocked'
  if (status === 'deprecated') return 'archived'
  return 'ready'
}

function accessState(status?: MobileAppAccessStatus): ContextDisplayState {
  if (status === 'active') return 'complete'
  if (status === 'invited') return 'needs_input'
  if (status === 'blocked') return 'blocked'
  return 'needs_input'
}

function analyticsAge(lastUpdatedAt: string | undefined, now: Date): string {
  if (!lastUpdatedAt || !Number.isFinite(Date.parse(lastUpdatedAt))) return 'Not connected'
  const days = Math.max(0, Math.floor((now.getTime() - Date.parse(lastUpdatedAt)) / 86_400_000))
  return `${days}d`
}

function safeExternalUrl(value?: string): string | undefined {
  if (typeof value !== 'string' || value.trim().length > MAX_URL_LENGTH) return undefined
  const candidate = clean(value, MAX_URL_LENGTH)
  if (!candidate) return undefined
  return safePreviewUrl(candidate)
}

function workspaceHref(appId: string, orgSlug: string | undefined, role: ApiRole): string {
  const base = role === 'client' ? '/portal/mobile-apps' : `/admin/org/${encodeURIComponent(clean(orgSlug, 160))}/mobile-apps`
  return `${base}?${new URLSearchParams({ appId }).toString()}`
}

export function mobileAppContextId(orgId: string, appId: string): string {
  return studioArtifactContextId({ studioKind: 'mobile_apps', orgId, resourceType: 'app', resourceId: appId })
}

function parseIdentity(id: string): { orgId: string; appId: string } | null {
  const identity = parseStudioArtifactContextId(id)
  return identity?.studioKind === 'mobile_apps' && identity.resourceType === 'app'
    ? { orgId: identity.orgId, appId: identity.resourceId }
    : null
}

export function buildMobileAppWorkspaceModel(input: {
  app: MobileAppRecord & { id: string }
  role: ApiRole
  orgSlug?: string
  now?: Date
}): ChatContextReadModel {
  const { app, role } = input
  const now = input.now ?? new Date()
  const href = workspaceHref(clean(app.id, 160), input.orgSlug, role)
  const showAnalytics = role !== 'client' || app.visibility?.showAnalytics !== false
  const showRelease = role !== 'client' || app.visibility?.showReleaseNotes !== false
  const iconUrl = safeExternalUrl(app.assets?.iconUrl)
  const screenshots = (app.assets?.screenshotUrls ?? []).slice(0, MAX_ASSETS - (iconUrl ? 1 : 0)).flatMap((url) => safeExternalUrl(url) ?? [])
  const assets = [
    ...(iconUrl ? [{ id: 'icon', label: 'App icon', detail: iconUrl }] : []),
    ...screenshots.map((url, index) => ({ id: `screenshot-${index + 1}`, label: `Screenshot ${index + 1}`, detail: url })),
  ]
  const links = [
    ...(safeExternalUrl(app.appStoreUrl) ? [{ id: 'app-store', label: 'App Store', href: safeExternalUrl(app.appStoreUrl)! }] : []),
    ...(safeExternalUrl(app.playStoreUrl) ? [{ id: 'play-store', label: 'Google Play', href: safeExternalUrl(app.playStoreUrl)! }] : []),
    ...(safeExternalUrl(app.supportUrl) ? [{ id: 'support', label: 'Support', href: safeExternalUrl(app.supportUrl)! }] : []),
    ...(safeExternalUrl(app.websiteUrl) ? [{ id: 'website', label: 'Website', href: safeExternalUrl(app.websiteUrl)! }] : []),
    ...(app.profileLinks ?? []).slice(0, MAX_LINKS).flatMap((link, index) => safeExternalUrl(link.url) ? [{ id: clean(link.id, 120) || `profile-${index}`, label: clean(link.label, 160) || 'Profile link', href: safeExternalUrl(link.url)!, detail: label(link.status) }] : []),
  ].slice(0, MAX_LINKS)
  const analytics = app.analyticsSnapshot
  const access = app.access?.accessStatus ?? 'unknown'
  const release = app.releaseManagement
  const attention: ChatContextReadModel['attention'] = []
  if (access !== 'active') attention.push({ id: `access:${app.id}`, label: access === 'invited' ? 'Accept developer account invitation' : 'Developer account access required', state: accessState(access) as 'needs_input' | 'blocked', href })
  if (showRelease && release?.submissionStatus && release.submissionStatus !== 'submitted' && release.submissionStatus !== 'released') attention.push({ id: `release:${app.id}`, label: `Store submission: ${label(release.submissionStatus)}`, state: 'needs_approval', detail: 'Submission and external release require explicit approval.', href })
  if (showRelease && release?.knownIssues) attention.push({ id: `issues:${app.id}`, label: 'Release blockers need attention', state: 'blocked', detail: release.knownIssues.slice(0, 240), href })
  if (app.clientNotes) attention.push({ id: `client-input:${app.id}`, label: 'Client input requested', state: 'needs_input', detail: app.clientNotes.slice(0, 240), href })
  const actions = [
    { id: 'open', label: 'Open app workspace', href },
    { id: 'submit', label: 'Review store submission', href, requiresApproval: true },
    { id: 'release', label: 'Review external release', href, requiresApproval: true },
    { id: 'change-access', label: 'Review access changes', href, requiresApproval: true },
    ...(role === 'admin' ? [{ id: 'deprecate', label: 'Review deprecation', href, requiresApproval: true, destructive: true }] : []),
  ]
  return {
    context: { kind: 'studio_artifact', id: mobileAppContextId(app.orgId, app.id), orgId: app.orgId, label: clean(app.name, 160) || 'Mobile app', icon: 'mobile_apps', href },
    pulse: {
      label: label(app.status), headline: showRelease && clean(release?.currentVersion, 80) ? `Current version ${clean(release?.currentVersion, 80)}` : undefined,
      metrics: [
        { id: 'platform', label: 'Platform', value: platformLabel(app.platform) },
        { id: 'listing-assets', label: 'Listing assets', value: assets.length },
        { id: 'access', label: 'Access', value: label(access) },
        ...(showAnalytics ? [{ id: 'analytics-age', label: 'Analytics age', value: analyticsAge(analytics?.lastUpdatedAt, now) }] : []),
      ],
      next: attention[0] ? { id: attention[0].id, label: attention[0].label, state: attention[0].state, detail: attention[0].detail, href, actions: attention[0].actions } : undefined,
    },
    groups: [
      ...(assets.length ? [{ id: 'listing-assets', label: 'Listing assets', items: assets.map((asset) => ({ ...asset, state: 'ready' as const, href })) }] : []),
      ...(links.length ? [{ id: 'links', label: 'Store, developer and profile links', items: links.map((link) => ({ ...link, state: 'ready' as const })) }] : []),
      ...(showRelease ? [{ id: 'release', label: 'Release', items: [
        { id: 'current-version', label: 'Current version', state: (app.status === 'live' ? 'published' : 'ready') as ContextDisplayState, detail: clean(release?.currentVersion, 80) || 'Not released', href },
        ...(clean(release?.upcomingVersion, 80) ? [{ id: 'upcoming-version', label: 'Upcoming version', state: 'review' as const, detail: clean(release?.upcomingVersion, 80), href }] : []),
        ...(release?.submissionStatus ? [{ id: 'submission-status', label: 'Submission status', state: release.submissionStatus === 'released' ? 'published' as const : 'review' as const, detail: label(release.submissionStatus), href }] : []),
      ] }] : []),
      ...(showAnalytics && analytics ? [{ id: 'analytics', label: 'Analytics', items: [
        { id: 'installs', label: 'Installs', state: 'ready' as const, detail: String(analytics.installs ?? 0) },
        { id: 'active-users', label: 'Active users', state: 'ready' as const, detail: String(analytics.activeUsers ?? 0) },
        { id: 'rating', label: 'Rating', state: 'ready' as const, detail: analytics.averageRating === undefined ? 'Not available' : `${analytics.averageRating} (${analytics.reviewCount ?? 0} reviews)` },
      ] }] : []),
    ],
    artifacts: [{
      id: mobileAppContextId(app.orgId, app.id), studioKind: 'mobile_apps', resourceType: 'app_workspace', resourceId: app.id,
      title: clean(app.name, 160) || 'Mobile app', artifactKind: 'app_asset', state: appState(app.status), statusLabel: label(app.status),
      preview: iconUrl ? { kind: 'image', url: iconUrl } : { kind: 'none' }, updatedAt: dateString(app.updatedAt), href, actions,
    }],
    attention, activity: [], capabilities: role === 'admin' ? ['view', 'review_submission', 'review_release', 'review_access', 'review_deprecation'] : ['view', 'provide_input'], asOf: now.toISOString(),
  }
}

function allowedOrg(user: Parameters<ChatContextAdapter['resolve']>[0]['user'], orgId: string): boolean {
  if (user.role === 'admin' && !user.allowedOrgIds?.length) return true
  return new Set([user.orgId, user.activeOrgId, ...(user.orgIds ?? []), ...(user.allowedOrgIds ?? [])].filter(Boolean)).has(orgId)
}

export const mobileAppsChatContextAdapter: ChatContextAdapter = {
  async resolve({ id, user }) {
    const identity = parseIdentity(id)
    if (!identity || !allowedOrg(user, identity.orgId)) return unavailableContextResult()

    let orgSlug: string | undefined
    if (user.role === 'client') {
      if (!canAccessModule(user.memberAccessPolicy, 'mobileApps')) return unavailableContextResult()
      const org = await adminDb.collection('organizations').doc(identity.orgId).get()
      if (!org.exists || !isPortalModuleEnabled(org.data()?.settings, 'mobileApps')) return unavailableContextResult()
      const visibility = await assertUserCanPerformOrganizationModuleAction(
        user, identity.orgId, 'mobileApps', 'visibility', 'Forbidden', org.data(),
      )
      if (!visibility.ok) return unavailableContextResult()
      orgSlug = clean(org.data()?.slug, 160)
    } else {
      const org = await adminDb.collection('organizations').doc(identity.orgId).get()
      if (!org.exists) return unavailableContextResult()
      orgSlug = clean(org.data()?.slug, 160)
      if (!orgSlug) return unavailableContextResult()
    }

    const doc = await adminDb.collection('mobile_apps').doc(identity.appId).get()
    if (!doc.exists) return unavailableContextResult()
    const raw = serializeMobileApp(doc.id, doc.data()!)
    if (raw.orgId !== identity.orgId || (user.role === 'client' && raw.visibility?.showInClientPortal === false)) return unavailableContextResult()
    const app = user.role === 'client'
      ? { ...clientSafeMobileApp(raw), access: { accessStatus: raw.access?.accessStatus ?? 'unknown' as const } }
      : raw
    return { ok: true, model: buildMobileAppWorkspaceModel({ app: { ...app, id: doc.id }, role: user.role, orgSlug }) }
  },
}
