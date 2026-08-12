import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { NeuralField } from '@/components/ui/atmosphere/NeuralField'
import { CssAurora } from '@/components/ui/atmosphere/CssAurora'

export type ModuleAccent = 'amber' | 'accent' | 'violet' | 'rose' | 'blue' | 'green' | 'cyan'
export type AtmosphereTier = 0 | 1 | 2

type ModuleShellProps = ComponentPropsWithoutRef<'div'> & {
  tier?: AtmosphereTier
  accent?: ModuleAccent
  children: ReactNode
  /** Extra test id for Messages parity */
  shellTestId?: string
  showScanlines?: boolean
  fieldTestId?: string
  'data-messages-experience'?: string
  'data-briefings-experience'?: string
}

/**
 * Workspace frame with atmosphere tiers:
 * 0 quiet (solid surface, no aurora/field) · 1 glass + static aurora · 2 neural field + glass
 */
export function ModuleShell({
  tier = 1,
  accent = 'amber',
  children,
  className,
  shellTestId,
  showScanlines = tier >= 2,
  fieldTestId,
  ...props
}: ModuleShellProps) {
  return (
    <div
      data-pib-shell
      data-tier={tier}
      data-module-accent={accent}
      data-testid={shellTestId}
      className={cn('pib-shell flex min-h-0 min-w-0 flex-col', className)}
      {...props}
    >
      {tier >= 2 ? <NeuralField testId={fieldTestId ?? 'pib-neural-field'} /> : null}
      {tier >= 1 ? <CssAurora /> : null}
      {showScanlines ? <div className="pib-scanlines messages-scanlines" aria-hidden="true" /> : null}
      <div className="pib-shell-chrome messages-experience-chrome">{children}</div>
    </div>
  )
}

export default ModuleShell
