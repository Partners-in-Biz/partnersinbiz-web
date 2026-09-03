'use client'

export interface ScoreChipProps {
  score?: number
  label?: string
  size?: 'sm' | 'md'
  kind?: 'lead' | 'icp' | 'ai'
}

function colorClasses(score: number): string {
  if (score <= 30) return 'pib-pill-danger'
  if (score <= 65) return 'pib-pill-warn'
  return 'pib-pill-success'
}

export function ScoreChip({ score, label, size = 'md', kind }: ScoreChipProps) {
  const isScored = score !== undefined && score !== null

  const sizeClasses =
    size === 'sm'
      ? 'px-1.5 py-0.5 text-[10px]'
      : 'px-2 py-0.5 text-xs'

  const colorCls = isScored ? colorClasses(score!) : ''

  const tooltip = isScored
    ? [kind, label].filter(Boolean).join(' - ')
    : label
      ? `${label} - not scored yet`
      : 'Not scored yet'

  return (
    <span
      className={`pib-pill ${sizeClasses} ${colorCls}`}
      title={tooltip}
    >
      {isScored ? score : 'Not scored'}
    </span>
  )
}
