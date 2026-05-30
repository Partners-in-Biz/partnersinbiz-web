'use client'

export interface ScoreChipProps {
  score?: number
  label?: string
  size?: 'sm' | 'md'
  kind?: 'lead' | 'icp' | 'ai'
}

function colorClasses(score: number): string {
  if (score <= 30) return 'bg-red-500/15 text-red-300'
  if (score <= 65) return 'bg-amber-500/15 text-amber-300'
  return 'bg-emerald-500/15 text-emerald-300'
}

export function ScoreChip({ score, label, size = 'md', kind }: ScoreChipProps) {
  const isScored = score !== undefined && score !== null

  const sizeClasses =
    size === 'sm'
      ? 'text-xs px-1.5 py-0.5'
      : 'text-sm px-2 py-0.5'

  const colorCls = isScored
    ? colorClasses(score!)
    : 'bg-surface-container text-on-surface-variant'

  const tooltip = isScored
    ? [kind, label].filter(Boolean).join(' — ')
    : label
      ? `${label} — not scored yet`
      : 'Not scored yet'

  return (
    <span
      className={`inline-flex items-center rounded-full font-label font-medium uppercase tracking-wide ${sizeClasses} ${colorCls}`}
      title={tooltip}
    >
      {isScored ? score : 'Not scored'}
    </span>
  )
}
