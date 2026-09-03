// components/ui/Card.tsx
import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '@/lib/utils'

import { Icon } from '@/components/studio'

type CardProps = ComponentPropsWithoutRef<'div'> & {
  children: React.ReactNode
  className?: string
  hover?: boolean
  onClick?: () => void
}

/** Raised paper panel. Emits Studio `st-panel`. */
export function Card({ children, className, hover, onClick, ...props }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'st-panel',
        (hover || onClick) && 'pib-card-hover',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

interface MetricCardProps {
  label: string
  value: string | number
  sub?: string
  trend?: 'up' | 'down' | 'neutral'
  /** @deprecated Ignored. Studio has no per-card accent colour. */
  accent?: boolean
  icon?: string
  onClick?: () => void
}

/** KPI panel: `.sc-tiny` label, `.st-num` value. */
export function MetricCard({ label, value, sub, trend, accent: _accent, icon, onClick }: MetricCardProps) {
  void _accent
  return (
    <div
      onClick={onClick}
      className={cn('st-panel', onClick && 'cursor-pointer')}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="sc-tiny">{label}</p>
        {icon ? (
          <Icon name={icon} className="text-[20px] text-[var(--sc-ink-soft)]" />
        ) : null}
      </div>
      <p className="st-num text-[1.75rem] leading-none text-[var(--sc-ink)]">{value}</p>
      {sub ? (
        <p className="sc-body text-[0.875rem] text-[var(--sc-ink-soft)]">
          {trend === 'up' ? <span aria-hidden="true">↑ </span> : null}
          {trend === 'down' ? <span aria-hidden="true">↓ </span> : null}
          {sub}
        </p>
      ) : null}
    </div>
  )
}
