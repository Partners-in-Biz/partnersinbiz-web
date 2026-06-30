type TimestampLike = { seconds?: number; _seconds?: number; toDate?: () => Date }

type SocialPostLike = Record<string, unknown> & {
  id?: string
  status?: string
  platform?: string
  platforms?: unknown
  accountIds?: unknown
  content?: string | { text?: string }
  media?: unknown
  scheduledAt?: unknown
  scheduledFor?: unknown
  failedAt?: unknown
  updatedAt?: unknown
  createdAt?: unknown
  error?: unknown
  lastError?: unknown
  publishError?: unknown
  failureReason?: unknown
  statusMessage?: unknown
  accountScope?: string
  deleted?: boolean
  archived?: boolean
}

type SocialAccountLike = Record<string, unknown> & {
  id?: string
  platform?: string
  status?: string
  displayName?: string
  username?: string
  accountScope?: string
  deleted?: boolean
}

export type SocialFailedPostErrorCategory =
  | 'account_auth_or_publishability'
  | 'media_upload_or_scope'
  | 'provider_validation'
  | 'provider_transient'
  | 'unknown'

export interface SocialFailedPostDiagnosticsInput {
  posts: SocialPostLike[]
  accounts: SocialAccountLike[]
  now?: Date
}

export interface SocialFailedPostDiagnostics {
  generatedAt: string
  summary: {
    totalPosts: number
    failedPosts: number
    platformsAffected: number
    affectedAccounts: number
    activeAffectedAccounts: number
    disconnectedAffectedAccounts: number
    expiredOrUnpublishableFailures: number
    mediaCredentialFailures: number
    retryableFailures: number
    blockedFailures: number
  }
  platformBreakdown: Array<{
    platform: string
    failedPosts: number
    affectedAccounts: number
    activeAccounts: number
    disconnectedAccounts: number
    topErrorCategories: Array<{ category: SocialFailedPostErrorCategory; count: number }>
  }>
  errorBreakdown: Array<{
    category: SocialFailedPostErrorCategory
    count: number
    platforms: string[]
    example: string
    recommendedAction: string
  }>
  recoveryQueue: Array<{
    postId: string
    platforms: string[]
    accountIds: string[]
    category: SocialFailedPostErrorCategory
    reason: string
    recommendedAction: string
    safeToRetry: boolean
    failedAt: string | null
    preview: string
  }>
  primaryFinding: {
    code: 'no_failed_posts' | 'auth_reconnect_required' | 'media_scope_review_required' | 'retryable_provider_failures' | 'manual_triage_required'
    title: string
    detail: string
  }
  nextActions: string[]
}

const CATEGORY_ACTIONS: Record<SocialFailedPostErrorCategory, string> = {
  account_auth_or_publishability: 'Reconnect or refresh the affected social account before retrying these posts.',
  media_upload_or_scope: 'Review the platform app scopes/credential type and media requirements before retrying media posts.',
  provider_validation: 'Fix the post content, media format, or platform validation issue before retrying.',
  provider_transient: 'Retry after checking provider status and queue health.',
  unknown: 'Inspect the post and provider logs manually before retrying.',
}

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

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
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

function postDate(post: SocialPostLike): Date | null {
  for (const field of ['failedAt', 'updatedAt', 'scheduledFor', 'scheduledAt', 'createdAt'] as const) {
    const date = toDate(post[field])
    if (date) return date
  }
  return null
}

function recordString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object') {
    const nested = value as Record<string, unknown>
    for (const nestedKey of ['message', 'error', 'reason', 'details']) {
      const nestedValue = nested[nestedKey]
      if (typeof nestedValue === 'string' && nestedValue.trim()) return nestedValue.trim()
    }
  }
  return null
}

function failureReason(post: SocialPostLike): string {
  const direct = ['error', 'lastError', 'publishError', 'failureReason', 'statusMessage']
    .map((key) => recordString(post, key))
    .find((value): value is string => Boolean(value))
  if (direct) return direct

  for (const containerKey of ['publishing', 'metadata', 'provider', 'queue']) {
    const container = post[containerKey]
    if (!container || typeof container !== 'object') continue
    const nested = ['error', 'lastError', 'publishError', 'failureReason', 'statusMessage']
      .map((key) => recordString(container as Record<string, unknown>, key))
      .find((value): value is string => Boolean(value))
    if (nested) return nested
  }

  return 'No provider error stored on the failed post.'
}

