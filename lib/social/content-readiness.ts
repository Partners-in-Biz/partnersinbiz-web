type TimestampLike = { seconds?: number; _seconds?: number; toDate?: () => Date }

type SocialPostLike = Record<string, unknown> & {
  id?: string
  status?: string
  platform?: string
  platforms?: unknown
  content?: string | { text?: string }
  media?: unknown
  scheduledAt?: unknown
  scheduledFor?: unknown
  publishedAt?: unknown
  updatedAt?: unknown
  createdAt?: unknown
  accountScope?: string
  ownerUid?: string
  deleted?: boolean
}

type SocialAccountLike = Record<string, unknown> & {
  id?: string
  platform?: string
  status?: string
  accountScope?: string
  ownerUid?: string
  deleted?: boolean
}

type QueueEntryLike = Record<string, unknown> & {
  id?: string
  postId?: string
  status?: string
  scheduledAt?: unknown
  scheduledFor?: unknown
  updatedAt?: unknown
}

export type SocialContentFindingCode =
  | 'no_connected_accounts'
  | 'missing_active_platform_accounts'
  | 'no_stored_content'
  | 'failed_posts_need_recovery'
  | 'approved_content_missing_active_accounts'
  | 'calendar_gap'
  | 'drafts_need_review'
  | 'media_gap'
  | 'content_ready'

export interface SocialContentReadinessInput {
  posts: SocialPostLike[]
  accounts: SocialAccountLike[]
  queueEntries: QueueEntryLike[]
  now?: Date
}

export interface SocialContentReadiness {
  generatedAt: string
  recommendedPlatforms: string[]
  summary: {
    totalPosts: number
    readyToSchedulePosts: number
    reusableVaultPosts: number
    upcomingScheduledPosts: number
    publishedLast30Days: number
    draftPosts: number
    reviewPosts: number
    failedPosts: number
    postsMissingRequiredMedia: number
    readyPostsBlockedByMissingActiveAccount: number
    activeAccounts: number
    activePlatformCount: number
    missingRecommendedPlatforms: string[]
    pendingQueueEntries: number
  }
  platformCoverage: Array<{
    platform: string
    activeAccounts: number
    readyToSchedulePosts: number
    upcomingScheduledPosts: number
    publishedLast30Days: number
    missingRequiredMedia: number
  }>
  platformBlockers: Array<{
    platform: string
    reason: 'missing_active_account'
    affectedReadyPosts: number
    postIds: string[]
  }>
  actionQueue: Array<{
    postId: string
    action: 'schedule_or_repurpose' | 'repair_failed_publish' | 'submit_for_review' | 'attach_required_media' | 'connect_missing_account'
    reason: string
    platforms: string[]
  }>
  primaryFinding: {
    code: SocialContentFindingCode
    title: string
    detail: string
  }
  nextActions: string[]
}

const RECOMMENDED_PIB_PLATFORMS = ['facebook', 'instagram', 'linkedin', 'twitter', 'bluesky', 'pinterest']
const READY_TO_SCHEDULE_STATUSES = new Set(['approved', 'vaulted'])
const REUSABLE_VAULT_STATUSES = new Set(['approved', 'scheduled', 'published', 'partially_published', 'vaulted'])
const REVIEW_STATUSES = new Set(['pending_approval', 'qa_review', 'client_review', 'regenerating'])
const MEDIA_REQUIRED_PLATFORMS = new Set(['instagram', 'pinterest', 'youtube', 'tiktok'])
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

function normalizePlatform(platform: unknown): string | null {
  if (typeof platform !== 'string') return null
  const clean = platform.trim().toLowerCase()
  if (!clean) return null
  return clean === 'x' ? 'twitter' : clean
}

function postPlatforms(post: SocialPostLike): string[] {
  const platforms = Array.isArray(post.platforms)
    ? post.platforms
    : post.platform
      ? [post.platform]
      : []
  return Array.from(new Set(platforms.map(normalizePlatform).filter((platform): platform is string => Boolean(platform))))
}

function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const time = Date.parse(value)
    return Number.isNaN(time) ? null : new Date(time)
  }
  if (typeof value === 'object') {
    const ts = value as TimestampLike
    if (typeof ts.toDate === 'function') return ts.toDate()
    const seconds = ts.seconds ?? ts._seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000)
  }
  return null
}

