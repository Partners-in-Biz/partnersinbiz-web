import { buildContract } from '../../../lib/design-finish-gate/contract'
import {
  parseReviewerOutput,
  aggregateVerdict,
  buildReport,
  extractJsonObject,
  scoreFor,
} from '../../../lib/design-finish-gate/reviewer'
import type { ReviewContract, ReviewerOutput } from '../../../lib/design-finish-gate/types'

function contract(over: Partial<ReviewContract> = {}): ReviewContract {
  return buildContract({
    title: 'Landing redesign',
    brief: [
      '- Add a hero section with the brand palette',
      '- Ensure WCAG AA contrast on body text',
      '- Ship the mobile nav drawer',
    ].join('\n'),
    builderAgentId: 'theo',
    round: 1,
    maxFixRounds: 2,
    ...over,
  })
}

const SHIP_REVIEW: ReviewerOutput = {
  verdict: 'ship',
  promiseScores: {
    p1: { score: 'resolved', note: 'hero matches palette in screenshot' },
    p2: { score: 'resolved', note: 'AA contrast verified' },
    p3: { score: 'resolved', note: 'drawer renders' },
  },
  strengths: ['clean layout'],
  concerns: [],
  fixRequests: [],
  reviewerAgentId: 'qa-release',
  evidence: 'inspected hero.png + body.png + drawer.png against the brief contract',
}