function classifyFailure(reason: string): SocialFailedPostErrorCategory {
  const text = reason.toLowerCase()
  if (/(expired|expired_access_token|reconnect|not publishable|unable to authenticate|unauthori[sz]ed|401)/.test(text)) {
    return 'account_auth_or_publishability'
  }
  if (/(expired|token|oauth|unauthori[sz]ed|authenticat|permission|scope|reconnect|not publishable|401|403|unable to authenticate)/.test(text)) {
    if (/(media|upload|oauth 1\.0a|scope|credential|container|video|image)/.test(text)) return 'media_upload_or_scope'
    return 'account_auth_or_publishability'
  }
  if (/(media|upload|image|video|thumbnail|format|dimension|container|mime|file)/.test(text)) return 'media_upload_or_scope'
  if (/(validation|invalid|unsupported|too long|duplicate|policy|missing|required|character limit)/.test(text)) return 'provider_validation'
  if (/(timeout|temporar|rate limit|429|5\d\d|server error|unavailable|try again|network)/.test(text)) return 'provider_transient'
  return 'unknown'
}

function isOrgRecord(record: { accountScope?: string }): boolean {
  return record.accountScope !== 'personal'
}

function isActiveAccount(account: SocialAccountLike): boolean {
  return account.deleted !== true && isOrgRecord(account) && account.status === 'active' && Boolean(normalizePlatform(account.platform))
}

function contentPreview(post: SocialPostLike): string {
  if (typeof post.content === 'string') return post.content.slice(0, 100)
  if (post.content && typeof post.content === 'object' && typeof post.content.text === 'string') {
    return post.content.text.slice(0, 100)
  }
  return 'Failed social post'
}

function increment(map: Map<string, number>, key: string, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount)
}

