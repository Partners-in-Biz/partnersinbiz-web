import { FieldValue } from 'firebase-admin/firestore'
import type * as FirebaseFirestore from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import { filterProjectsForMemberScope } from '@/lib/projects/collaboration'
import { isCompanyLinkedAccount, PERSONAL_SCOPE } from '@/lib/social/account-scope'

export const PORTAL_DASHBOARD_SUMMARY_COLLECTION = 'org_portal_summaries'

const SUMMARY_MAX_AGE_MS = 15 * 60 * 1000
const TREND_BUCKETS = 7
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const RECENT_PROJECT_LIMIT = 6
const TODAY_POST_LIMIT = 12

type SummarySource = 'materialized' | 'live_missing' | 'live_stale'

type PortalProjectRow = {
  id: string
  name: string
  status: string
  description?: string
  createdAt?: unknown
  updatedAt?: unknown
}

type PortalScheduledPostRow = {
  id: string
  status?: string
  platform?: string
  platforms?: string[]
  content?: unknown
  scheduledAt?: unknown
  scheduledFor?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

export type PortalDashboardSocialSummary = {
  total: number
  byStatus: {
    draft: number
    pending_approval: number
    approved: number
    scheduled: number
    published: number
    failed: number
    cancelled: number
  }
  byPlatform: Record<string, number>
  approvalRate: number
  last30Days: number
  last30DaysSeries: { label: string; value: number }[]
}

export type PortalDashboardSummary = {
  orgId: string
  source: SummarySource
  generatedAtIso: string
  stale?: boolean
  counts: {
    contacts: number
    projects: number
    activeProjects: number
    posts: number
    publishedPosts: number
    pendingApprovalPosts: number
    activeCampaigns: number
    captureSources: number
    socialAccounts: number
  }
  projects: {
    total: number
    active: number
    recent: PortalProjectRow[]
  }
  social: PortalDashboardSocialSummary
  scheduledPosts: PortalScheduledPostRow[]
  campaigns: {
    active: number
  }
  crm: {
    contacts: number
  }
  onboarding: {
    social: boolean
    domain: boolean
    contact: boolean
    analytics: boolean
    post: boolean
  }
}

type PortalSummaryIncrementInput = {
  orgId: string
  increments?: Record<string, number>
  extra?: Record<string, unknown>
  staleReason?: string
}

function emptyLast30DaysSeries() {
  return Array.from({ length: TREND_BUCKETS }, (_, i) => ({
    label: `W${i + 1}`,
    value: 0,
  }))
}

function timestampMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    const timestamp = value as {
      toDate?: () => Date
      toMillis?: () => number
      seconds?: number
      _seconds?: number
    }
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
    if (typeof timestamp.toDate === 'function') return timestamp.toDate().getTime()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

function toDate(value: unknown): Date | null {
  const millis = timestampMillis(value)
  return millis > 0 ? new Date(millis) : null
}

function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function isOpenProject(project: Record<string, unknown>): boolean {
  if (project.deleted === true || project.archived === true) return false
  const status = textValue(project.status).toLowerCase()
  return !['completed', 'archived', 'cancelled'].includes(status)
}

function isActiveProject(project: Record<string, unknown>): boolean {
  const status = textValue(project.status).toLowerCase()
  return ['active', 'in_progress', 'development', 'review', 'live', 'maintenance'].includes(status)
}

function projectRow(id: string, data: Record<string, unknown>): PortalProjectRow {
  return {
    id,
    name: textValue(data.name, 'Untitled project'),
    status: textValue(data.status, 'discovery'),
    ...(textValue(data.description) ? { description: textValue(data.description) } : {}),
    ...(data.createdAt !== undefined ? { createdAt: data.createdAt } : {}),
    ...(data.updatedAt !== undefined ? { updatedAt: data.updatedAt } : {}),
  }
}

function trendBucketIndex(date: Date, now = Date.now()): number {
  const ageMs = now - date.getTime()
  if (ageMs < 0 || ageMs > THIRTY_DAYS_MS) return -1

  const bucketSize = THIRTY_DAYS_MS / TREND_BUCKETS
  const bucketFromNewest = Math.min(TREND_BUCKETS - 1, Math.floor(ageMs / bucketSize))
  return TREND_BUCKETS - 1 - bucketFromNewest
}

function trendDateForPost(post: Record<string, unknown>): Date | null {
  const status = textValue(post.status, 'draft')
  if (status === 'published' || status === 'partially_published') {
    return toDate(post.publishedAt) ?? toDate(post.scheduledAt) ?? toDate(post.scheduledFor) ?? toDate(post.updatedAt) ?? toDate(post.createdAt)
  }
  if (status === 'scheduled' || status === 'publishing') {
    return toDate(post.scheduledAt) ?? toDate(post.scheduledFor) ?? toDate(post.updatedAt) ?? toDate(post.createdAt)
  }
  return null
}

function scheduledDateForPost(post: Record<string, unknown>): Date | null {
  return toDate(post.scheduledFor) ?? toDate(post.scheduledAt)
}

function buildSocialSummary(posts: Array<Record<string, unknown>>): PortalDashboardSocialSummary {
  const stats: PortalDashboardSocialSummary = {
    total: posts.length,
    byStatus: {
      draft: 0,
      pending_approval: 0,
      approved: 0,
      scheduled: 0,
      published: 0,
      failed: 0,
      cancelled: 0,
    },
    byPlatform: {},
    approvalRate: 0,
    last30Days: 0,
    last30DaysSeries: emptyLast30DaysSeries(),
  }

  const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS)

  for (const post of posts) {
    const status = textValue(post.status, 'draft') as keyof PortalDashboardSocialSummary['byStatus']
    if (status in stats.byStatus) stats.byStatus[status] += 1

    const platforms = Array.isArray(post.platforms)
      ? post.platforms
      : post.platform
        ? [post.platform]
        : []
    for (const platform of platforms) {
      if (typeof platform !== 'string' || !platform.trim()) continue
      const key = platform.trim()
      stats.byPlatform[key] = (stats.byPlatform[key] ?? 0) + 1
    }

    const trendDate = trendDateForPost(post)
    if (trendDate && trendDate > thirtyDaysAgo) {
      const bucket = trendBucketIndex(trendDate)
      if (bucket >= 0) {
        stats.last30Days += 1
        stats.last30DaysSeries[bucket].value += 1
      }
    }
  }

  const approved = stats.byStatus.approved
  const rejected = stats.byStatus.draft
  const totalReviewable = approved + rejected
  stats.approvalRate = totalReviewable > 0 ? Math.round((approved / totalReviewable) * 100) : 0

  return stats
}

