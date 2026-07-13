import type { CaptureSourceBlockStats } from '@/lib/lead-capture/types'

type FunnelSubmission = {
  confirmedAt?: unknown
  completedSteps?: boolean
  qualifiedAt?: unknown
  opportunityId?: unknown
  revenueAmount?: unknown
}

export function buildCaptureFunnel(
  submissions: FunnelSubmission[],
  blocked: CaptureSourceBlockStats,
) {
  return {
    // No view/start event ledger exists yet. Null is deliberate: zero would be
    // a fabricated conversion rate and would mislead operators.
    views: null,
    starts: null,
    submissions: submissions.length,
    completed: submissions.filter((submission) => submission.completedSteps !== false).length,
    confirmed: submissions.filter((submission) => Boolean(submission.confirmedAt)).length,
    qualified: submissions.filter((submission) => Boolean(submission.qualifiedAt)).length,
    opportunities: submissions.filter((submission) => (
      typeof submission.opportunityId === 'string' && submission.opportunityId.trim().length > 0
    )).length,
    revenue: submissions.reduce((sum, submission) => (
      sum + (typeof submission.revenueAmount === 'number' && Number.isFinite(submission.revenueAmount)
        ? submission.revenueAmount
        : 0)
    ), 0),
    blocked: blocked.honeypot + blocked.rateLimit + blocked.disposable + blocked.captcha,
    unavailableMetrics: ['views', 'starts'],
  }
}