describe('finish-gate reviewer', () => {
  it('extracts a balanced JSON object from prose', () => {
    const text = 'Here is my review:\n```json\n{"verdict": "ship", "promiseScores": {"p1": {"score": "resolved"}}}\n```\nDone.'
    const obj = extractJsonObject(text) as { verdict: string }
    expect(obj?.verdict).toBe('ship')
  })

  it('parses a valid reviewer output and rejects self-grading', () => {
    const parsed = parseReviewerOutput(JSON.stringify(SHIP_REVIEW), { builderAgentId: 'theo' })
    expect(parsed.verdict).toBe('ship')
    expect(parsed.promiseScores.p1.score).toBe('resolved')
    expect(() => parseReviewerOutput(JSON.stringify({ ...SHIP_REVIEW, reviewerAgentId: 'theo' }), { builderAgentId: 'theo' })).toThrow(/self-grade rejected/)
  })

  it('rejects invalid verdicts and scores', () => {
    expect(() => parseReviewerOutput(JSON.stringify({ ...SHIP_REVIEW, verdict: 'maybe' }))).toThrow(/invalid verdict/)
    expect(() =>
      parseReviewerOutput(JSON.stringify({ ...SHIP_REVIEW, promiseScores: { p1: { score: 'almost' } } })),
    ).toThrow(/invalid score for p1/)
  })

  it('requires reviewerAgentId and promiseScores', () => {
    const { reviewerAgentId: _drop, ...noId } = SHIP_REVIEW
    expect(() => parseReviewerOutput(JSON.stringify(noId))).toThrow(/missing reviewerAgentId/)
    const { promiseScores: _drop2, ...noScores } = SHIP_REVIEW
    expect(() => parseReviewerOutput(JSON.stringify(noScores))).toThrow(/missing promiseScores/)
  })

  it('aggregates to ship when all resolved', () => {
    const { verdict, summary } = aggregateVerdict(SHIP_REVIEW, ['p1', 'p2', 'p3'])
    expect(verdict).toBe('ship')
    expect(summary).toEqual({ resolved: 3, partial: 0, unresolved: 0, total: 3 })
  })

  it('aggregates to fix on partials and rebuild on any unresolved', () => {
    const fixReview: ReviewerOutput = {
      ...SHIP_REVIEW,
      verdict: 'fix',
      promiseScores: { p1: { score: 'resolved' }, p2: { score: 'partial', note: 'contrast close but not AA' }, p3: { score: 'resolved' } },
    }
    expect(aggregateVerdict(fixReview, ['p1', 'p2', 'p3']).verdict).toBe('fix')
    const rebuildReview: ReviewerOutput = {
      ...SHIP_REVIEW,
      verdict: 'rebuild',
      promiseScores: { p1: { score: 'resolved' }, p2: { score: 'unresolved' }, p3: { score: 'resolved' } },
    }
    expect(aggregateVerdict(rebuildReview, ['p1', 'p2', 'p3']).verdict).toBe('rebuild')
  })

  it('missing promise score counts as unresolved (fail-closed)', () => {
    const partial: ReviewerOutput = { ...SHIP_REVIEW, verdict: 'fix', promiseScores: { p1: { score: 'resolved' } } }
    expect(aggregateVerdict(partial, ['p1', 'p2', 'p3']).verdict).toBe('rebuild')
  })

  it('buildReport: ship exit 0', () => {
    const report = buildReport({ contract: contract(), reviewer: SHIP_REVIEW })
    expect(report.exitCode).toBe(0)
    expect(report.verdict).toBe('ship')
    expect(report.roundsRemaining).toBe(0)
    expect(report.summary.total).toBe(3)
  })

  it('buildReport: fix exit 2 with rounds remaining', () => {
    const fixReview: ReviewerOutput = {
      ...SHIP_REVIEW,
      verdict: 'fix',
      promiseScores: { p1: { score: 'resolved' }, p2: { score: 'partial' }, p3: { score: 'resolved' } },
    }
    const report = buildReport({ contract: contract(), reviewer: fixReview })
    expect(report.exitCode).toBe(2)
    expect(report.verdict).toBe('fix')
    expect(report.roundsRemaining).toBe(1) // max 2, round 1 -> 1 left
  })

  it('buildReport: fix on round 3 escalates to rebuild exit 3', () => {
    const fixReview: ReviewerOutput = {
      ...SHIP_REVIEW,
      verdict: 'fix',
      promiseScores: { p1: { score: 'resolved' }, p2: { score: 'partial' }, p3: { score: 'resolved' } },
    }
    const report = buildReport({ contract: contract({ round: 3 }), reviewer: fixReview, round: 3 })
    expect(report.exitCode).toBe(3)
    expect(report.verdict).toBe('rebuild')
    expect(report.roundsRemaining).toBe(0)
  })

  it('buildReport: rebuild exit 3', () => {
    const rebuildReview: ReviewerOutput = {
      ...SHIP_REVIEW,
      verdict: 'rebuild',
      promiseScores: { p1: { score: 'resolved' }, p2: { score: 'unresolved' }, p3: { score: 'resolved' } },
    }
    const report = buildReport({ contract: contract(), reviewer: rebuildReview })
    expect(report.exitCode).toBe(3)
    expect(report.verdict).toBe('rebuild')
  })

  it('scoreFor falls back to unresolved for unknown promise ids', () => {
    expect(scoreFor(SHIP_REVIEW, 'p99')).toBe('unresolved')
  })

  it('evidence fail-closed: ship with zero evidence escalates to exit 1', () => {
    // No screenshots, no vision transcripts, no reviewer evidence citation.
    const noEvidence = { ...SHIP_REVIEW, evidence: undefined }
    const report = buildReport({ contract: contract(), reviewer: noEvidence })
    expect(report.exitCode).toBe(1)
    expect(report.verdict).toBe('rebuild')
  })

  it('evidence fail-closed: reviewer citation counts as evidence for code reviews', () => {
    const bare = { ...SHIP_REVIEW, evidence: undefined } // no screenshots, no transcripts, no citation
    const report = buildReport({ contract: contract(), reviewer: bare })
    expect(report.exitCode).toBe(1)
    const withCitation = { ...SHIP_REVIEW, evidence: 'inspected lib/design-finish-gate/*.ts at 5d0885db8' }
    const report2 = buildReport({ contract: contract(), reviewer: withCitation })
    expect(report2.exitCode).toBe(0)
    expect(report2.verdict).toBe('ship')
  })

  it('requireEvidence:false opts out for explicit tooling-only reviews', () => {
    const report = buildReport({ contract: contract(), reviewer: SHIP_REVIEW, requireEvidence: false })
    expect(report.exitCode).toBe(0)
    expect(report.verdict).toBe('ship')
  })
})
