interface PipPresencePillProps {
  lastRunAt?: string | null
  nowAt?: string
}

export function PipPresencePill({ lastRunAt, nowAt }: PipPresencePillProps) {
  let color = 'bg-[var(--color-pib-text-muted)]'
  let pill = 'pib-pill'
  let label = 'Pip idle'
  if (lastRunAt && nowAt) {
    const ageMs = new Date(nowAt).getTime() - new Date(lastRunAt).getTime()
    if (ageMs < 24 * 60 * 60 * 1000) {
      color = 'bg-green-300'
      pill = 'pib-pill pib-pill-success'
      label = 'Pip active today'
    } else if (ageMs < 72 * 60 * 60 * 1000) {
      color = 'bg-[var(--color-pib-accent)]'
      pill = 'pib-pill pib-pill-warn'
      label = 'Pip behind'
    } else {
      color = 'bg-red-300'
      pill = 'pib-pill pib-pill-danger'
      label = 'Pip stale'
    }
  }
  return (
    <span className={pill}>
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  )
}
