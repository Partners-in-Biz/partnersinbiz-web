'use client'

interface SignificanceData {
  pValue: number
  confident: boolean
  winnerVariantId?: string
  computedAt?: unknown
}

interface Props {
  significance?: SignificanceData
}

export function ExperimentSignificanceBadge({ significance }: Props) {
  if (!significance) {
    return (
      <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-white/40">
        Awaiting data
      </span>
    )
  }

  const { pValue, confident } = significance

  if (confident && pValue <= 0.01) {
    return (
      <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-green-400">
        Significant (p&lt;0.01)
      </span>
    )
  }

  if (confident && pValue <= 0.05) {
    return (
      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">
        Significant (p&lt;0.05)
      </span>
    )
  }

  if (!confident && pValue <= 0.1) {
    return (
      <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs text-yellow-400">
        Trending (p≤0.1)
      </span>
    )
  }

  return (
    <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-white/40">
      Not significant (p={pValue.toFixed(3)})
    </span>
  )
}
