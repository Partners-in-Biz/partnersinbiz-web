import type { BriefingCard } from '@/lib/briefing/types'
import type { CrmPipelineDiagnostics } from '@/lib/crm/pipeline-diagnostics'
import type { SocialContentReadiness } from '@/lib/social/content-readiness'
import type { SocialFailedPostDiagnostics } from '@/lib/social/failed-post-diagnostics'

export type GrowthQueueItemKind =
  | 'ceo-approval'
  | 'crm-cleanup'
  | 'marketing-review'
  | 'failed-social-recovery'
  | 'agent-review'

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
  sourceReports: {
    crmPipelineDiagnostics: Pick<CrmPipelineDiagnostics, 'generatedAt' | 'summary' | 'dataQuality' | 'primaryFinding' | 'nextActions'>
    socialContentReadiness: Pick<SocialContentReadiness, 'generatedAt' | 'summary' | 'primaryFinding' | 'nextActions'>
    failedPostDiagnostics: Pick<SocialFailedPostDiagnostics, 'generatedAt' | 'summary' | 'primaryFinding' | 'nextActions'>
    briefingFeed: {
      generatedAt: string
      total: number
      approvalLikeItems: number
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

function briefingQueueItems(items: BriefingCard[]): GrowthCommandQueueItem[] {
  return items
    .filter(briefingLooksApprovalLike)
    .slice(0, 10)
    .map((item) => ({
      id: `briefing:${item.id}`,
      kind: item.source.type === 'agent-run' || item.source.type === 'agent-output' ? 'agent-review' : 'ceo-approval',
      priority: item.priority === 'critical' ? 'critical' : item.priority === 'needs-peet' ? 'needs-peet' : 'review',
      title: item.title,
      summary: summarizeBriefing(item),
      source: {
        type: item.source.type,
        id: item.source.id,
        url: item.source.url ?? null,
      },
      recommendedAgent: item.context.reviewerAgentId ?? 'pip',
      approvalRequired: true,
      allowedNow: [
        'Analyze the stored source data.',
        'Return a CEO-readable recommendation in Messages.',
        'Create or update internal-only follow-up tasks if needed.',
      ],
      blockedUntilApproval: [
        'No send, publish, schedule, retry, reconnect, spend, deploy, billing, destructive, or client-visible action.',
      ],
    }))
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
  return [{
    id: `social:${social.primaryFinding.code}`,
    kind: 'marketing-review',
    priority: social.summary.failedPosts > 0 || social.summary.draftPosts > 0 || social.summary.reviewPosts > 0 ? 'needs-peet' : 'review',
    title: social.primaryFinding.title,
    summary: social.primaryFinding.detail,
    source: {
      type: 'social-content-readiness',
      id: social.primaryFinding.code,
      url: '/api/v1/social/reports/content-readiness',
    },
    recommendedAgent: 'maya',
    approvalRequired: social.summary.draftPosts > 0 || social.summary.reviewPosts > 0 || social.summary.readyToSchedulePosts > 0,
    allowedNow: [
      'Review stored Marketing Studio posts and media.',
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
  const briefingApprovalItems = input.briefing.items.filter(briefingLooksApprovalLike)
  const queue = [
    ...briefingQueueItems(input.briefing.items),
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
      },
    },
    queue,
    analysisPrompt: [
      'Use the queue above as the daily CEO growth command input.',
      'Before proposing action, confirm which source data is present and which data is missing.',
      'Answer in the dynamic Messages window. Use temporary throw-away HTML only when a specific question needs visual comparison.',
      'Keep all external actions gated until the CEO approves the exact item.',
    ].join(' '),
  }
}
