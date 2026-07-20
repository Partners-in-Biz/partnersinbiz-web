import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type HudChipProps = ComponentPropsWithoutRef<'span'> & {
  tone?: 'default' | 'accent' | 'live'
  live?: boolean
  children: ReactNode
}

/** Compact meta chip for dense HUDs and page headers. */
export function HudChip({ tone = 'default', live, children, className, ...props }: HudChipProps) {
  const resolved = live ? 'live' : tone
  return (
    <span
      className={cn('pib-hud-chip messages-info-chip', className)}
      data-tone={resolved === 'default' ? undefined : resolved}
      {...props}
    >
      {live || resolved === 'live' ? <span className="pib-live-dot messages-hud-pulse" aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

export function SignalMeter({ className, title = 'Signal' }: { className?: string; title?: string }) {
  return (
    <span className={cn('pib-signal-meter messages-hud-meter', className)} title={title} aria-hidden="true">
      <i />
    </span>
  )
}

export function GlassBar({ children, className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div className={cn('pib-glass-bar', className)} {...props}>
      {children}
    </div>
  )
}

export function LiveDot({ className }: { className?: string }) {
  return <span className={cn('pib-live-dot messages-hud-pulse', className)} aria-hidden="true" />
}

export default HudChip
