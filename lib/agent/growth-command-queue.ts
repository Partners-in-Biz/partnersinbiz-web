import type { BriefingCard } from '@/lib/briefing/types'
import type { CrmPipelineDiagnostics } from '@/lib/crm/pipeline-diagnostics'
import type { SocialContentReadiness } from '@/lib/social/content-readiness'
import type { SocialFailedPostDiagnostics } from '@/lib/social/failed-post-diagnostics'
import { buildCeoDataDecisionOperatingRule } from '@/lib/agent/ceo-operating-rule'

export type GrowthQueueItemKind =
  | 'ceo-approval'
  | 'crm-cleanup'
  | 'marketing-review'
  | 'failed-social-recovery'
  | 'agent-review'
  | 'ops-cleanup'

export interface GrowthCommandQueueItem {
  id: string
  kind: GrowthQueueItemKind
  priority: 'critical' | 'needs-peet' | 'review' | 'progress'
  title: string
  summary: string
  source: {
    type: string
    id: string
    url?: string | null
  }
  recommendedAgent: string
  approvalRequired: boolean
  allowedNow: string[]
  blockedUntilApproval: string[]
}

export interface AgentGrowthCommandQueue {
  generatedAt: string
  orgId: string
  operatingRule: {
    dashboardPolicy: string
    nextStepForAgents: string
    chatOutputContract: string
  }
  dataAvailability: {
    availableSources: string[]
    missingSources: string[]
    requiredGatherSkills: string[]
    safeNextStep: string
  }
  sourceReports: {
    crmPipelineDiagnostics: Pick<CrmPipelineDiagnostics, 'generatedAt' | 'summary' | 'dataQuality' | 'primaryFinding' | 'nextActions'>
    socialContentReadiness: Pick<SocialContentReadiness, 'generatedAt' | 'summary' | 'platformBlockers' | 'primaryFinding' | 'nextActions'>
    failedPostDiagnostics: Pick<SocialFailedPostDiagnostics, 'generatedAt' | 'summary' | 'primaryFinding' | 'nextActions'>
    briefingFeed: {
      generatedAt: string
      total: number
      approvalLikeItems: number
      recoveredAgentRuns: {
        count: number
        ids: string[]
      }
    }
  }
  queue: GrowthCommandQueueItem[]
  analysisPrompt: string
}

export interface BuildAgentGrowthCommandQueueInput {
  orgId: string
  crm: CrmPipelineDiagnostics
  social: SocialContentReadiness
  failedSocial: SocialFailedPostDiagnostics
  briefing: {
    generatedAt: string
    total: number
    items: BriefingCard[]
  }
  recoveredAgentRunIds?: string[]
  generatedAt?: string
}

function briefingLooksApprovalLike(item: BriefingCard): boolean {
  if (item.priority === 'needs-peet' || item.priority === 'critical') return true
  if (item.source.type === 'approval' || item.source.type === 'agent-run') return true
  const text = `${item.title} ${item.summary} ${item.excerpt ?? ''}`.toLowerCase()
  return /(approval|required|approve|decision|waiting_for_approval|needs peet)/.test(text)
}

function summarizeBriefing(item: BriefingCard): string {
  return item.summary || item.excerpt || `${item.source.type} needs review.`
}

function dateFromUnknown(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date && Number.isFinite(value.getTime())) return value
  if (typeof value === 'number') {
    const date = new Date(value > 10_000_000_000 ? value : value * 1000)
    return Number.isFinite(date.getTime()) ? date : null
  }
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date : null
  }
  if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate()
    return date instanceof Date && Number.isFinite(date.getTime()) ? date : null
  }
  return null
}

function bookingDateFromText(value: string): Date | null {
  const match = value.match(/\bon\s+(\d{4}-\d{2}-\d{2})(?:\s+at\s+(\d{1,2}:\d{2}))?/i)
  if (!match) return null
  const datePart = match[1]
  const timePart = match[2] ?? '00:00'
  const date = new Date(`${datePart}T${timePart}:00+02:00`)
  return Number.isFinite(date.getTime()) ? date : null
}

