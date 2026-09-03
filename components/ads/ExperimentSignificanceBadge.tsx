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
      <span className="pib-pill pib-pill-rose">
        Awaiting data
      </span>
    )
  }

  const { pValue, confident } = significance

  if (confident && pValue <= 0.01) {
    return (
      <span className="rounded-md bg-green-500/15 px-2 py-0.5 text-xs text-green-400">
        Significant (p&lt;0.01)
      </span>
    )
  }

  if (confident && pValue <= 0.05) {
    return (
      <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">
        Significant (p&lt;0.05)
      </span>
    )
  }

  if (!confident && pValue <= 0.1) {
    return (
      <span className="rounded-md bg-yellow-500/15 px-2 py-0.5 text-xs text-yellow-400">
        Trending (p≤0.1)
      </span>
    )
  }

  return (
    <span className="pib-pill pib-pill-rose">
      Not significant (p={pValue.toFixed(3)})
    </span>
  )
}
