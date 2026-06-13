export type AgentEvolutionScoreInput = {
  severity: number
  recurrence: number
  confidence: number
  easeOfFix: number
  risk: number
  sourceLinkCount: number
}

export type AgentEvolutionScore = {
  total: number
  normalized: {
    severity: number
    recurrence: number
    confidence: number
    easeOfFix: number
    risk: number
  }
  sourceLinkCount: number
}

export type BusinessInsightKind =
  | 'opportunity'
  | 'risk'
  | 'missing-data'
  | 'stale-work'
  | 'performance-drop'
  | 'follow-up-gap'

export type BusinessInsightScoreInput = {
  impact: number
  urgency: number
  confidence: number
  actionability: number
  risk: number
  insightKind: BusinessInsightKind
  blocksActiveCommercialLoop: boolean
}

export type BusinessInsightScore = {
  total: number
  normalized: {
    impact: number
    urgency: number
    confidence: number
    actionability: number
    risk: number
  }
  insightKind: BusinessInsightKind
  blocksActiveCommercialLoop: boolean
}

export type BusinessInsightSuppressionInput = {
  suppressionKey: string
  existingSuppressionKeys: string[]
  hasNewSourceItem: boolean
  hasMetricDelta: boolean
  hasReviewerStatusChange: boolean
}

function normalizeScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

export function scoreAgentEvolutionCandidate(input: AgentEvolutionScoreInput): AgentEvolutionScore {
  const normalized = {
    severity: normalizeScore(input.severity),
    recurrence: normalizeScore(input.recurrence),
    confidence: normalizeScore(input.confidence),
    easeOfFix: normalizeScore(input.easeOfFix),
    risk: normalizeScore(input.risk),
  }

  const total = Math.round(
    (normalized.severity * 0.30)
    + (normalized.recurrence * 0.30)
    + (normalized.confidence * 0.20)
    + (normalized.easeOfFix * 0.15)
    - (normalized.risk * 0.15),
  )

  return {
    total,
    normalized,
    sourceLinkCount: Math.max(0, Math.floor(input.sourceLinkCount)),
  }
}

export function shouldCreateAgentEvolutionFinding(score: AgentEvolutionScore): boolean {
  if (score.total < 55) return false
  if (score.normalized.recurrence < 2 && score.normalized.severity < 75) return false
  if (score.normalized.severity < 75 && score.sourceLinkCount < 2) return false
  return true
}

export function scoreBusinessInsightCandidate(input: BusinessInsightScoreInput): BusinessInsightScore {
  const normalized = {
    impact: normalizeScore(input.impact),
    urgency: normalizeScore(input.urgency),
    confidence: normalizeScore(input.confidence),
    actionability: normalizeScore(input.actionability),
    risk: normalizeScore(input.risk),
  }

  const total = Math.round(
    (normalized.impact * 0.35)
    + (normalized.urgency * 0.25)
    + (normalized.confidence * 0.20)
    + (normalized.actionability * 0.15)
    - (normalized.risk * 0.10),
  )

  return {
    total,
    normalized,
    insightKind: input.insightKind,
    blocksActiveCommercialLoop: input.blocksActiveCommercialLoop,
  }
}

export function shouldCreateBusinessInsightFinding(score: BusinessInsightScore): boolean {
  if (score.total >= 60) return true
  if (score.normalized.urgency >= 85 && score.normalized.confidence >= 60) return true
  return score.insightKind === 'missing-data' && score.blocksActiveCommercialLoop
}

export function shouldSuppressBusinessInsight(input: BusinessInsightSuppressionInput): boolean {
  if (!input.existingSuppressionKeys.includes(input.suppressionKey)) return false
  return !input.hasNewSourceItem && !input.hasMetricDelta && !input.hasReviewerStatusChange
}
