'use client'

import type { MessagesExperienceMode } from '@/lib/messages/experience-mode'
import { Icon } from '@/components/studio'

const OPTIONS: Array<{ mode: MessagesExperienceMode; label: string; icon: string }> = [
  { mode: 'messages', label: 'Messages', icon: 'forum' },
  { mode: 'bot', label: 'Bot mode', icon: 'smart_toy' },
]

export function MessagesExperienceSwitch({
  value,
  onChange,
  showLabels = false,
}: {
  value: MessagesExperienceMode
  onChange: (mode: MessagesExperienceMode) => void
  showLabels?: boolean
}) {
  return (
    <div
      role="tablist"
      aria-label="Chat experience"
      data-testid="messages-experience-switch"
      className="inline-flex h-8 shrink-0 items-center rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-0.5"
    >
      {OPTIONS.map((option) => {
        const selected = option.mode === value
        return (
          <button
            key={option.mode}
            type="button"
            role="tab"
            aria-label={option.label}
            aria-selected={selected}
            data-testid={`messages-experience-${option.mode}`}
            onClick={() => onChange(option.mode)}
            className={`inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium ${
              selected
                ? 'bg-[var(--color-pib-surface-muted)] text-[var(--color-pib-text)]'
                : 'text-[var(--color-pib-text-muted)] hover:bg-[var(--color-pib-surface-muted)] hover:text-[var(--color-pib-text)]'
            }`}
          >
            <Icon name={option.icon} className="text-[14px]" />
            <span className={showLabels ? 'inline' : 'hidden sm:inline'}>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
