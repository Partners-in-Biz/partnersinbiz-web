import {
  scoreAgentEvolutionCandidate,
  scoreBusinessInsightCandidate,
  shouldCreateAgentEvolutionFinding,
  shouldCreateBusinessInsightFinding,
  shouldSuppressBusinessInsight,
  type BusinessInsightKind,
} from './scoring'

type SourceWindow = {
  from: string
  to: string
}

type SourceLink = {
  type: string
  id?: string
  href?: string
  label: string
}

type EvidenceItem = {
  label: string
  value?: string | number
  href?: string
}

export type AgentEvolutionSignal = {
  id: string
  category: 'stale-instruction' | 'missing-context' | 'repeat-blocker' | 'review-rework' | 'weak-output' | 'unsafe-request' | 'tooling-gap'
  targetSurface: string
  title: string
  summary: string
  severity: number
  confidence: number
  easeOfFix: number
  risk: number
  source: SourceLink
  occurredAt?: string
}

export type BusinessInsightSignal = {
  id: string
  lane: 'crm' | 'seo' | 'ads' | 'social' | 'support' | 'invoice' | 'project' | 'agent-output' | 'data-quality'
  insightKind: BusinessInsightKind
  summary: string
  impactEstimate: string
  metric?: string
  value?: number
  impact: number
  urgency: number
  confidence: number
  actionability: number
  risk: number
  ownerAgentId?: string
  ownerRole?: string
  nextAction: string
  suppressionKey: string
  sourceLinks: SourceLink[]
  evidence: EvidenceItem[]
  blocksActiveCommercialLoop?: boolean
  hasNewSourceItem?: boolean
  hasMetricDelta?: boolean
  hasReviewerStatusChange?: boolean
}

export type ConservativeReviewTaskDraft = {
  loopId: 'agent-evolution-review' | 'business-insight-review'
  idempotencyKey: string
  orgId: string
  projectId: string | null
  title: string
  description: string
  columnId: 'review'
  status: 'todo'
  agentStatus: 'done'
  reviewStatus: 'pending'
  assigneeAgentId: 'pip'
  reviewerAgentId: 'qa-release' | 'nora'
  requiredCapability: 'agent-evolution-review' | 'business-insight-review'
  riskLevel: 'high'
  requiresApproval: true
  approvalStatus: 'pending'
  sideEffectPolicy: 'internal-review-only'
  metadata: Record<string, unknown>
  agentInput: {
    requiredCapability: 'agent-evolution-review' | 'business-insight-review'
    context: Record<string, unknown>
  }
}

export type ConservativeReviewEvaluatorInput = {
  orgId: string
  projectId?: string | null
  sourceWindow: SourceWindow
  agentSignals: AgentEvolutionSignal[]
  businessSignals: BusinessInsightSignal[]
  existingSuppressionKeys: string[]
}

