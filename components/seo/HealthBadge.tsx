interface HealthBadgeProps {
  score?: number | null
  signalsCount?: number
}

export function HealthBadge({ score, signalsCount = 0 }: HealthBadgeProps) {
  let color = 'pib-pill'
  let label = 'unknown'
  if (typeof score === 'number') {
    if (score >= 80) {
      color = 'pib-pill pib-pill-success'
      label = `healthy${signalsCount > 0 ? ` · ${signalsCount}` : ''}`
    } else if (score >= 50) {
      color = 'pib-pill pib-pill-warn'
      label = `attention · ${signalsCount}`
    } else {
      color = 'pib-pill pib-pill-danger'
      label = `unhealthy · ${signalsCount}`
    }
  }
  return <span className={color}>{label}</span>
}
