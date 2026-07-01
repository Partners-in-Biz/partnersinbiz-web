import { buildAgentGrowthCommandQueue } from '@/lib/agent/growth-command-queue'
import type { BriefingCard } from '@/lib/briefing/types'
import type { CrmPipelineDiagnostics } from '@/lib/crm/pipeline-diagnostics'
import type { SocialContentReadiness } from '@/lib/social/content-readiness'
import type { SocialFailedPostDiagnostics } from '@/lib/social/failed-post-diagnostics'

const crm = {
  generatedAt: '2026-07-01T08:00:00.000Z',
  summary: {
    totalContacts: 5,
    leadContacts: 1,
    prospectContacts: 1,
    leadLikeContacts: 2,
    totalDeals: 5,
    openDeals: 5,
    wonDeals: 0,
    lostDeals: 0,
    openPipelineValue: 0,
    weightedOpenPipelineValue: 0,
    pipelineCount: 1,
    defaultPipelineCount: 1,
    openStageCount: 1,
  },
  contactFunnel: { byType: {}, byStage: {}, bySource: {} },
  dealFunnel: { byPipelineStage: [] },
  dataQuality: {
    contactsWithoutCompany: 0,
    contactsWithoutOwner: 0,
    openDealsMissingValue: 5,
    openDealsMissingPipeline: 0,
    openDealsMissingStage: 0,
    openDealsMissingContact: 0,
    openDealsMissingCompany: 0,
    openDealsMissingExpectedCloseDate: 5,
  },
  primaryFinding: {
    code: 'open_deals_without_value',
    title: 'Open deals exist, but pipeline value is zero',
    detail: 'The open pipeline is present but commercially unpriced.',
  },
  nextActions: ['Add realistic expected values to open deals before using pipeline value in CEO decisions.'],
} satisfies CrmPipelineDiagnostics

const social = {
  generatedAt: '2026-07-01T08:00:00.000Z',
  recommendedPlatforms: ['linkedin'],
  summary: {
    totalPosts: 7,
    readyToSchedulePosts: 0,
    reusableVaultPosts: 0,
    upcomingScheduledPosts: 0,
    publishedLast30Days: 0,
    draftPosts: 7,
    reviewPosts: 0,
    failedPosts: 1,
    postsMissingRequiredMedia: 0,
    readyPostsBlockedByMissingActiveAccount: 0,
    activeAccounts: 3,
    activePlatformCount: 3,
    missingRecommendedPlatforms: ['instagram'],
    pendingQueueEntries: 0,
  },
  platformCoverage: [],
  platformBlockers: [],
  actionQueue: [],
  primaryFinding: {
    code: 'failed_posts_need_recovery',
    title: 'Failed social posts need recovery before new volume',
    detail: 'Existing failed posts should be inspected before agents add more publishing load.',
  },
  nextActions: ['Ask Maya to inspect failed posts.'],
} satisfies SocialContentReadiness

const failedSocial = {
  generatedAt: '2026-07-01T08:00:00.000Z',
  summary: {
    totalPosts: 7,
    failedPosts: 1,
    platformsAffected: 1,
    affectedAccounts: 1,
    activeAffectedAccounts: 0,
    disconnectedAffectedAccounts: 1,
    expiredOrUnpublishableFailures: 1,
    mediaCredentialFailures: 0,
    retryableFailures: 0,
    blockedFailures: 1,
  },
  platformBreakdown: [],
  errorBreakdown: [],
  recoveryQueue: [],
  primaryFinding: {
    code: 'auth_reconnect_required',
    title: 'Social account reconnects are blocking failed-post recovery',
    detail: 'At least one failed post points to expired account state.',
  },
  nextActions: ['Ask Maya to prepare a reconnect list.'],
} satisfies SocialFailedPostDiagnostics

