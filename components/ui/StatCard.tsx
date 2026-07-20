import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { ModuleAccent } from '@/components/ui/ModuleShell'

type StatCardProps = {
  label: ReactNode
  value: ReactNode
  detail?: ReactNode
  icon?: string
  accent?: ModuleAccent
  className?: string
  href?: string
}

const ACCENT_TINT: Record<ModuleAccent, string> = {
  amber: 'pib-icon-tint',
  accent: 'pib-icon-tint',
  violet: 'pib-icon-tint-violet',
  rose: 'pib-icon-tint-rose',
  blue: 'pib-icon-tint-blue',
  green: 'pib-icon-tint-green',
  cyan: 'pib-icon-tint-cyan',
}

/** Compact KPI card — dense cinematic kit. */
export function StatCard({ label, value, detail, icon, accent = 'amber', className }: StatCardProps) {
  return (
    <article
      data-module-accent={accent}
      className={cn('pib-stat-card pib-enter', className)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="pib-label text-[10px] tracking-[0.14em] text-[var(--color-pib-text-muted)]">{label}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-[var(--color-pib-text)]">{value}</p>
          {detail ? <p className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">{detail}</p> : null}
        </div>
        {icon ? (
          <span className={cn(ACCENT_TINT[accent], 'shrink-0')} aria-hidden="true">
            <span className="material-symbols-outlined text-[16px]">{icon}</span>
          </span>
        ) : null}
      </div>
    </article>
  )
}

export default StatCard