function scheduledPostRow(id: string, data: Record<string, unknown>): PortalScheduledPostRow {
  const platforms = Array.isArray(data.platforms)
    ? data.platforms.filter((platform): platform is string => typeof platform === 'string')
    : undefined
  return {
    id,
    ...(textValue(data.status) ? { status: textValue(data.status) } : {}),
    ...(textValue(data.platform) ? { platform: textValue(data.platform) } : {}),
    ...(platforms && platforms.length > 0 ? { platforms } : {}),
    ...(data.content !== undefined ? { content: data.content } : {}),
    ...(data.scheduledAt !== undefined ? { scheduledAt: data.scheduledAt } : {}),
    ...(data.scheduledFor !== undefined ? { scheduledFor: data.scheduledFor } : {}),
    ...(data.createdAt !== undefined ? { createdAt: data.createdAt } : {}),
    ...(data.updatedAt !== undefined ? { updatedAt: data.updatedAt } : {}),
  }
}

function mapDocs(snapshot: FirebaseFirestore.QuerySnapshot): Array<{ id: string; data: Record<string, unknown> }> {
  return snapshot.docs.map((doc) => ({ id: doc.id, data: (doc.data() ?? {}) as Record<string, unknown> }))
}

function isFreshMaterializedSummary(data: Record<string, unknown>): boolean {
  if (data.stale === true) return false
  const generatedMs = timestampMillis(data.generatedAt) || timestampMillis(data.generatedAtIso)
  return generatedMs > 0 && Date.now() - generatedMs <= SUMMARY_MAX_AGE_MS
}