function sortedCounts<T extends string>(map: Map<T, number>): Array<{ category: T; count: number }> {
  return Array.from(map.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
}

function categoryPriority(category: SocialFailedPostErrorCategory): number {
  switch (category) {
    case 'account_auth_or_publishability':
      return 0
    case 'media_upload_or_scope':
      return 1
    case 'provider_validation':
      return 2
    case 'unknown':
      return 3
    case 'provider_transient':
      return 4
  }
}

function primaryFinding(summary: SocialFailedPostDiagnostics['summary']): SocialFailedPostDiagnostics['primaryFinding'] {
  if (summary.failedPosts === 0) {
    return {
      code: 'no_failed_posts',
      title: 'No failed social posts need recovery',
      detail: 'The failed-post queue is empty for this organisation.',
    }
  }
  if (summary.expiredOrUnpublishableFailures > 0) {
    return {
      code: 'auth_reconnect_required',
      title: 'Social account reconnects are blocking failed-post recovery',
      detail: 'At least one failed post points to expired, disconnected, unauthenticated, or otherwise unpublishable account state.',
    }
  }
  if (summary.mediaCredentialFailures > 0) {
    return {
      code: 'media_scope_review_required',
      title: 'Media publishing credentials need review before retry',
      detail: 'Some failed posts involve media upload or platform app-scope problems, so blind retries would likely fail again.',
    }
  }
  if (summary.retryableFailures > 0) {
    return {
      code: 'retryable_provider_failures',
      title: 'Some failures look retryable after provider-health checks',
      detail: 'Transient provider or rate-limit failures can be retried after queue and platform health are confirmed.',
    }
  }
  return {
    code: 'manual_triage_required',
    title: 'Failed posts need manual triage before reuse',
    detail: 'Stored failures do not contain enough structured detail to retry safely without provider-log inspection.',
  }
}

function nextActionsFor(finding: SocialFailedPostDiagnostics['primaryFinding']): string[] {
  switch (finding.code) {
    case 'no_failed_posts':
      return [
        'Keep using the content-readiness workflow for draft, approval, schedule, and media gaps.',
        'Do not create a permanent dashboard; rerun this gatherer only when failed-post recovery is a current question.',
      ]
    case 'auth_reconnect_required':
      return [
        'Ask Maya to prepare a reconnect list by platform/account and keep the affected posts held until the account owner reconnects.',
        'After reconnect, rerun this gatherer and retry only the posts whose error category is no longer account-auth related.',
      ]
    case 'media_scope_review_required':
      return [
        'Ask Theo to verify social app scopes and media upload credential support for the affected platforms before any retry.',
        'Ask Maya to split text-only posts from media posts so safe text-only recovery can proceed separately.',
      ]
    case 'retryable_provider_failures':
      return [
        'Check social provider health and queue state first, then retry only the transient failures.',
        'Log the retry result back into Messages so the recovery outcome is CEO-readable.',
      ]
    case 'manual_triage_required':
      return [
        'Ask Theo to inspect provider logs for failed posts that have unknown or validation-like errors.',
        'Keep failed posts out of the schedule until each has a repair, hold, or discard decision.',
      ]
  }
}

export function buildSocialFailedPostDiagnostics(input: SocialFailedPostDiagnosticsInput): SocialFailedPostDiagnostics {
  const now = input.now ?? new Date()
  const posts = input.posts.filter((post) => post.deleted !== true && post.archived !== true && isOrgRecord(post))
  const failedPosts = posts.filter((post) => post.status === 'failed')
  const accounts = input.accounts.filter((account) => account.deleted !== true && isOrgRecord(account))
  const accountById = new Map(accounts.map((account) => [account.id, account]).filter((entry): entry is [string, SocialAccountLike] => Boolean(entry[0])))

  const platformCategoryCounts = new Map<string, Map<SocialFailedPostErrorCategory, number>>()
  const platformFailures = new Map<string, number>()
  const platformAffectedAccounts = new Map<string, Set<string>>()
  const categoryCounts = new Map<SocialFailedPostErrorCategory, number>()
  const categoryPlatforms = new Map<SocialFailedPostErrorCategory, Set<string>>()
  const categoryExamples = new Map<SocialFailedPostErrorCategory, string>()
  const affectedAccountIds = new Set<string>()
  const recoveryQueue: SocialFailedPostDiagnostics['recoveryQueue'] = []

  for (const post of failedPosts) {
    const platforms = postPlatforms(post)
    const accountIds = stringArray(post.accountIds)
    const reason = failureReason(post)
    const category = classifyFailure(reason)
    const date = postDate(post)

    increment(categoryCounts, category)
    if (!categoryExamples.has(category)) categoryExamples.set(category, reason)

    for (const accountId of accountIds) affectedAccountIds.add(accountId)
    for (const platform of platforms) {
      increment(platformFailures, platform)
      if (!platformCategoryCounts.has(platform)) platformCategoryCounts.set(platform, new Map())
      increment(platformCategoryCounts.get(platform)!, category)
      if (!platformAffectedAccounts.has(platform)) platformAffectedAccounts.set(platform, new Set())
      accountIds.forEach((accountId) => platformAffectedAccounts.get(platform)!.add(accountId))
      if (!categoryPlatforms.has(category)) categoryPlatforms.set(category, new Set())
      categoryPlatforms.get(category)!.add(platform)
    }

    recoveryQueue.push({
      postId: post.id ?? 'unknown',
      platforms,
      accountIds,
      category,
      reason,
      recommendedAction: CATEGORY_ACTIONS[category],
      safeToRetry: category === 'provider_transient',
      failedAt: date ? date.toISOString() : null,
      preview: contentPreview(post),
    })
  }

  const activeAffectedAccounts = Array.from(affectedAccountIds)
    .filter((accountId) => isActiveAccount(accountById.get(accountId) ?? {})).length
  const disconnectedAffectedAccounts = Array.from(affectedAccountIds)
    .filter((accountId) => {
      const account = accountById.get(accountId)
      return account ? account.status !== 'active' : false
    }).length

  const summary = {
    totalPosts: posts.length,
    failedPosts: failedPosts.length,
    platformsAffected: platformFailures.size,
    affectedAccounts: affectedAccountIds.size,
    activeAffectedAccounts,
    disconnectedAffectedAccounts,
    expiredOrUnpublishableFailures: (categoryCounts.get('account_auth_or_publishability') ?? 0),
    mediaCredentialFailures: (categoryCounts.get('media_upload_or_scope') ?? 0),
    retryableFailures: (categoryCounts.get('provider_transient') ?? 0),
    blockedFailures: failedPosts.length - (categoryCounts.get('provider_transient') ?? 0),
  }
  const finding = primaryFinding(summary)

  return {
    generatedAt: now.toISOString(),
    summary,
    platformBreakdown: Array.from(platformFailures.entries())
      .map(([platform, failedCount]) => {
        const affected = platformAffectedAccounts.get(platform) ?? new Set<string>()
        const activeAccounts = accounts.filter((account) => normalizePlatform(account.platform) === platform && account.status === 'active').length
        const disconnectedAccounts = accounts.filter((account) => normalizePlatform(account.platform) === platform && account.status !== 'active').length
        return {
          platform,
          failedPosts: failedCount,
          affectedAccounts: affected.size,
          activeAccounts,
          disconnectedAccounts,
          topErrorCategories: sortedCounts(platformCategoryCounts.get(platform) ?? new Map()).slice(0, 3),
        }
      })
      .sort((a, b) => b.failedPosts - a.failedPosts || a.platform.localeCompare(b.platform)),
    errorBreakdown: sortedCounts(categoryCounts)
      .map(({ category, count }) => ({
        category,
        count,
        platforms: Array.from(categoryPlatforms.get(category) ?? []).sort(),
        example: categoryExamples.get(category) ?? 'No provider error stored on the failed post.',
        recommendedAction: CATEGORY_ACTIONS[category],
      })),
    recoveryQueue: recoveryQueue
      .sort((a, b) =>
        Number(a.safeToRetry) - Number(b.safeToRetry) ||
        categoryPriority(a.category) - categoryPriority(b.category) ||
        String(a.failedAt ?? '').localeCompare(String(b.failedAt ?? '')),
      )
      .slice(0, 25),
    primaryFinding: finding,
    nextActions: nextActionsFor(finding),
  }
}
