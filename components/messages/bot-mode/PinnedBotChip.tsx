'use client'

import type { BotRosterItem } from '@/lib/messages/bot-roster'
import { Icon } from '@/components/studio'
import { BotAvatar, botAvatarActivity } from './BotAvatar'

/**
 * Signature move: the favourite bot is one tap from the first Messages screen.
 * Renders nothing when no pin is set or the pinned bot is not on this computer.
 */
export function PinnedBotChip({
  bot,
  active = false,
  onOpen,
  onUnpin,
  className = '',
}: {
  bot: BotRosterItem | null | undefined
  active?: boolean
  onOpen: (botId: string) => void
  onUnpin?: (botId: string) => void
  className?: string
}) {
  if (!bot) return null
  const activity = botAvatarActivity({ presence: bot.presence?.state })
  const status = bot.presence?.currentStep?.trim()
    || (activity === 'working' ? 'Working now' : activity === 'waiting' ? 'Needs you' : bot.lastPreview || bot.role)
  return (
    <div
      data-testid="pinned-bot-chip"
      data-bot-id={bot.id}
      className={`flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/[0.08] p-1 ${className}`.trim()}
    >
      <button
        type="button"
        aria-label={`Open pinned bot ${bot.name}`}
        aria-current={active ? 'true' : undefined}
        onClick={() => onOpen(bot.id)}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 text-left hover:bg-primary/[0.1] focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <BotAvatar
          name={bot.name}
          avatarUrl={bot.avatarUrl}
          avatarStyle={bot.avatarStyle}
          colorKey={bot.colorKey}
          activity={activity}
          size={36}
          testId={`pinned-bot-avatar-${bot.id}`}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <Icon name="keep" className="text-[12px] text-primary" />
            <span className="truncate text-[13px] font-medium leading-4 text-[var(--color-pib-text)]">{bot.name}</span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] leading-4 text-[var(--color-pib-text-muted)]">{status}</span>
        </span>
        <Icon name="chevron_right" className="shrink-0 text-[16px] text-[var(--color-pib-text-muted)]" />
      </button>
      {onUnpin ? (
        <button
          type="button"
          aria-label={`Unpin ${bot.name}`}
          onClick={() => onUnpin(bot.id)}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)] xl:h-7 xl:w-7"
        >
          <Icon name="keep_off" className="text-[15px]" />
        </button>
      ) : null}
    </div>
  )
}