function withSummaryDefaults(
  orgId: string,
  data: Record<string, unknown>,
  source: SummarySource,
): PortalDashboardSummary {
  const counts = (data.counts ?? {}) as Partial<PortalDashboardSummary['counts']>
  const projects = (data.projects ?? {}) as Partial<PortalDashboardSummary['projects']>
  const social = (data.social ?? {}) as Partial<PortalDashboardSocialSummary>
  const socialByStatus = (social.byStatus ?? {}) as Partial<PortalDashboardSocialSummary['byStatus']>
  const onboarding = (data.onboarding ?? {}) as Partial<PortalDashboardSummary['onboarding']>
  const campaigns = (data.campaigns ?? {}) as Partial<PortalDashboardSummary['campaigns']>
  const crm = (data.crm ?? {}) as Partial<PortalDashboardSummary['crm']>

  const normalizedSocial: PortalDashboardSocialSummary = {
    total: typeof social.total === 'number' ? social.total : 0,
    byStatus: {
      draft: socialByStatus.draft ?? 0,
      pending_approval: socialByStatus.pending_approval ?? 0,
      approved: socialByStatus.approved ?? 0,
      scheduled: socialByStatus.scheduled ?? 0,
      published: socialByStatus.published ?? 0,
      failed: socialByStatus.failed ?? 0,
      cancelled: socialByStatus.cancelled ?? 0,
    },
    byPlatform: social.byPlatform && typeof social.byPlatform === 'object' ? social.byPlatform : {},
    approvalRate: typeof social.approvalRate === 'number' ? social.approvalRate : 0,
    last30Days: typeof social.last30Days === 'number' ? social.last30Days : 0,
    last30DaysSeries: Array.isArray(social.last30DaysSeries) ? social.last30DaysSeries : emptyLast30DaysSeries(),
  }

  return {
    orgId,
    source,
    generatedAtIso: textValue(data.generatedAtIso, new Date().toISOString()),
    ...(data.stale === true ? { stale: true } : {}),
    counts: {
      contacts: counts.contacts ?? 0,
      projects: counts.projects ?? 0,
      activeProjects: counts.activeProjects ?? 0,
      posts: counts.posts ?? normalizedSocial.total,
      publishedPosts: counts.publishedPosts ?? normalizedSocial.byStatus.published,
      pendingApprovalPosts: counts.pendingApprovalPosts ?? normalizedSocial.byStatus.pending_approval,
      activeCampaigns: counts.activeCampaigns ?? campaigns.active ?? 0,
      captureSources: counts.captureSources ?? 0,
      socialAccounts: counts.socialAccounts ?? 0,
    },
    projects: {
      total: projects.total ?? counts.projects ?? 0,
      active: projects.active ?? counts.activeProjects ?? 0,
      recent: Array.isArray(projects.recent) ? projects.recent : [],
    },
    social: normalizedSocial,
    scheduledPosts: Array.isArray(data.scheduledPosts) ? data.scheduledPosts as PortalScheduledPostRow[] : [],
    campaigns: {
      active: campaigns.active ?? counts.activeCampaigns ?? 0,
    },
    crm: {
      contacts: crm.contacts ?? counts.contacts ?? 0,
    },
    onboarding: {
      social: onboarding.social === true,
      domain: onboarding.domain === true,
      contact: onboarding.contact === true,
      analytics: onboarding.analytics === true,
      post: onboarding.post === true,
    },
  }
}

