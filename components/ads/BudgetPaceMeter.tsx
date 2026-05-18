'use client'

interface Props {
  percent: number  // 0-100+
  capCents?: number
  spendCents?: number
  currencyCode?: string
}

export function BudgetPaceMeter({ percent, capCents, spendCents, currencyCode = 'USD' }: Props) {
  const clamped = Math.max(0, Math.min(100, percent))
  const color =
    percent >= 100
      ? 'bg-red-500'
      : percent >= 90
      ? 'bg-amber-500'
      : percent >= 75
      ? 'bg-yellow-500'
      : 'bg-emerald-500'
  const fmt = (cents: number | undefined) => {
    if (typeof cents !== 'number') return '—'
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode }).format(
      cents / 100,
    )
  }
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-white/60 mb-1">
        <span>
          {fmt(spendCents)} / {fmt(capCents)}
        </span>
        <span className={percent >= 100 ? 'text-red-400 font-semibold' : ''}>
          {percent.toFixed(1)}%
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}