function postDate(post: SocialPostLike, fields: Array<keyof SocialPostLike>): Date | null {
  for (const field of fields) {
    const date = toDate(post[field])
    if (date) return date
  }
  return null
}

function hasMedia(post: SocialPostLike): boolean {
  if (!Array.isArray(post.media)) return false
  return post.media.some((item) => {
    if (!item || typeof item !== 'object') return false
    const media = item as { url?: unknown; originalUrl?: unknown; thumbnailUrl?: unknown }
    return typeof media.url === 'string' || typeof media.originalUrl === 'string' || typeof media.thumbnailUrl === 'string'
  })
}

function contentPreview(post: SocialPostLike): string {
  if (typeof post.content === 'string') return post.content.slice(0, 80)
  if (post.content && typeof post.content === 'object' && typeof post.content.text === 'string') {
    return post.content.text.slice(0, 80)
  }
  return 'Stored social post'
}

function isOrgRecord(record: { accountScope?: string }): boolean {
  return record.accountScope !== 'personal'
}

function isActiveAccount(account: SocialAccountLike): boolean {
  return account.deleted !== true && isOrgRecord(account) && account.status === 'active' && Boolean(normalizePlatform(account.platform))
}

function findingFor(summary: SocialContentReadiness['summary']): SocialContentReadiness['primaryFinding'] {
  if (summary.activeAccounts === 0) {
    return {
      code: 'no_connected_accounts',
      title: 'No active social accounts are connected',
      detail: 'Agents cannot safely schedule or publish until the workspace has active platform accounts connected for this organisation.',
    }
  }
  if (summary.activePlatformCount < 3 || summary.missingRecommendedPlatforms.length >= 4) {
    return {
      code: 'missing_active_platform_accounts',
      title: 'Core social platform coverage is incomplete',
      detail: 'The workspace has some active accounts, but not enough of the recommended Partners in Biz platform set for a daily growth engine.',
    }
  }
  if (summary.totalPosts === 0) {
    return {
      code: 'no_stored_content',
      title: 'No stored social content is available',
      detail: 'Maya needs content stored in the platform before she can analyze, schedule, repurpose, or build a daily queue from real data.',
    }
  }
  if (summary.failedPosts > 0) {
    return {
      code: 'failed_posts_need_recovery',
      title: 'Failed social posts need recovery before new volume',
      detail: 'Existing failed posts should be inspected and either repaired, rescheduled, or deliberately held before agents add more publishing load.',
    }
  }
  if (summary.readyPostsBlockedByMissingActiveAccount > 0) {
    return {
      code: 'approved_content_missing_active_accounts',
      title: 'Approved content is parked because target accounts are missing',
      detail: 'Some approved or vaulted posts target platforms that do not have active accounts, so agents must not schedule them until the account coverage is fixed or the content is repurposed.',
    }
  }
  if (summary.readyToSchedulePosts > 0 && summary.upcomingScheduledPosts === 0) {
    return {
      code: 'calendar_gap',
      title: 'Approved content exists, but the upcoming calendar is empty',
      detail: 'The Vault has content that can be used, but there is no dated schedule for the next publishing window.',
    }
  }
  if (summary.postsMissingRequiredMedia > 0) {
    return {
      code: 'media_gap',
      title: 'Some visual-platform posts are missing media',
      detail: 'Instagram, Pinterest, TikTok, and YouTube posts need usable media before they are publish-ready.',
    }
  }
  if (summary.draftPosts > 0 || summary.reviewPosts > 0) {
    return {
      code: 'drafts_need_review',
      title: 'Draft or review content needs agent attention',
      detail: 'There is content in draft or approval states that should be submitted, QA checked, approved, or rewritten from comments.',
    }
  }
  return {
    code: 'content_ready',
    title: 'Marketing content engine has usable data',
    detail: 'The workspace has active accounts and a scheduled or reusable content base that agents can analyze on demand.',
  }
}

