import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type HudChipTone = 'default' | 'accent' | 'live' | 'neutral' | 'success' | 'warning' | 'warn'

type HudChipProps = ComponentPropsWithoutRef<'span'> & {
  tone?: HudChipTone
  live?: boolean
  children: ReactNode
}

type StudioStatusTone = 'success' | 'warning' | 'danger' | 'info'

function resolveStudioTone(tone: HudChipTone, live?: boolean): StudioStatusTone | undefined {
  if (live || tone === 'live' || tone === 'success') return 'success'
  if (tone === 'warning' || tone === 'warn' || tone === 'accent') return 'warning'
  return undefined
}

/** Status word with dot. Emits Studio `st-status` markup. */
export function HudChip({ tone = 'default', live, children, className, ...props }: HudChipProps) {
  const studioTone = resolveStudioTone(tone, live)
  return (
    <span
      className={cn('st-status sc-tiny', studioTone && `st-status--${studioTone}`, className)}
      {...props}
    >
      {children}
    </span>
  )
}

export default HudChip