function isPastMissingMeetBooking(item: BriefingCard, generatedAt: string): boolean {
  if (item.source.type !== 'booking') return false
  const text = `${item.title} ${item.summary} ${item.excerpt ?? ''}`
  if (!/meet link missing|missing meet link/i.test(text)) return false
  const bookingDate = bookingDateFromText(text) ?? dateFromUnknown(item.occurredAt)
  const referenceDate = dateFromUnknown(generatedAt)
  if (!bookingDate || !referenceDate) return false
  return bookingDate.getTime() < referenceDate.getTime()
}

function isRecoveredAgentRun(item: BriefingCard, recoveredAgentRunIds: Set<string>): boolean {
  return item.source.type === 'agent-run' && recoveredAgentRunIds.has(item.source.id)
}

function briefingQueueItem(item: BriefingCard, generatedAt: string, recoveredAgentRunIds: Set<string>): GrowthCommandQueueItem {
  const staleBooking = isPastMissingMeetBooking(item, generatedAt)
  const recoveredAgentRun = isRecoveredAgentRun(item, recoveredAgentRunIds)
  const isAgentReview = item.source.type === 'agent-run' || item.source.type === 'agent-output'
  return {
    id: `briefing:${item.id}`,
    kind: staleBooking || recoveredAgentRun ? 'ops-cleanup' : isAgentReview ? 'agent-review' : 'ceo-approval',
    priority: staleBooking || recoveredAgentRun ? 'review' : item.priority === 'critical' ? 'critical' : item.priority === 'needs-peet' ? 'needs-peet' : 'review',
    title: item.title,
    summary: recoveredAgentRun
      ? `${summarizeBriefing(item)} Later same-conversation assistant output indicates this failed run was already recovered, so treat it as queue cleanup instead of a critical retry.`
      : staleBooking
      ? `${summarizeBriefing(item)} This booking is already in the past, so treat it as cleanup/follow-up review instead of a critical live Meet-link approval.`
      : summarizeBriefing(item),
    source: {
      type: item.source.type,
      id: item.source.id,
      url: item.source.url ?? null,
    },
    recommendedAgent: staleBooking ? 'nora' : recoveredAgentRun ? 'pip' : item.context.reviewerAgentId ?? 'pip',
    approvalRequired: !staleBooking && !recoveredAgentRun,
    allowedNow: recoveredAgentRun
      ? [
          'Analyze the stored Hermes run and related conversation evidence.',
          'Return a CEO-readable cleanup recommendation in Messages.',
          'Create an internal-only product follow-up if stale failed-run cards keep recurring.',
        ]
      : staleBooking
      ? [
          'Analyze the stored booking and briefing data.',
          'Recommend whether to mark handled, create a follow-up task, or repair the briefing rule.',
          'Return a CEO-readable cleanup recommendation in Messages.',
        ]
      : [
          'Analyze the stored source data.',
          'Return a CEO-readable recommendation in Messages.',
          'Create or update internal-only follow-up tasks if needed.',
        ],
    blockedUntilApproval: recoveredAgentRun
      ? [
          'Do not retry, requeue, stop, approve, or mutate Hermes runs without CEO approval.',
        ]
      : staleBooking
      ? [
          'Do not create calendar events, Meet links, customer emails, or external notifications without CEO approval.',
        ]
      : [
          'No send, publish, schedule, retry, reconnect, spend, deploy, billing, destructive, or client-visible action.',
        ],
  }
}

function briefingQueueItems(items: BriefingCard[], generatedAt: string, recoveredAgentRunIds: Set<string>): GrowthCommandQueueItem[] {
  return items
    .filter((item) => briefingLooksApprovalLike(item) || isPastMissingMeetBooking(item, generatedAt))
    .map((item) => briefingQueueItem(item, generatedAt, recoveredAgentRunIds))
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.title.localeCompare(b.title))
    .slice(0, 10)
}

