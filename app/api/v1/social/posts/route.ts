/**
 * GET  /api/v1/social/posts  — list social posts
 * POST /api/v1/social/posts  — create a social post
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { actorFrom } from '@/lib/api/actor'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { SocialPlatform } from '@/lib/social/types'
import type { SocialPlatformType, PostStatus } from '@/lib/social/providers'
import { ACTIVE_PLATFORMS } from '@/lib/social/providers'
import { validatePostContent } from '@/lib/social/validation'
import { logAudit } from '@/lib/social/audit'
import { notifyApprovalNeeded } from '@/lib/notifications/notify'
import { logActivity } from '@/lib/activity/log'
import { emptyApprovalState } from '@/lib/social/approval'
import {
  RESOURCE_RELATIONSHIP_ARRAY_FIELDS,
  RESOURCE_RELATIONSHIP_STRING_FIELDS,
  normalizeResourceRelationshipLinks,
} from '@/lib/client-documents/linkedValidation'
import { touchPortalDashboardSummary } from '@/lib/portal/dashboard-summary'
import {
  filterOwnedRowsForActor,
  memberSeesAllModuleRecords,
} from '@/lib/orgMembers/record-scope'
import {
  accountAllowedForPublish,
  isPersonalCampaignRecord,
  PERSONAL_SCOPE,
  ownerFieldsForWrite,
  recordCompanyId,
  recordVisibleForOwner,
  resolveMarketingOwnerFromSearchParams,
} from '@/lib/social/account-scope'
import { clientVisibilityFieldsForWrite } from '@/lib/work-scope'

export const dynamic = 'force-dynamic'

const VALID_LEGACY_PLATFORMS: SocialPlatform[] = ['x', 'linkedin']
// Use the canonical PostStatus type — includes pending_approval, approved, publishing, partially_published
const VALID_STATUSES: PostStatus[] = [
  'draft', 'qa_review', 'regenerating', 'client_review', 'pending_approval',
  'approved', 'vaulted', 'scheduled', 'publishing', 'published',
  'partially_published', 'failed', 'cancelled',
]

function wantsPersonalScope(req: Request): boolean {
  return new URL(req.url).searchParams.get('scope') === PERSONAL_SCOPE
}

function toLegacyPlatform(platform: string): SocialPlatform | null {
  if (platform === 'x' || platform === 'twitter') return 'x'
  if (platform === 'linkedin') return 'linkedin'
  return null
}

function toProviderPlatform(platform: string): SocialPlatformType | null {
  if (platform === 'x' || platform === 'twitter') return 'twitter'
  const p = platform.toLowerCase() as SocialPlatformType
  return ACTIVE_PLATFORMS.includes(p) ? p : null
}

function relationshipInputFrom(body: Record<string, unknown>) {
  const value: Record<string, unknown> = {}
  for (const key of RESOURCE_RELATIONSHIP_STRING_FIELDS) {
    if (key in body) value[key] = body[key]
  }
  for (const key of RESOURCE_RELATIONSHIP_ARRAY_FIELDS) {
    if (key in body) value[key] = body[key]
  }
  if ('contextRefs' in body) value.contextRefs = body.contextRefs
  return Object.keys(value).length > 0 ? value : undefined
}

export const GET = withAuth('client', withTenant(async (req, user, orgId) => {
  const { searchParams } = new URL(req.url)
  const platform = searchParams.get('platform') as SocialPlatform | null
  const status = searchParams.get('status') as PostStatus | null
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10) || 50))
  const personalScope = wantsPersonalScope(req)
  const owner = resolveMarketingOwnerFromSearchParams(searchParams, user.uid)
  const fromDate = from ? new Date(from) : null
  const toDate = to ? new Date(to) : null
  const hasValidFrom = Boolean(fromDate && !isNaN(fromDate.getTime()))
  const hasValidTo = Boolean(toDate && !isNaN(toDate.getTime()))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = adminDb.collection('social_posts').where('orgId', '==', orgId)

  if (platform && VALID_LEGACY_PLATFORMS.includes(platform)) {
    query = query.where('platform', '==', platform)
  }

  if (status && VALID_STATUSES.includes(status)) {
    query = query.where('status', '==', status)
  }

  const readLimit = personalScope ? Math.min(limit * 3, 500) : limit
  const applyDateRange = (baseQuery: any, field: 'scheduledAt' | 'scheduledFor') => {
    let dateQuery = baseQuery
    if (hasValidFrom) {
      dateQuery = dateQuery.where(field, '>=', Timestamp.fromDate(fromDate!))
    }
    if (hasValidTo) {
      dateQuery = dateQuery.where(field, '<=', Timestamp.fromDate(toDate!))
    }
    return dateQuery.orderBy(field, 'asc')
  }

  const snapshots = hasValidFrom || hasValidTo
    ? await Promise.all([
        applyDateRange(query, 'scheduledAt').limit(readLimit).get(),
        applyDateRange(query, 'scheduledFor').limit(readLimit).get(),
      ])
    : [await query.limit(readLimit).get()]
  const totalPromise = !personalScope && !(hasValidFrom || hasValidTo) && typeof query.count === 'function'
    ? query.count().get().then((aggregate: { data: () => { count?: number } }) => aggregate.data().count ?? 0)
    : Promise.resolve(null)
  const aggregateTotal = await totalPromise

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byId = new Map<string, Record<string, unknown>>()
  for (const snapshot of snapshots) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snapshot.docs.forEach((doc: any) => {
      byId.set(doc.id, { id: doc.id, ...doc.data() })
    })
  }
  let posts = Array.from(byId.values()).filter((post: Record<string, unknown>) => {
    if (personalScope) return post.accountScope === PERSONAL_SCOPE && post.ownerUid === user.uid
    return recordVisibleForOwner(post, owner)
  })

  // Compatibility fallback for older rows that only have scheduledFor.
  if (hasValidFrom) {
    const fromTs = Timestamp.fromDate(fromDate!)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    posts = posts.filter((p: any) => {
      const sf: Timestamp | undefined = p.scheduledFor ?? p.scheduledAt
      return sf && sf.seconds >= fromTs.seconds
    })
  }

  if (hasValidTo) {
    const toTs = Timestamp.fromDate(toDate!)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    posts = posts.filter((p: any) => {
      const sf: Timestamp | undefined = p.scheduledFor ?? p.scheduledAt
      return sf && sf.seconds <= toTs.seconds
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  posts.sort((a: any, b: any) => {
    const aTs: Timestamp | undefined = a.scheduledFor ?? a.scheduledAt
    const bTs: Timestamp | undefined = b.scheduledFor ?? b.scheduledAt
    return (aTs?.seconds ?? 0) - (bTs?.seconds ?? 0)
  })

  // Members with an owned_or_linked marketing scope see only posts they own /
  // are shared / linked to their CRM book; admins, agents and 'all' members
  // pass through unchanged. Scoped members get the filtered length as total so
  // the aggregate count does not leak rows they cannot see.
  const seesAllMarketing = await memberSeesAllModuleRecords(user, orgId, 'marketing')
  const visiblePosts = seesAllMarketing
    ? posts
    : await filterOwnedRowsForActor(user, orgId, 'marketing', posts)
  const total = seesAllMarketing ? (aggregateTotal ?? posts.length) : visiblePosts.length

  return apiSuccess(visiblePosts.slice(0, limit), 200, { total, page: 1, limit })
}))

export const POST = withAuth('client', withTenant(async (req, user, orgId) => {
  const body = await req.json()
  let personalScope = wantsPersonalScope(req)
  let owner = resolveMarketingOwnerFromSearchParams(new URL(req.url).searchParams, user.uid)
  const campaignId = typeof body.campaignId === 'string' ? body.campaignId.trim() : ''

  if (campaignId) {
    const campaignSnap = await adminDb.collection('campaigns').doc(campaignId).get()
    if (!campaignSnap.exists || campaignSnap.data()?.deleted) return apiError('campaignId not found', 400)
    const campaign = campaignSnap.data() ?? {}
    if (campaign.orgId !== orgId) return apiError('campaignId belongs to a different organisation', 403)
    const campaignIsPersonal = isPersonalCampaignRecord(campaign)
    if (campaignIsPersonal && campaign.ownerUid !== user.uid) return apiError('Campaign not found', 404)
    if (campaignIsPersonal) {
      personalScope = true
      owner = { owner: 'personal', uid: user.uid }
    } else if (personalScope) {
      return apiError('Personal posts cannot be attached to an organisation campaign', 400)
    } else {
      const campaignCompanyId = recordCompanyId(campaign)
      if (campaignCompanyId) owner = { owner: 'company', companyId: campaignCompanyId, uid: user.uid }
    }
  }

  // --- Resolve content ---
  let contentText: string
  let platformOverrides: Record<string, unknown> = {}

  if (typeof body.content === 'string') {
    contentText = body.content.trim()
  } else if (body.content?.text) {
    contentText = (body.content.text as string).trim()
    platformOverrides = body.content.platformOverrides ?? {}
  } else {
    return apiError('content is required (string or { text })')
  }

  if (!contentText) return apiError('content text must be non-empty')

  // --- Resolve platforms ---
  let platforms: SocialPlatformType[] = []
  let legacyPlatform: SocialPlatform | null = null

  if (body.platforms && Array.isArray(body.platforms)) {
    for (const p of body.platforms) {
      const pt = toProviderPlatform(p)
      if (!pt || !ACTIVE_PLATFORMS.includes(pt)) {
        return apiError(`Unsupported platform: ${p}. Supported: ${ACTIVE_PLATFORMS.join(', ')}`)
      }
      platforms.push(pt)
    }
  } else if (body.platform) {
    legacyPlatform = toLegacyPlatform(body.platform)
    if (!legacyPlatform) {
      return apiError('platform must be one of: x, linkedin')
    }
    platforms = [toProviderPlatform(body.platform)!]
  } else {
    return apiError('platforms[] or platform is required')
  }

  // --- Validate content against platform constraints ---
  const validation = validatePostContent(contentText, platforms, {
    threadParts: body.threadParts,
    mediaCount: body.media?.length,
  })

  if (!validation.valid) {
    return apiError(`Validation failed: ${validation.errors.map(e => e.message).join('; ')}`)
  }

  const accountIds = Array.isArray(body.accountIds)
    ? body.accountIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
    : []

  if (personalScope) {
    if (accountIds.length === 0) {
      return apiError('Select at least one personal account before creating a personal post', 400)
    }

    for (const accountId of accountIds) {
      const accountDoc = await adminDb.collection('social_accounts').doc(accountId).get()
      const account = accountDoc.data()
      if (
        !accountDoc.exists ||
        account?.orgId !== orgId ||
        !accountAllowedForPublish(account, { personal: true, ownerUid: user.uid })
      ) {
        return apiError('Selected personal account is not available to this user', 403)
      }
      const accountPlatform = toProviderPlatform(String(account.platform ?? ''))
      if (!accountPlatform || !platforms.includes(accountPlatform)) {
        return apiError('Selected personal account does not match the chosen platform', 400)
      }
    }
  } else if (accountIds.length > 0) {
    for (const accountId of accountIds) {
      const accountDoc = await adminDb.collection('social_accounts').doc(accountId).get()
      const account = accountDoc.data()
      if (
        !accountDoc.exists ||
        account?.orgId !== orgId ||
        !accountAllowedForPublish(account, { personal: false, companyId: owner.companyId })
      ) {
        return apiError('Selected company/organisation account is not available for this workspace', 403)
      }
      const accountPlatform = toProviderPlatform(String(account.platform ?? ''))
      if (!accountPlatform || !platforms.includes(accountPlatform)) {
        return apiError('Selected company/organisation account does not match the chosen platform', 400)
      }
    }
  }

  // --- Resolve scheduling ---
  const scheduledForRaw = body.scheduledFor ?? body.scheduledAt
  let scheduledAt: Timestamp | null = null
  let status: PostStatus = 'draft'

  if (scheduledForRaw) {
    const scheduledDate = new Date(scheduledForRaw)
    if (isNaN(scheduledDate.getTime())) {
      return apiError('scheduledFor/scheduledAt must be a valid ISO date string')
    }
    scheduledAt = Timestamp.fromDate(scheduledDate)
  }

  if (body.status === 'draft') status = 'draft'

  const relationshipInput = relationshipInputFrom(body as Record<string, unknown>)
  const relationships = relationshipInput
    ? normalizeResourceRelationshipLinks(relationshipInput)
    : { ok: true as const, value: {} }
  if (!relationships.ok) return apiError(relationships.error, 400)

  // --- Build EnhancedSocialPost document ---
  const doc = {
    platform: legacyPlatform ?? (platforms[0] === 'twitter' ? 'x' : platforms[0]),
    orgId,
    content: {
      text: contentText,
      platformOverrides,
    },
    media: body.media ?? [],
    platforms,
    accountIds,
    ...ownerFieldsForWrite(personalScope ? { owner: 'personal', uid: user.uid } : owner),
    ...clientVisibilityFieldsForWrite(body.clientVisibility),
    status,
    scheduledAt,
    scheduledFor: scheduledAt,
    publishedAt: null,
    platformResults: {},
    hashtags: body.hashtags ?? [],
    labels: body.labels ?? [],
    campaign: body.campaign ?? null,
    campaignId: campaignId || null,
    pillarId: typeof body.pillarId === 'string' ? body.pillarId : null,
    audience: typeof body.audience === 'string' ? body.audience : null,
    ...actorFrom(user),
    assignedTo: null,
    approval: emptyApprovalState(),
    approvedBy: null,
    approvedAt: null,
    comments: [],
    source: (user.uid === 'ai-agent' ? 'ai_agent' : 'api') as string,
    threadParts: body.threadParts ?? [],
    firstComment: typeof body.firstComment === 'string' && body.firstComment.trim()
      ? body.firstComment.trim()
      : null,
    firstCommentStatus: typeof body.firstComment === 'string' && body.firstComment.trim()
      ? 'pending'
      : null,
    linkedinShareType: body.linkedinShareType === 'organization' || body.linkedinShareType === 'profile'
      ? body.linkedinShareType
      : null,
    category: body.category ?? 'other',
    tags: body.tags ?? [],
    ...relationships.value,
    externalId: null,
    error: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  const docRef = await adminDb.collection('social_posts').add(doc)
  await touchPortalDashboardSummary({
    orgId,
    increments: {
      'counts.posts': 1,
      'social.total': 1,
      'social.byStatus.draft': status === 'draft' ? 1 : 0,
    },
    staleReason: 'social_post.created',
  })

  await logAudit({
    orgId,
    action: 'post.created',
    entityType: 'post',
    entityId: docRef.id,
    performedBy: user.uid,
    performedByRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    details: { platforms, status, contentLength: contentText.length },
    ip: req.headers.get('x-forwarded-for'),
  })

  // Send approval notification if post requires approval
  // Check org settings for default approval requirement
  try {
    const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
    if (orgDoc.exists && orgDoc.data()?.settings?.defaultApprovalRequired && status === 'draft') {
      notifyApprovalNeeded(docRef.id, contentText, orgId).catch(() => {})
    }
  } catch (err) {
    console.error('[Social] Failed to check approval requirement:', err)
  }

  logActivity({
    orgId,
    type: 'social_post_created',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: `Created ${doc.platform} post`,
    entityId: docRef.id,
    entityType: 'social_post',
  }).catch(() => {})

  const handoff = await import('@/lib/messages/openContextHandoff')
    .then((mod) => mod.handoffOpenContextFromCreate({
      orgId,
      body: body as Record<string, unknown>,
      kind: 'social',
      id: docRef.id,
      label: contentText.slice(0, 80) || 'Social post',
      summary: `status: ${status} | platforms: ${platforms.join(', ')}`,
    }))
    .catch(() => null)

  return apiSuccess({
    id: docRef.id,
    ...(handoff ? {
      contextRef: handoff.contextRef,
      uiActions: handoff.uiActions,
      messagesAttach: handoff.messagesAttach,
    } : {}),
  }, 201)
}))