function nextActionsFor(finding: SocialContentReadiness['primaryFinding']): string[] {
  switch (finding.code) {
    case 'no_connected_accounts':
      return [
        'Connect active social accounts for the recommended Partners in Biz platforms before asking agents to publish.',
        'After accounts are connected, rerun this readiness workflow so Maya can build a real action queue from stored data.',
      ]
    case 'missing_active_platform_accounts':
      return [
        'Connect or repair the missing recommended platform accounts, starting with LinkedIn, Facebook, Instagram, Twitter, Bluesky, and Pinterest.',
        'Keep publishing limited to platforms with active accounts until the coverage gap is closed.',
      ]
    case 'no_stored_content':
      return [
        'Ask Maya to create or import a platform-first content campaign so posts, media, and approvals are stored in Firestore.',
        'Do not build a dashboard for this question; rerun this data gatherer after content exists.',
      ]
    case 'failed_posts_need_recovery':
      return [
        'Ask Maya to inspect failed posts, read provider errors, and prepare a repair or hold list for approval.',
        'Avoid scheduling more volume on the failed platforms until the recovery list is handled.',
      ]
    case 'approved_content_missing_active_accounts':
      return [
        'Ask Maya to identify approved posts blocked by missing active accounts and propose connect, hold, or repurpose options.',
        'Do not reconnect accounts or schedule parked content until Peet approves the exact action.',
      ]
    case 'calendar_gap':
      return [
        'Ask Maya to turn the approved Vault content into a dated schedule using a dry-run first.',
        'Use best-time data only after confirming the target platforms have active accounts and publish-ready media.',
      ]
    case 'media_gap':
      return [
        'Ask Maya to generate or attach media for visual-platform posts before scheduling them.',
        'Verify media URLs are stored in the platform, not only on the local filesystem.',
      ]
    case 'drafts_need_review':
      return [
        'Ask Maya to move valid drafts into QA/client review and summarize any comments that require rewrites.',
        'Use the approval workflow instead of publishing drafts directly.',
      ]
    case 'content_ready':
      return [
        'Use this payload as the daily social action queue for Maya: schedule ready posts, repurpose winners, and inspect stale gaps.',
        'Create temporary HTML only when Peet asks a specific marketing question that needs visual comparison.',
      ]
  }
}

