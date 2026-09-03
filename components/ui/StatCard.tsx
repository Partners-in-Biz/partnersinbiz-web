import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { ModuleAccent } from '@/components/ui/ModuleShell'

import { Icon } from '@/components/studio'

type StatCardProps = {
  label: ReactNode
  value: ReactNode
  detail?: ReactNode
  icon?: string
  /** @deprecated Ignored. Studio has no per-card accent colour. */
  accent?: ModuleAccent
  className?: string
  href?: string
}

/** Compact KPI card  -  Studio `st-panel` with mono label and tabular value. */
export function StatCard({ label, value, detail, icon, accent: _accent, className }: StatCardProps) {
  void _accent
  return (
    <article className={cn('st-panel', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="sc-tiny">{label}</p>
          <p className="st-num mt-1 text-[1.75rem] leading-none text-[var(--sc-ink)]">{value}</p>
          {detail ? <p className="sc-body mt-1 text-[0.875rem] text-[var(--sc-ink-soft)]">{detail}</p> : null}
        </div>
        {icon ? (
          <Icon name={icon} className="shrink-0 text-[20px] text-[var(--sc-ink-soft)]" />
        ) : null}
      </div>
    </article>
  )
}

export default StatCard
