import {
  scoreAgentEvolutionCandidate,
  scoreBusinessInsightCandidate,
  shouldCreateAgentEvolutionFinding,
  shouldCreateBusinessInsightFinding,
  shouldSuppressBusinessInsight,
} from '@/lib/loop-engine/scoring'

describe('loop engine scoring', () => {
  it('scores agent evolution findings from deterministic weighted inputs', () => {
    const score = scoreAgentEvolutionCandidate({
      severity: 80,
      recurrence: 70,
      confidence: 90,
      easeOfFix: 60,
      risk: 30,
      sourceLinkCount: 2,
    })

    expect(score.total).toBe(68)
    expect(score.normalized).toEqual({
      severity: 80,
      recurrence: 70,
      confidence: 90,
      easeOfFix: 60,
      risk: 30,
    })
    expect(shouldCreateAgentEvolutionFinding(score)).toBe(true)
  })

  it('blocks weak or under-evidenced agent evolution findings', () => {
    const weak = scoreAgentEvolutionCandidate({
      severity: 50,
      recurrence: 20,
      confidence: 50,
      easeOfFix: 80,
      risk: 40,
      sourceLinkCount: 4,
    })
    const underEvidenced = scoreAgentEvolutionCandidate({
      severity: 74,
      recurrence: 70,
      confidence: 80,
      easeOfFix: 90,
      risk: 10,
      sourceLinkCount: 1,
    })

    expect(weak.total).toBeLessThan(55)
    expect(shouldCreateAgentEvolutionFinding(weak)).toBe(false)
    expect(underEvidenced.total).toBeGreaterThanOrEqual(55)
    expect(shouldCreateAgentEvolutionFinding(underEvidenced)).toBe(false)
  })

  it('scores business insights and allows urgent high-confidence findings', () => {
    const score = scoreBusinessInsightCandidate({
      impact: 70,
      urgency: 90,
      confidence: 65,
      actionability: 40,
      risk: 50,
      insightKind: 'performance-drop',
      blocksActiveCommercialLoop: false,
    })

    expect(score.total).toBe(61)
    expect(shouldCreateBusinessInsightFinding(score)).toBe(true)
  })

  it('creates missing-data findings when active commercial loops are blocked', () => {
    const score = scoreBusinessInsightCandidate({
      impact: 30,
      urgency: 35,
      confidence: 40,
      actionability: 30,
      risk: 20,
      insightKind: 'missing-data',
      blocksActiveCommercialLoop: true,
    })

    expect(score.total).toBeLessThan(60)
    expect(shouldCreateBusinessInsightFinding(score)).toBe(true)
  })

  it('suppresses repeated weak business insights until evidence changes', () => {
    expect(shouldSuppressBusinessInsight({
      suppressionKey: 'crm:lead-no-owner:org-1',
      existingSuppressionKeys: ['crm:lead-no-owner:org-1'],
      hasNewSourceItem: false,
      hasMetricDelta: false,
      hasReviewerStatusChange: false,
    })).toBe(true)

    expect(shouldSuppressBusinessInsight({
      suppressionKey: 'crm:lead-no-owner:org-1',
      existingSuppressionKeys: ['crm:lead-no-owner:org-1'],
      hasNewSourceItem: true,
      hasMetricDelta: false,
      hasReviewerStatusChange: false,
    })).toBe(false)
  })
})
