'use client'

import type { AudienceEstimate } from '@/lib/email-marketing/audience-types'

const LABELS: Record<string, string> = {
  no_email: 'No email',
  invalid_email: 'Invalid email',
  duplicate: 'Duplicate',
  suppressed: 'Suppressed',
  topic_opt_out: 'Topic opt-out',
  frequency_cap: 'Frequency cap',
  sender_failure: 'Sender unavailable',
  policy_block: 'Policy block',
  holdout: 'Holdout',
}

export function AudienceEligibilityPanel({
  estimate,
  loading = false,
}: {
  estimate: AudienceEstimate | null
  loading?: boolean
}) {
  if (loading) {
    return <p className="text-xs text-[var(--color-pib-text-muted)]">Checking send eligibility…</p>
  }
  if (!estimate) return null

  const excluded = Math.max(0, estimate.totalCandidates - estimate.eligibleCount)
  return (
    <div className="border-t border-[var(--color-pib-line)] pt-3" aria-live="polite">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <span className="text-sm font-medium text-[var(--color-pib-text)]">
          {estimate.eligibleCount.toLocaleString()} eligible
        </span>
        <span className="text-xs text-[var(--color-pib-text-muted)]">
          {estimate.totalCandidates.toLocaleString()} candidates · {excluded.toLocaleString()} excluded
        </span>
      </div>
      {Object.keys(estimate.excludedCounts).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-pib-text-muted)]">
          {Object.entries(estimate.excludedCounts).map(([reason, count]) => (
            <span key={reason}>{LABELS[reason] ?? reason}: {count ?? 0}</span>
          ))}
        </div>
      )}
    </div>
  )
}
