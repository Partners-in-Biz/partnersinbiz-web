'use client'

import { Icon } from '@/components/studio'

/**
 * Title-bar chip near ChatChromeToggle — signals a live computer session.
 * Positioned at fixed left-12 top-2 to sit beside the chrome toggle (left-2).
 */
export function ComputerActivityChip({
  active,
  onOpen,
  label = 'Computer active',
}: {
  active: boolean
  onOpen: () => void
  label?: string
}) {
  if (!active) return null
  return (
    <button
      type="button"
      data-testid="computer-activity-chip"
      aria-label={label}
      onClick={onOpen}
      className="fixed left-12 top-2 z-[80] inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary/35 bg-[color-mix(in_srgb,var(--sc-ink)_70%,transparent)] px-2.5 text-[11px] font-medium text-primary hover:bg-[var(--color-pib-surface-muted)]"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
      </span>
      <Icon name="desktop_windows" className="text-[15px]" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}