async function loadProjectSummary(
  orgId: string,
  user?: ApiUser,
): Promise<PortalDashboardSummary['projects']> {
  const [receivedSnap, targetSnap, clientSnap, legacySnap] = await Promise.all([
    adminDb.collection('projects').where('recipientOrgId', '==', orgId).get(),
    adminDb.collection('projects').where('targetOrgId', '==', orgId).get(),
    adminDb.collection('projects').where('clientOrgId', '==', orgId).get(),
    adminDb.collection('projects').where('orgId', '==', orgId).get(),
  ])

  const byId = new Map<string, Record<string, unknown> & { id: string }>()
  for (const snap of [receivedSnap, targetSnap, clientSnap, legacySnap]) {
    for (const doc of snap.docs) byId.set(doc.id, { id: doc.id, ...doc.data() })
  }

  const orgVisible = Array.from(byId.values()).filter(isOpenProject)
  const visible = user
    ? await filterProjectsForMemberScope(user, orgVisible)
    : orgVisible
  visible.sort((a, b) => timestampMillis(b.updatedAt) - timestampMillis(a.updatedAt) || timestampMillis(b.createdAt) - timestampMillis(a.createdAt))

  return {
    total: visible.length,
    active: visible.filter(isActiveProject).length,
    recent: visible.slice(0, RECENT_PROJECT_LIMIT).map((project) => projectRow(String(project.id), project)),
  }
}

/**
 * The materialized dashboard summary is organisation-wide. Projects are a
 * record-scoped surface, so the portal must calculate this portion for the
 * authenticated member instead of reusing the shared cached value.
 */
export async function getPortalDashboardProjectSummary(
  orgId: string,
  user: ApiUser,
): Promise<PortalDashboardSummary['projects']> {
  return loadProjectSummary(orgId, user)
}

async function loadDomainDone(orgId: string): Promise<boolean> {
  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return false
  const settings = (orgDoc.data()?.settings ?? {}) as Record<string, unknown>
  const customDomain = (settings.customDomain ?? {}) as Record<string, unknown>
  return customDomain.verified === true
}

async function buildPortalDashboardSummaryLive(orgId: string, source: SummarySource): Promise<PortalDashboardSummary> {
  const [
    contactsSnap,
    campaignsSnap,
    captureSourcesSnap,
    socialPostsSnap,
    socialAccountsSnap,
    projects,
    domainDone,
  ] = await Promise.all([
    adminDb.collection('contacts').where('orgId', '==', orgId).get(),
    adminDb.collection('campaigns').where('orgId', '==', orgId).get(),
    adminDb.collection('capture_sources').where('orgId', '==', orgId).get(),
    adminDb.collection('social_posts').where('orgId', '==', orgId).get(),
    adminDb.collection('social_accounts').where('orgId', '==', orgId).limit(50).get(),
    loadProjectSummary(orgId),
    loadDomainDone(orgId).catch(() => false),
  ])

  const contacts = mapDocs(contactsSnap).filter((doc) => doc.data.deleted !== true)
  const campaigns = mapDocs(campaignsSnap).filter((doc) => (
    doc.data.deleted !== true && doc.data.accountScope !== PERSONAL_SCOPE
  ))
  const captureSources = mapDocs(captureSourcesSnap).filter((doc) => doc.data.deleted !== true)
  const socialPosts = mapDocs(socialPostsSnap).filter((doc) => (
    doc.data.deleted !== true && doc.data.accountScope !== PERSONAL_SCOPE
  ))
  const orgSocialAccounts = mapDocs(socialAccountsSnap).filter((doc) => (
    isCompanyLinkedAccount(doc.data) && doc.data.deleted !== true
  ))
  const activeCampaigns = campaigns.filter((campaign) => textValue(campaign.data.status) === 'active').length
  const activeAccounts = orgSocialAccounts.filter((account) => textValue(account.data.status) === 'active').length
  const social = buildSocialSummary(socialPosts.map((post) => post.data))
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(todayStart)
  todayEnd.setDate(todayEnd.getDate() + 1)
  const scheduledStatuses = new Set(['scheduled', 'approved', 'pending_approval', 'client_review', 'qa_review'])
  const scheduledPosts = socialPosts
    .filter((post) => scheduledStatuses.has(textValue(post.data.status)))
    .filter((post) => {
      const scheduledDate = scheduledDateForPost(post.data)
      return scheduledDate !== null && scheduledDate >= todayStart && scheduledDate < todayEnd
    })
    .sort((a, b) => timestampMillis(a.data.scheduledFor ?? a.data.scheduledAt) - timestampMillis(b.data.scheduledFor ?? b.data.scheduledAt))
    .slice(0, TODAY_POST_LIMIT)
    .map((post) => scheduledPostRow(post.id, post.data))

  return {
    orgId,
    source,
    generatedAtIso: new Date().toISOString(),
    counts: {
      contacts: contacts.length,
      projects: projects.total,
      activeProjects: projects.active,
      posts: social.total,
      publishedPosts: social.byStatus.published,
      pendingApprovalPosts: social.byStatus.pending_approval,
      activeCampaigns,
      captureSources: captureSources.length,
      socialAccounts: activeAccounts,
    },
    projects,
    social,
    scheduledPosts,
    campaigns: {
      active: activeCampaigns,
    },
    crm: {
      contacts: contacts.length,
    },
    onboarding: {
      social: activeAccounts > 0,
      domain: domainDone,
      contact: contacts.length > 0,
      analytics: false,
      post: social.byStatus.published > 0,
    },
  }
}