type AgentSignalGroup = {
  key: string
  category: AgentEvolutionSignal['category']
  targetSurface: string
  signals: AgentEvolutionSignal[]
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'signal'
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function titleCaseCategory(value: string): string {
  return value.replace(/-/g, ' ')
}

function groupAgentSignals(signals: AgentEvolutionSignal[]): AgentSignalGroup[] {
  const groups = new Map<string, AgentSignalGroup>()
  for (const signal of signals) {
    const key = `${signal.category}:${signal.targetSurface}`
    const existing = groups.get(key)
    if (existing) {
      existing.signals.push(signal)
    } else {
      groups.set(key, {
        key,
        category: signal.category,
        targetSurface: signal.targetSurface,
        signals: [signal],
      })
    }
  }
  return [...groups.values()]
}

function firstSeen(signals: AgentEvolutionSignal[]): string | undefined {
  return signals.map(signal => signal.occurredAt).filter((value): value is string => Boolean(value)).sort()[0]
}

function lastSeen(signals: AgentEvolutionSignal[]): string | undefined {
  return signals.map(signal => signal.occurredAt).filter((value): value is string => Boolean(value)).sort().at(-1)
}

function buildAgentEvolutionDraft(input: ConservativeReviewEvaluatorInput, group: AgentSignalGroup): ConservativeReviewTaskDraft | null {
  const recurrenceCount = group.signals.length
  const score = scoreAgentEvolutionCandidate({
    severity: average(group.signals.map(signal => signal.severity)),
    recurrence: Math.min(100, recurrenceCount * 35),
    confidence: average(group.signals.map(signal => signal.confidence)),
    easeOfFix: average(group.signals.map(signal => signal.easeOfFix)),
    risk: average(group.signals.map(signal => signal.risk)),
    sourceLinkCount: group.signals.length,
  })

  if (!shouldCreateAgentEvolutionFinding(score)) return null

  const categoryLabel = titleCaseCategory(group.category)
  const summary = `Repeated ${group.category} pattern on ${group.targetSurface}`
  const sourceLinks = group.signals.map(signal => signal.source)
  const proposedChange = `Review ${group.targetSurface} guidance so agents receive enough context before pickup.`
  const metadata = {
    agentEvolutionReview: {
      type: 'agent-evolution-review',
      schemaVersion: 1,
      sourceWindow: input.sourceWindow,
      pattern: {
        category: group.category,
        summary,
        recurrenceCount,
        firstSeenAt: firstSeen(group.signals),
        lastSeenAt: lastSeen(group.signals),
      },
      sourceLinks,
      evidence: group.signals.map(signal => ({ label: signal.title, value: signal.summary, href: signal.source.href })),
      recommendation: {
        action: 'skill-proposal',
        summary: proposedChange,
        targetSurface: group.targetSurface,
        approvalGate: 'human-review',
      },
      score: {
        ...score.normalized,
        total: score.total,
      },
      guardrail: 'No automatic skill, wiki, prompt, runtime, production, client-visible, spend, finance, secret/config, or destructive mutation.',
      verifierAgentId: 'qa-release',
      reviewStatus: 'pending',
    },
    agentLearningReview: {
      learningReview: true,
      reviewGate: 'proposals-only',
      automationGuard: 'No automatic skill or wiki rewrites. Proposed changes must be reviewed before any durable knowledge is changed.',
      proposedSkillChanges: [proposedChange],
      learningItems: group.signals.map(signal => signal.summary),
      taskLinks: sourceLinks,
    },
  }

  return {
    loopId: 'agent-evolution-review',
    idempotencyKey: `agent-evolution-review:${input.orgId}:${slug(group.key)}:${input.sourceWindow.to}`,
    orgId: input.orgId,
    projectId: input.projectId ?? null,
    title: `Agent Evolution Review: ${categoryLabel} pattern on ${group.targetSurface}`,
    description: `${summary}. ${proposedChange}`,
    columnId: 'review',
    status: 'todo',
    agentStatus: 'done',
    reviewStatus: 'pending',
    assigneeAgentId: 'pip',
    reviewerAgentId: 'qa-release',
    requiredCapability: 'agent-evolution-review',
    riskLevel: 'high',
    requiresApproval: true,
    approvalStatus: 'pending',
    sideEffectPolicy: 'internal-review-only',
    metadata,
    agentInput: {
      requiredCapability: 'agent-evolution-review',
      context: {
        sourceWindow: input.sourceWindow,
        groupKey: group.key,
        guardrail: 'Produce internal review only. Do not mutate skills/wiki/prompts/runtime.',
      },
    },
  }
}

function buildBusinessInsightDraft(input: ConservativeReviewEvaluatorInput, signal: BusinessInsightSignal): ConservativeReviewTaskDraft | null {
  const score = scoreBusinessInsightCandidate({
    impact: signal.impact,
    urgency: signal.urgency,
    confidence: signal.confidence,
    actionability: signal.actionability,
    risk: signal.risk,
    insightKind: signal.insightKind,
    blocksActiveCommercialLoop: signal.blocksActiveCommercialLoop === true,
  })

  if (shouldSuppressBusinessInsight({
    suppressionKey: signal.suppressionKey,
    existingSuppressionKeys: input.existingSuppressionKeys,
    hasNewSourceItem: signal.hasNewSourceItem === true,
    hasMetricDelta: signal.hasMetricDelta === true,
    hasReviewerStatusChange: signal.hasReviewerStatusChange === true,
  })) {
    return null
  }

  if (!shouldCreateBusinessInsightFinding(score)) return null

  const metadata = {
    businessInsightReview: {
      type: 'business-insight-review',
      schemaVersion: 1,
      orgId: input.orgId,
      sourceWindow: input.sourceWindow,
      lane: signal.lane,
      insightKind: signal.insightKind,
      summary: signal.summary,
      businessImpact: {
        estimateLabel: signal.impactEstimate,
        metric: signal.metric,
        value: signal.value,
        confidence: score.normalized.confidence,
      },
      sourceLinks: signal.sourceLinks,
      evidence: signal.evidence,
      recommendation: {
        nextAction: signal.nextAction,
        ownerAgentId: signal.ownerAgentId,
        ownerRole: signal.ownerRole,
        createsTask: true,
        approvalGate: 'human-review',
      },
      score: {
        ...score.normalized,
        total: score.total,
      },
      suppressionKey: signal.suppressionKey,
      reviewStatus: 'pending',
    },
  }

  return {
    loopId: 'business-insight-review',
    idempotencyKey: `business-insight-review:${input.orgId}:${slug(signal.suppressionKey)}:${input.sourceWindow.to}`,
    orgId: input.orgId,
    projectId: input.projectId ?? null,
    title: `Business Insight: ${signal.summary}`,
    description: `${signal.impactEstimate}. ${signal.nextAction}`,
    columnId: 'review',
    status: 'todo',
    agentStatus: 'done',
    reviewStatus: 'pending',
    assigneeAgentId: 'pip',
    reviewerAgentId: 'nora',
    requiredCapability: 'business-insight-review',
    riskLevel: 'high',
    requiresApproval: true,
    approvalStatus: 'pending',
    sideEffectPolicy: 'internal-review-only',
    metadata,
    agentInput: {
      requiredCapability: 'business-insight-review',
      context: {
        sourceWindow: input.sourceWindow,
        suppressionKey: signal.suppressionKey,
        guardrail: 'Produce internal review only. Do not send, publish, spend, change finance, mutate config/secrets, deploy, or destructively edit data.',
      },
    },
  }
}

export function buildConservativeReviewTaskDrafts(input: ConservativeReviewEvaluatorInput): ConservativeReviewTaskDraft[] {
  const agentDrafts = groupAgentSignals(input.agentSignals)
    .flatMap((group) => {
      const draft = buildAgentEvolutionDraft(input, group)
      return draft ? [draft] : []
    })

  const businessDrafts = input.businessSignals.flatMap((signal) => {
    const draft = buildBusinessInsightDraft(input, signal)
    return draft ? [draft] : []
  })

  return [...agentDrafts, ...businessDrafts]
}
