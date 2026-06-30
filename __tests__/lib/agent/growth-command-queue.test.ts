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
    activeAccounts: 3,
    activePlatformCount: 3,
    missingRecommendedPlatforms: ['instagram'],
    pendingQueueEntries: 0,
  },
  platformCoverage: [],
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
    expect(queue.sourceReports.crmPipelineDiagnostics.primaryFinding.code).toBe('open_deals_without_value')
    expect(queue.sourceReports.briefingFeed.approvalLikeItems).toBe(1)
    expect(queue.queue[0].kind).toBe('ceo-approval')
    expect(queue.queue.map((item) => item.kind)).toEqual(expect.arrayContaining([
      'crm-cleanup',
      'failed-social-recovery',
      'marketing-review',
    ]))
    expect(queue.queue.every((item) => item.blockedUntilApproval.join(' ').includes('without CEO approval') || item.blockedUntilApproval.join(' ').includes('No send'))).toBe(true)
    expect(queue.analysisPrompt).toContain('dynamic Messages window')
  })
})
