'use client'

import { BOT_MODE_HIDE_CHROME_LABEL, BOT_MODE_SHOW_CHROME_LABEL } from '@/lib/messages/bot-mode-chrome'
import { Icon } from '@/components/studio'

export function BotModeChromeToggle({
  revealed,
  onToggle,
}: {
  revealed: boolean
  onToggle: () => void
}) {
  const label = revealed ? BOT_MODE_HIDE_CHROME_LABEL : BOT_MODE_SHOW_CHROME_LABEL
  return (
    <button
      type="button"
      aria-label={label}
      data-testid={revealed ? 'bot-mode-hide-chrome' : 'bot-mode-show-chrome'}
      onClick={onToggle}
      className="fixed left-2 top-2 z-[80] grid h-9 w-9 place-items-center rounded-lg border border-[var(--color-pib-line)] bg-[color-mix(in_srgb,var(--sc-ink)_70%,transparent)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-pib-surface-muted)] hover:text-[var(--color-pib-text)]"
    >
      <Icon name={revealed ? 'close_fullscreen' : 'menu'} className="text-[18px]" />
    </button>
  )
}
