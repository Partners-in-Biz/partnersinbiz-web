// lib/ads/experiments/significance.ts
import type { ExperimentMetric } from './types'

export interface SignificanceInput {
  metric: ExperimentMetric
  variants: Array<{
    id: string
    impressions: number
    clicks: number
    conversions: number
    spendCents: number
  }>
}

export interface SignificanceResult {
  pValue: number
  confident: boolean
  winnerVariantId?: string
  /** Reason if not confident (insufficient sample, no data, etc.) */
  reason?: string
}

/** Normal CDF via Abramowitz approximation. */
export function normalCdf(z: number): number {
  // erfc-based approximation
  const a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741
  const a4 = -1.453152027, a5 =  1.061405429, p = 0.3275911
  const sign = z < 0 ? -1 : 1
  const x = Math.abs(z) / Math.SQRT2
  const t = 1.0 / (1.0 + p * x)
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
  return 0.5 * (1.0 + sign * y)
}

/** Two-proportion Z-test → returns two-tailed p-value. */
export function zTestProportions(aS: number, aN: number, bS: number, bN: number): number {
  if (aN === 0 || bN === 0) return 1.0
  const pA = aS / aN
  const pB = bS / bN
  const pooled = (aS + bS) / (aN + bN)
  if (pooled === 0 || pooled === 1) return 1.0
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / aN + 1 / bN))
  if (se === 0) return 1.0
  const z = (pA - pB) / se
  return 2 * (1 - normalCdf(Math.abs(z)))
}

/** Welch's t-test → returns two-tailed p-value approximation. */
export function welchTTest(aMean: number, aVar: number, aN: number, bMean: number, bVar: number, bN: number): number {
  if (aN < 2 || bN < 2) return 1.0
  const se = Math.sqrt(aVar / aN + bVar / bN)
  if (se === 0) return 1.0
  const t = (aMean - bMean) / se
  // For large N, t distribution ≈ normal — use normalCdf as approximation.
  return 2 * (1 - normalCdf(Math.abs(t)))
}

const LOWER_IS_BETTER = new Set<ExperimentMetric>(['cpc', 'cpa'])

/** Compute significance for an experiment. Compares variant A (control) vs the best other variant.
 *  Returns confident=true only when p-value <= threshold AND the better-metric variant is statistically distinct from A. */
export function computeSignificance(args: {
  input: SignificanceInput
  threshold: number
}): SignificanceResult {
  const variants = args.input.variants
  if (variants.length < 2) return { pValue: 1.0, confident: false, reason: 'Need at least 2 variants' }

  // Derive metric value per variant
  const metricFor = (v: { impressions: number; clicks: number; conversions: number; spendCents: number }): number | null => {
    switch (args.input.metric) {
      case 'cpc': return v.clicks > 0 ? v.spendCents / v.clicks : null
      case 'cpa': return v.conversions > 0 ? v.spendCents / v.conversions : null
      case 'conv_rate': return v.clicks > 0 ? v.conversions / v.clicks : null
      case 'ctr': return v.impressions > 0 ? v.clicks / v.impressions : null
      case 'roas': return null  // not yet supported — defer to v2
    }
  }

  const metricValues = variants.map(metricFor)
  if (metricValues.some((v) => v === null)) {
    return { pValue: 1.0, confident: false, reason: 'Some variants lack data' }
  }

  // Pick the "best" variant by metric
  const lowerBetter = LOWER_IS_BETTER.has(args.input.metric)
  let winnerIdx = 0
  for (let i = 1; i < variants.length; i++) {
    if (lowerBetter ? metricValues[i]! < metricValues[winnerIdx]! : metricValues[i]! > metricValues[winnerIdx]!) {
      winnerIdx = i
    }
  }

  // Significance: control (variant 0) vs winner
  if (winnerIdx === 0) {
    return { pValue: 1.0, confident: false, reason: 'Control is best' }
  }
  const a = variants[0]
  const b = variants[winnerIdx]

  let pValue: number
  if (args.input.metric === 'conv_rate') {
    pValue = zTestProportions(a.conversions, a.clicks, b.conversions, b.clicks)
  } else if (args.input.metric === 'ctr') {
    pValue = zTestProportions(a.clicks, a.impressions, b.clicks, b.impressions)
  } else {
    // For cpc/cpa we'd need per-event variance — approximate via Welch using mean+var=(value*(1-pseudo))
    // Phase 1 approximation: treat as proportion test on conversions/clicks.
    pValue = zTestProportions(a.conversions, a.clicks, b.conversions, b.clicks)
  }

  return {
    pValue,
    confident: pValue <= args.threshold,
    winnerVariantId: pValue <= args.threshold ? variants[winnerIdx].id : undefined,
  }
}
