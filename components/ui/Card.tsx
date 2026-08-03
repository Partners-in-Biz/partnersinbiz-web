// components/ui/Card.tsx
import { cn } from '@/lib/utils'

interface CardProps {
  children: React.ReactNode
  className?: string
  hover?: boolean
  onClick?: () => void
  id?: string
}

export function Card({ children, className, hover, onClick, id }: CardProps) {
  return (
    <div
      id={id}
      onClick={onClick}
      className={cn(
        'pib-card',
        (hover || onClick) && 'pib-card-hover',
        className,
      )}
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
  accent?: boolean
  icon?: string
  onClick?: () => void
}

export function MetricCard({ label, value, sub, trend, accent, icon, onClick }: MetricCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn('pib-stat-card', onClick && 'cursor-pointer')}
    >
      <div className="flex items-start justify-between">
        <p className="eyebrow !text-[10px]">{label}</p>
        {icon && (
          <span aria-hidden="true" className="pib-icon-tint !h-8 !w-8">
            <span className="material-symbols-outlined text-[16px]">
              {icon}
            </span>
          </span>
        )}
      </div>
      <p
        className={cn(
          'mt-3 font-display tracking-tight leading-none text-3xl md:text-4xl',
          accent ? 'text-[var(--color-pib-accent)]' : 'text-[var(--color-pib-text)]',
        )}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-3 text-xs text-[var(--color-pib-text-muted)] flex items-center gap-1 font-mono">
          {trend === 'up' && <span className="text-[var(--color-pib-success)]">↑</span>}
          {trend === 'down' && <span className="text-[#FCA5A5]">↓</span>}
          {sub}
        </p>
      )}
    </div>
  )
}