const briefingItem = {
  id: 'approval:1',
  title: 'Approve proposal follow-up',
  summary: 'CEO approval is required before any prospect-visible follow-up.',
  excerpt: null,
  priority: 'needs-peet',
  source: { type: 'approval', id: 'approval-1', collectionPath: 'approvals', url: '/admin/briefings' },
  context: { orgId: 'pib-platform-owner', reviewerAgentId: 'pip' },
  actor: { id: 'agent:pip', role: 'ai', type: 'agent' },
  occurredAt: new Date('2026-07-01T08:00:00.000Z'),
  createdAt: new Date('2026-07-01T08:00:00.000Z'),
  updatedAt: new Date('2026-07-01T08:00:00.000Z'),
  timeAgo: 'now',
  unread: true,
  requiresAction: true,
  relevanceScore: 100,
  status: 'active',
  sourceHash: 'hash',
  actions: [],
  metadata: {},
} as unknown as BriefingCard

function briefing(overrides: Partial<BriefingCard> & { id: string; title: string; summary: string; source: BriefingCard['source'] }): BriefingCard {
  return {
    id: overrides.id,
    title: overrides.title,
    summary: overrides.summary,
    excerpt: null,
    priority: overrides.priority ?? 'needs-peet',
    source: overrides.source,
    context: overrides.context ?? { orgId: 'pib-platform-owner', reviewerAgentId: 'pip' },
    actor: overrides.actor ?? { id: 'agent:pip', role: 'ai', type: 'agent' },
    occurredAt: overrides.occurredAt ?? new Date('2026-07-01T08:00:00.000Z'),
    createdAt: overrides.createdAt ?? new Date('2026-07-01T08:00:00.000Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-07-01T08:00:00.000Z'),
    timeAgo: overrides.timeAgo ?? 'now',
    unread: overrides.unread ?? true,
    requiresAction: overrides.requiresAction ?? true,
    relevanceScore: overrides.relevanceScore ?? 100,
    status: overrides.status ?? 'active',
    sourceHash: overrides.sourceHash ?? `hash:${overrides.id}`,
    actions: overrides.actions ?? [],
    metadata: overrides.metadata ?? {},
  } as unknown as BriefingCard
}

