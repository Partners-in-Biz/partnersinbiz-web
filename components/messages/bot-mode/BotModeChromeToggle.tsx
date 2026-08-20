'use client'

import { BOT_MODE_HIDE_CHROME_LABEL, BOT_MODE_SHOW_CHROME_LABEL } from '@/lib/messages/bot-mode-chrome'

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
      className="fixed left-2 top-2 z-[80] grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-black/70 text-[var(--color-pib-text-muted)] hover:bg-white/10 hover:text-[var(--color-pib-text)]"
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
        {revealed ? 'close_fullscreen' : 'menu'}
      </span>
    </button>
  )
}
