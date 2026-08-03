import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type HudChipTone = 'default' | 'accent' | 'live' | 'neutral' | 'success' | 'warning' | 'warn'

type HudChipProps = ComponentPropsWithoutRef<'span'> & {
  tone?: HudChipTone
  live?: boolean
  children: ReactNode
}

function resolveHudTone(tone: HudChipTone, live?: boolean): 'default' | 'accent' | 'live' {
  if (live) return 'live'
  if (tone === 'neutral') return 'default'
  if (tone === 'success') return 'live'
  if (tone === 'warning' || tone === 'warn') return 'accent'
  return tone
}

/** Compact meta chip for dense HUDs and page headers. */
export function HudChip({ tone = 'default', live, children, className, ...props }: HudChipProps) {
  const resolved = resolveHudTone(tone, live)
  return (
    <span
      className={cn('pib-hud-chip messages-info-chip', className)}
      data-tone={resolved === 'default' ? undefined : resolved}
      data-source-tone={tone === 'default' ? undefined : tone}
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