describe('buildAgentGrowthCommandQueue', () => {
  it('combines stored diagnostics into a CEO chat queue with approval gates', () => {
    const queue = buildAgentGrowthCommandQueue({
      orgId: 'pib-platform-owner',
      crm,
      social,
      failedSocial,
      briefing: {
        generatedAt: '2026-07-01T08:00:00.000Z',
        total: 1,
        items: [briefingItem],
      },
      generatedAt: '2026-07-01T08:01:00.000Z',
    })

    expect(queue.operatingRule.dashboardPolicy).toContain('Do not create')
    expect(queue.operatingRule.chatOutputContract).toContain('approval_card')
    expect(queue.dataAvailability.availableSources).toEqual(expect.arrayContaining([
      'crmPipelineDiagnostics',
      'socialContentReadiness',
      'failedPostDiagnostics',
      'briefingFeed',
    ]))
    expect(queue.dataAvailability.requiredGatherSkills).toEqual(expect.arrayContaining([
      'crm-hygiene-gather',
      'social-recovery-gather',
      'approval-queue-gather',
    ]))
    expect(queue.dataAvailability.safeNextStep).toContain('If a required fact is missing')
    expect(queue.sourceReports.crmPipelineDiagnostics.primaryFinding.code).toBe('open_deals_without_value')
    expect(queue.sourceReports.briefingFeed.approvalLikeItems).toBe(1)
    expect(queue.sourceReports.briefingFeed.recoveredAgentRuns).toEqual({ count: 0, ids: [] })
    expect(queue.queue[0].kind).toBe('ceo-approval')
    expect(queue.queue.map((item) => item.kind)).toEqual(expect.arrayContaining([
      'crm-cleanup',
      'failed-social-recovery',
      'marketing-review',
    ]))
    expect(queue.queue.every((item) => item.blockedUntilApproval.join(' ').includes('without CEO approval') || item.blockedUntilApproval.join(' ').includes('No send'))).toBe(true)
    expect(queue.analysisPrompt).toContain('dynamic Messages window')
    expect(queue.analysisPrompt).toContain('If the data is missing, request or create the gather skill first')
  })

  it('downgrades past missing-Meet booking cards to cleanup instead of CEO approval', () => {
    const queue = buildAgentGrowthCommandQueue({
      orgId: 'pib-platform-owner',
      crm,
      social: {
        ...social,
        summary: { ...social.summary, draftPosts: 0, failedPosts: 0 },
        primaryFinding: {
          code: 'content_ready',
          title: 'Content is ready',
          detail: 'No social action needed.',
        },
      },
      failedSocial: {
        ...failedSocial,
        summary: { ...failedSocial.summary, failedPosts: 0, blockedFailures: 0 },
      },
      briefing: {
        generatedAt: '2026-07-01T08:00:00.000Z',
        total: 1,
        items: [
          briefing({
            id: 'booking:past',
            title: 'Booking needs Meet link: Buhle',
            summary: '20-minute call with Buhle on 2026-06-29 at 11:00. Africa/Johannesburg. Meet link missing',
            priority: 'critical',
            source: { type: 'booking', id: 'booking-past', collectionPath: 'bookings', url: '/admin/bookings/booking-past' },
          }),
        ],
      },
      generatedAt: '2026-07-01T08:01:00.000Z',
    })

    const bookingItem = queue.queue.find((item) => item.id === 'briefing:booking:past')
    expect(bookingItem).toMatchObject({
      kind: 'ops-cleanup',
      priority: 'review',
      recommendedAgent: 'nora',
      approvalRequired: false,
    })
    expect(bookingItem?.summary).toContain('already in the past')
    expect(queue.sourceReports.briefingFeed.approvalLikeItems).toBe(0)
  })

  it('surfaces approved content blocked by missing active accounts in the CEO chat queue', () => {
    const queue = buildAgentGrowthCommandQueue({
      orgId: 'pib-platform-owner',
      crm,
      social: {
        ...social,
        summary: {
          ...social.summary,
          draftPosts: 0,
          failedPosts: 0,
          readyToSchedulePosts: 12,
          readyPostsBlockedByMissingActiveAccount: 12,
        },
        platformBlockers: [{
          platform: 'tiktok',
          reason: 'missing_active_account',
          affectedReadyPosts: 12,
          postIds: ['tiktok-1', 'tiktok-2'],
        }],
        primaryFinding: {
          code: 'approved_content_missing_active_accounts',
          title: 'Approved content is parked because target accounts are missing',
          detail: 'Some approved posts target platforms without active accounts.',
        },
      },
      failedSocial: {
        ...failedSocial,
        summary: { ...failedSocial.summary, failedPosts: 0, blockedFailures: 0 },
      },
      briefing: {
        generatedAt: '2026-07-01T08:00:00.000Z',
        total: 0,
        items: [],
      },
      generatedAt: '2026-07-01T08:01:00.000Z',
    })

    const marketingItem = queue.queue.find((item) => item.id === 'social:approved_content_missing_active_accounts')
    expect(marketingItem).toMatchObject({
      kind: 'marketing-review',
      approvalRequired: true,
      recommendedAgent: 'maya',
    })
    expect(marketingItem?.summary).toContain('12 approved/vaulted posts are parked')
    expect(marketingItem?.summary).toContain('tiktok (12)')
    expect(marketingItem?.allowedNow).toContain('Identify approved content parked by missing active platform accounts.')
    expect(queue.sourceReports.socialContentReadiness.platformBlockers).toEqual([{
      platform: 'tiktok',
      reason: 'missing_active_account',
      affectedReadyPosts: 12,
      postIds: ['tiktok-1', 'tiktok-2'],
    }])
  })

  it('keeps future missing-Meet booking cards approval-gated', () => {
    const queue = buildAgentGrowthCommandQueue({
      orgId: 'pib-platform-owner',
      crm,
      social: {
        ...social,
        summary: { ...social.summary, draftPosts: 0, failedPosts: 0 },
        primaryFinding: {
          code: 'content_ready',
          title: 'Content is ready',
          detail: 'No social action needed.',
        },
      },
      failedSocial: {
        ...failedSocial,
        summary: { ...failedSocial.summary, failedPosts: 0, blockedFailures: 0 },
      },
      briefing: {
        generatedAt: '2026-07-01T08:00:00.000Z',
        total: 1,
        items: [
          briefing({
            id: 'booking:future',
            title: 'Booking needs Meet link: Future lead',
            summary: '20-minute call with Future lead on 2026-07-03 at 11:00. Africa/Johannesburg. Meet link missing',
            priority: 'critical',
            source: { type: 'booking', id: 'booking-future', collectionPath: 'bookings', url: '/admin/bookings/booking-future' },
          }),
        ],
      },
      generatedAt: '2026-07-01T08:01:00.000Z',
    })

    const bookingItem = queue.queue.find((item) => item.id === 'briefing:booking:future')
    expect(bookingItem).toMatchObject({
      kind: 'ceo-approval',
      priority: 'critical',
      approvalRequired: true,
    })
    expect(queue.sourceReports.briefingFeed.approvalLikeItems).toBe(1)
  })

  it('downgrades recovered failed agent-run cards to cleanup instead of critical retry work', () => {
    const queue = buildAgentGrowthCommandQueue({
      orgId: 'pib-platform-owner',
      crm,
      social: {
        ...social,
        summary: { ...social.summary, draftPosts: 0, failedPosts: 0 },
        primaryFinding: {
          code: 'content_ready',
          title: 'Content is ready',
          detail: 'No social action needed.',
        },
      },
      failedSocial: {
        ...failedSocial,
        summary: { ...failedSocial.summary, failedPosts: 0, blockedFailures: 0 },
      },
      briefing: {
        generatedAt: '2026-07-01T08:00:00.000Z',
        total: 1,
        items: [
          briefing({
            id: 'agent-run:recovered',
            title: 'Pip run needs recovery',
            summary: 'Pip run failed and needs review.',
            priority: 'critical',
            source: { type: 'agent-run', id: 'run-doc-recovered', collectionPath: 'hermes_runs', url: '/admin/agents/pip?run=run_123' },
          }),
        ],
      },
      recoveredAgentRunIds: ['run-doc-recovered'],
      generatedAt: '2026-07-01T08:01:00.000Z',
    })

    const runItem = queue.queue.find((item) => item.id === 'briefing:agent-run:recovered')
    expect(runItem).toMatchObject({
      kind: 'ops-cleanup',
      priority: 'review',
      recommendedAgent: 'pip',
      approvalRequired: false,
    })
    expect(runItem?.summary).toContain('already recovered')
    expect(runItem?.blockedUntilApproval.join(' ')).toContain('Do not retry')
    expect(queue.sourceReports.briefingFeed.approvalLikeItems).toBe(0)
    expect(queue.sourceReports.briefingFeed.recoveredAgentRuns).toEqual({
      count: 1,
      ids: ['run-doc-recovered'],
    })
  })

  it('keeps unresolved failed agent-run cards critical and approval-gated', () => {
    const queue = buildAgentGrowthCommandQueue({
      orgId: 'pib-platform-owner',
      crm,
      social: {
        ...social,
        summary: { ...social.summary, draftPosts: 0, failedPosts: 0 },
        primaryFinding: {
          code: 'content_ready',
          title: 'Content is ready',
          detail: 'No social action needed.',
        },
      },
      failedSocial: {
        ...failedSocial,
        summary: { ...failedSocial.summary, failedPosts: 0, blockedFailures: 0 },
      },
      briefing: {
        generatedAt: '2026-07-01T08:00:00.000Z',
        total: 1,
        items: [
          briefing({
            id: 'agent-run:unresolved',
            title: 'Maya run needs recovery',
            summary: 'Maya run failed and needs review.',
            priority: 'critical',
            source: { type: 'agent-run', id: 'run-doc-unresolved', collectionPath: 'hermes_runs', url: '/admin/agents/maya?run=run_456' },
          }),
        ],
      },
      generatedAt: '2026-07-01T08:01:00.000Z',
    })

    const runItem = queue.queue.find((item) => item.id === 'briefing:agent-run:unresolved')
    expect(runItem).toMatchObject({
      kind: 'agent-review',
      priority: 'critical',
      approvalRequired: true,
    })
    expect(queue.sourceReports.briefingFeed.approvalLikeItems).toBe(1)
  })
})