function persistableSummary(summary: PortalDashboardSummary): Record<string, unknown> {
  const { source: _source, ...data } = summary
  return {
    ...data,
    stale: false,
    staleReason: null,
    generatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
}

export async function getPortalDashboardSummary(orgId: string): Promise<PortalDashboardSummary> {
  const ref = adminDb.collection(PORTAL_DASHBOARD_SUMMARY_COLLECTION).doc(orgId)
  const snap = await ref.get()
  if (snap.exists) {
    const data = (snap.data() ?? {}) as Record<string, unknown>
    if (isFreshMaterializedSummary(data)) {
      return withSummaryDefaults(orgId, data, 'materialized')
    }
  }

  const source: SummarySource = snap.exists ? 'live_stale' : 'live_missing'
  const summary = await buildPortalDashboardSummaryLive(orgId, source)
  await ref.set(persistableSummary(summary), { merge: true }).catch((err) => {
    console.error('[portal-dashboard-summary-persist-failed]', err)
  })
  return summary
}

export async function getFreshPortalDashboardSummary(orgId: string): Promise<PortalDashboardSummary | null> {
  const snap = await adminDb.collection(PORTAL_DASHBOARD_SUMMARY_COLLECTION).doc(orgId).get()
  if (!snap.exists) return null
  const data = (snap.data() ?? {}) as Record<string, unknown>
  if (!isFreshMaterializedSummary(data)) return null
  return withSummaryDefaults(orgId, data, 'materialized')
}

function assignPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return
  let cursor = target
  while (parts.length > 1) {
    const key = parts.shift()!
    const next = cursor[key]
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cursor[key] = {}
    }
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[parts[0]] = value
}

export async function touchPortalDashboardSummary(input: PortalSummaryIncrementInput): Promise<void> {
  if (!input.orgId) return
  try {
    const patch: Record<string, unknown> = {
      stale: true,
      staleReason: input.staleReason ?? 'write',
      updatedAt: FieldValue.serverTimestamp(),
      ...(input.extra ?? {}),
    }
    for (const [path, incrementBy] of Object.entries(input.increments ?? {})) {
      if (!Number.isFinite(incrementBy) || incrementBy === 0) continue
      const increment = typeof FieldValue.increment === 'function'
        ? FieldValue.increment(incrementBy)
        : incrementBy
      assignPath(patch, path, increment)
    }
    await adminDb
      .collection(PORTAL_DASHBOARD_SUMMARY_COLLECTION)
      .doc(input.orgId)
      .set(patch, { merge: true })
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('[portal-dashboard-summary-touch-failed]', err)
    }
  }
}