function crmQueueItems(crm: CrmPipelineDiagnostics): GrowthCommandQueueItem[] {
  if (crm.primaryFinding.code === 'pipeline_ready') return []
  return [{
    id: `crm:${crm.primaryFinding.code}`,
    kind: 'crm-cleanup',
    priority: crm.dataQuality.openDealsMissingValue > 0 || crm.dataQuality.openDealsMissingExpectedCloseDate > 0 ? 'needs-peet' : 'review',
    title: crm.primaryFinding.title,
    summary: crm.primaryFinding.detail,
    source: {
      type: 'crm-pipeline-diagnostics',
      id: crm.primaryFinding.code,
      url: '/api/v1/crm/reports/pipeline-diagnostics',
    },
    recommendedAgent: 'blake',
    approvalRequired: crm.dataQuality.openDealsMissingValue > 0,
    allowedNow: [
      'Analyze deal records, stages, owner gaps, values, and expected close dates.',
      'Draft exact CEO questions and follow-up copy in Messages.',
    ],
    blockedUntilApproval: [
      'Do not edit deal values, send proposal follow-ups, create quotes, or contact prospects without CEO approval.',
    ],
  }]
}

function socialQueueItems(social: SocialContentReadiness): GrowthCommandQueueItem[] {
  if (social.primaryFinding.code === 'content_ready') return []
  const accountBlockerSummary = social.platformBlockers.length > 0
    ? ` ${social.summary.readyPostsBlockedByMissingActiveAccount} approved/vaulted post${social.summary.readyPostsBlockedByMissingActiveAccount === 1 ? '' : 's'} are parked by missing active accounts: ${social.platformBlockers.map((blocker) => `${blocker.platform} (${blocker.affectedReadyPosts})`).join(', ')}.`
    : ''
  return [{
    id: `social:${social.primaryFinding.code}`,
    kind: 'marketing-review',
    priority: social.summary.failedPosts > 0 || social.summary.draftPosts > 0 || social.summary.reviewPosts > 0 ? 'needs-peet' : 'review',
    title: social.primaryFinding.title,
    summary: `${social.primaryFinding.detail}${accountBlockerSummary}`,
    source: {
      type: 'social-content-readiness',
      id: social.primaryFinding.code,
      url: '/api/v1/social/reports/content-readiness',
    },
    recommendedAgent: 'maya',
    approvalRequired: social.summary.draftPosts > 0 || social.summary.reviewPosts > 0 || social.summary.readyToSchedulePosts > 0 || social.summary.readyPostsBlockedByMissingActiveAccount > 0,
    allowedNow: [
      'Review stored Marketing Studio posts and media.',
      'Identify approved content parked by missing active platform accounts.',
      'Return a recommended approval, rewrite, or scheduling plan in Messages.',
    ],
    blockedUntilApproval: [
      'Do not submit, approve, schedule, publish, retry, or reconnect social accounts without CEO approval.',
    ],
  }]
}

function failedSocialQueueItems(failedSocial: SocialFailedPostDiagnostics): GrowthCommandQueueItem[] {
  if (failedSocial.summary.failedPosts === 0) return []
  return [{
    id: `failed-social:${failedSocial.primaryFinding.code}`,
    kind: 'failed-social-recovery',
    priority: failedSocial.summary.blockedFailures > 0 ? 'needs-peet' : 'review',
    title: failedSocial.primaryFinding.title,
    summary: failedSocial.primaryFinding.detail,
    source: {
      type: 'failed-post-diagnostics',
      id: failedSocial.primaryFinding.code,
      url: '/api/v1/social/reports/failed-post-diagnostics',
    },
    recommendedAgent: failedSocial.summary.mediaCredentialFailures > 0 ? 'theo' : 'maya',
    approvalRequired: true,
    allowedNow: [
      'Classify failures and split hold, repair, and retry candidates.',
      'Return a controlled recovery plan in Messages.',
    ],
    blockedUntilApproval: [
      'Do not retry failed posts, reconnect accounts, change credentials, or publish recovery content without CEO approval.',
    ],
  }]
}

