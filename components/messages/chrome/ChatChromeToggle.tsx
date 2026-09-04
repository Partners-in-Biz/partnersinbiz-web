'use client'

import {
  CHAT_CHROME_HIDE_LABEL,
  CHAT_CHROME_PIN_LABEL,
  CHAT_CHROME_SHOW_LABEL,
  CHAT_CHROME_UNPIN_LABEL,
} from '@/lib/messages/chat-chrome'
import { Icon } from '@/components/studio'

export function ChatChromeToggle({
  revealed,
  pinned,
  onToggle,
  onTogglePin,
}: {
  revealed: boolean
  pinned?: boolean
  onToggle: () => void
  onTogglePin?: () => void
}) {
  const label = revealed ? CHAT_CHROME_HIDE_LABEL : CHAT_CHROME_SHOW_LABEL
  return (
    <div className="fixed left-2 top-2 z-[80] flex items-center gap-1">
      <button
        type="button"
        aria-label={label}
        data-testid={revealed ? 'bot-mode-hide-chrome' : 'bot-mode-show-chrome'}
        onClick={onToggle}
        className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--color-pib-line)] bg-[color-mix(in_srgb,var(--sc-ink)_70%,transparent)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-pib-surface-muted)] hover:text-[var(--color-pib-text)]"
      >
        <Icon name={revealed ? 'close_fullscreen' : 'menu'} className="text-[18px]" />
      </button>
      {revealed && onTogglePin ? (
        <button
          type="button"
          aria-label={pinned ? CHAT_CHROME_UNPIN_LABEL : CHAT_CHROME_PIN_LABEL}
          data-testid={pinned ? 'chat-chrome-unpin' : 'chat-chrome-pin'}
          onClick={onTogglePin}
          className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--color-pib-line)] bg-[color-mix(in_srgb,var(--sc-ink)_70%,transparent)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-pib-surface-muted)] hover:text-[var(--color-pib-text)]"
        >
          <Icon name={pinned ? 'keep_off' : 'keep'} className="text-[18px]" />
        </button>
      ) : null}
    </div>
  )
}

/** @deprecated Prefer ChatChromeToggle — kept for existing imports */
export function BotModeChromeToggle({
  revealed,
  onToggle,
}: {
  revealed: boolean
  onToggle: () => void
}) {
  return <ChatChromeToggle revealed={revealed} onToggle={onToggle} />
}