export function buildSocialContentReadiness(input: SocialContentReadinessInput): SocialContentReadiness {
  const now = input.now ?? new Date()
  const posts = input.posts.filter((post) => post.deleted !== true && isOrgRecord(post))
  const activeAccounts = input.accounts.filter(isActiveAccount)
  const activePlatforms = new Set(activeAccounts.map((account) => normalizePlatform(account.platform)).filter((platform): platform is string => Boolean(platform)))
  const pendingQueueEntries = input.queueEntries.filter((entry) => ['pending', 'scheduled', 'processing'].includes(String(entry.status ?? 'pending'))).length
  const thirtyDaysAgo = new Date(now.getTime() - THIRTY_DAYS_MS)

  const platformCoverage = new Map<string, SocialContentReadiness['platformCoverage'][number]>()
  for (const platform of RECOMMENDED_PIB_PLATFORMS) {
    platformCoverage.set(platform, {
      platform,
      activeAccounts: activeAccounts.filter((account) => normalizePlatform(account.platform) === platform).length,
      readyToSchedulePosts: 0,
      upcomingScheduledPosts: 0,
      publishedLast30Days: 0,
      missingRequiredMedia: 0,
    })
  }

  let readyToSchedulePosts = 0
  let reusableVaultPosts = 0
  let upcomingScheduledPosts = 0
  let publishedLast30Days = 0
  let draftPosts = 0
  let reviewPosts = 0
  let failedPosts = 0
  let postsMissingRequiredMedia = 0
  let readyPostsBlockedByMissingActiveAccount = 0
  const platformBlockers = new Map<string, SocialContentReadiness['platformBlockers'][number]>()
  const actionQueue: SocialContentReadiness['actionQueue'] = []

  for (const post of posts) {
    const status = String(post.status ?? 'draft')
    const platforms = postPlatforms(post)
    const scheduledDate = postDate(post, ['scheduledFor', 'scheduledAt'])
    const publishedDate = postDate(post, ['publishedAt', 'updatedAt'])
    const missingMedia = platforms.some((platform) => MEDIA_REQUIRED_PLATFORMS.has(platform)) && !hasMedia(post)
    const missingActivePlatforms = platforms.filter((platform) => !activePlatforms.has(platform))

    if (READY_TO_SCHEDULE_STATUSES.has(status)) {
      readyToSchedulePosts += 1
      if (missingActivePlatforms.length > 0) {
        readyPostsBlockedByMissingActiveAccount += 1
        for (const platform of missingActivePlatforms) {
          const blocker = platformBlockers.get(platform) ?? {
            platform,
            reason: 'missing_active_account' as const,
            affectedReadyPosts: 0,
            postIds: [],
          }
          blocker.affectedReadyPosts += 1
          blocker.postIds.push(post.id ?? 'unknown')
          platformBlockers.set(platform, blocker)
        }
      }
      actionQueue.push({
        postId: post.id ?? 'unknown',
        action: missingActivePlatforms.length > 0 ? 'connect_missing_account' : missingMedia ? 'attach_required_media' : 'schedule_or_repurpose',
        reason: missingActivePlatforms.length > 0
          ? `${status} content is parked because these target platforms have no active account: ${missingActivePlatforms.join(', ')}. ${contentPreview(post)}`
          : `${status} content is stored in the Vault: ${contentPreview(post)}`,
        platforms: missingActivePlatforms.length > 0 ? missingActivePlatforms : platforms,
      })
    }
    if (REUSABLE_VAULT_STATUSES.has(status)) reusableVaultPosts += 1
    if ((status === 'scheduled' || status === 'publishing') && scheduledDate && scheduledDate >= now) upcomingScheduledPosts += 1
    if ((status === 'published' || status === 'partially_published') && publishedDate && publishedDate >= thirtyDaysAgo) publishedLast30Days += 1
    if (status === 'draft') {
      draftPosts += 1
      actionQueue.push({ postId: post.id ?? 'unknown', action: 'submit_for_review', reason: 'Draft content is stored but not in the approval flow yet.', platforms })
    }
    if (REVIEW_STATUSES.has(status)) reviewPosts += 1
    if (status === 'failed') {
      failedPosts += 1
      actionQueue.push({ postId: post.id ?? 'unknown', action: 'repair_failed_publish', reason: 'Provider publish failed and needs recovery before reuse.', platforms })
    }
    if (missingMedia) postsMissingRequiredMedia += 1

    for (const platform of platforms) {
      const coverage = platformCoverage.get(platform) ?? {
        platform,
        activeAccounts: activeAccounts.filter((account) => normalizePlatform(account.platform) === platform).length,
        readyToSchedulePosts: 0,
        upcomingScheduledPosts: 0,
        publishedLast30Days: 0,
        missingRequiredMedia: 0,
      }
      if (READY_TO_SCHEDULE_STATUSES.has(status)) coverage.readyToSchedulePosts += 1
      if ((status === 'scheduled' || status === 'publishing') && scheduledDate && scheduledDate >= now) coverage.upcomingScheduledPosts += 1
      if ((status === 'published' || status === 'partially_published') && publishedDate && publishedDate >= thirtyDaysAgo) coverage.publishedLast30Days += 1
      if (missingMedia) coverage.missingRequiredMedia += 1
      platformCoverage.set(platform, coverage)
    }
  }

  const missingRecommendedPlatforms = RECOMMENDED_PIB_PLATFORMS.filter((platform) => !activePlatforms.has(platform))
  const summary = {
    totalPosts: posts.length,
    readyToSchedulePosts,
    reusableVaultPosts,
    upcomingScheduledPosts,
    publishedLast30Days,
    draftPosts,
    reviewPosts,
    failedPosts,
    postsMissingRequiredMedia,
    readyPostsBlockedByMissingActiveAccount,
    activeAccounts: activeAccounts.length,
    activePlatformCount: activePlatforms.size,
    missingRecommendedPlatforms,
    pendingQueueEntries,
  }
  const primaryFinding = findingFor(summary)

  return {
    generatedAt: now.toISOString(),
    recommendedPlatforms: RECOMMENDED_PIB_PLATFORMS,
    summary,
    platformCoverage: Array.from(platformCoverage.values()).sort((a, b) => a.platform.localeCompare(b.platform)),
    platformBlockers: Array.from(platformBlockers.values()).sort((a, b) => b.affectedReadyPosts - a.affectedReadyPosts || a.platform.localeCompare(b.platform)),
    actionQueue: actionQueue.slice(0, 25),
    primaryFinding,
    nextActions: nextActionsFor(primaryFinding),
  }
}