function priorityRank(priority: GrowthCommandQueueItem['priority']): number {
  switch (priority) {
    case 'critical': return 0
    case 'needs-peet': return 1
    case 'review': return 2
    case 'progress': return 3
  }
}

export function buildAgentGrowthCommandQueue(input: BuildAgentGrowthCommandQueueInput): AgentGrowthCommandQueue {
  const generatedAt = input.generatedAt ?? new Date().toISOString()
  const recoveredAgentRunIds = new Set(input.recoveredAgentRunIds ?? [])
  const briefingApprovalItems = input.briefing.items.filter((item) =>
    briefingLooksApprovalLike(item)
    && !isPastMissingMeetBooking(item, generatedAt)
    && !isRecoveredAgentRun(item, recoveredAgentRunIds)
  )
  const queue = [
    ...briefingQueueItems(input.briefing.items, generatedAt, recoveredAgentRunIds),
    ...crmQueueItems(input.crm),
    ...socialQueueItems(input.social),
    ...failedSocialQueueItems(input.failedSocial),
  ].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.title.localeCompare(b.title))

  return {
    generatedAt,
    orgId: input.orgId,
    operatingRule: {
      dashboardPolicy: 'Do not create or maintain a permanent dashboard by default.',
      nextStepForAgents: 'Use this stored-data gatherer first, then analyze the specific question and answer inside Messages.',
      chatOutputContract: 'For CEO decisions, return a structured approval_card rich part with evidence, recommendation, decision fields, copyable reply, and safety note.',
    },
    dataAvailability: {
      availableSources: [
        'crmPipelineDiagnostics',
        'socialContentReadiness',
        'failedPostDiagnostics',
        'briefingFeed',
      ],
      missingSources: [],
      requiredGatherSkills: [
        'ceo-on-demand-gather',
        'crm-hygiene-gather',
        'social-recovery-gather',
        'approval-queue-gather',
        'agent-runtime-gather',
      ],
      safeNextStep: 'If a required fact is missing, request or create the reusable gather skill/workflow first, then rerun the analysis from stored data before recommending action.',
    },
    sourceReports: {
      crmPipelineDiagnostics: {
        generatedAt: input.crm.generatedAt,
        summary: input.crm.summary,
        dataQuality: input.crm.dataQuality,
        primaryFinding: input.crm.primaryFinding,
        nextActions: input.crm.nextActions,
      },
      socialContentReadiness: {
        generatedAt: input.social.generatedAt,
        summary: input.social.summary,
        platformBlockers: input.social.platformBlockers,
        primaryFinding: input.social.primaryFinding,
        nextActions: input.social.nextActions,
      },
      failedPostDiagnostics: {
        generatedAt: input.failedSocial.generatedAt,
        summary: input.failedSocial.summary,
        primaryFinding: input.failedSocial.primaryFinding,
        nextActions: input.failedSocial.nextActions,
      },
      briefingFeed: {
        generatedAt: input.briefing.generatedAt,
        total: input.briefing.total,
        approvalLikeItems: briefingApprovalItems.length,
        recoveredAgentRuns: {
          count: recoveredAgentRunIds.size,
          ids: Array.from(recoveredAgentRunIds).sort(),
        },
      },
    },
    queue,
    analysisPrompt: [
      'Use the queue above as the daily CEO growth command input.',
      'Before proposing action, confirm which source data is present and which data is missing.',
      'If the data is missing, request or create the gather skill first; do not infer or fabricate the answer.',
      'Answer in the dynamic Messages window. Temporary throw-away HTML is allowed only for a named one-off question where visual comparison materially improves the answer.',
      'Keep all external actions gated until the CEO approves the exact item.',
      buildCeoDataDecisionOperatingRule({ orgId: input.orgId }),
    ].join(' '),
  }
}
