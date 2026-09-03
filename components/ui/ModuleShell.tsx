import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Stack } from '@/components/studio'

export type ModuleAccent = 'amber' | 'accent' | 'violet' | 'rose' | 'blue' | 'green' | 'cyan'
/** @deprecated Atmosphere tiers retired. Accepted and ignored. */
export type AtmosphereTier = 0 | 1 | 2

type ModuleShellProps = ComponentPropsWithoutRef<'div'> & {
  /** @deprecated Atmosphere retired. Accepted and ignored. */
  tier?: AtmosphereTier
  /** @deprecated Module accents retired. Accepted and ignored. */
  accent?: ModuleAccent
  children: ReactNode
  /** Extra test id for Messages parity */
  shellTestId?: string
  /** @deprecated Scanlines retired. Accepted and ignored. */
  showScanlines?: boolean
  /** @deprecated Neural field retired. Accepted and ignored. */
  fieldTestId?: string
  'data-messages-experience'?: string
  'data-briefings-experience'?: string
}

/**
 * Workspace frame. Atmosphere (aurora, neural field, scanlines) is retired;
 * children render in a Studio `Stack`. Atmosphere-related props are accepted
 * and ignored for API compatibility.
 */
export function ModuleShell({
  tier: _tier,
  accent: _accent,
  children,
  className,
  shellTestId,
  showScanlines: _showScanlines,
  fieldTestId: _fieldTestId,
  ...props
}: ModuleShellProps) {
  void _tier
  void _accent
  void _showScanlines
  void _fieldTestId

  return (
    <div
      data-pib-shell
      data-testid={shellTestId}
      className={cn('pib-shell flex min-h-0 min-w-0 flex-col', className)}
      {...props}
    >
      <Stack className="min-h-0 min-w-0 flex-1">{children}</Stack>
    </div>
  )
}

export default ModuleShell
