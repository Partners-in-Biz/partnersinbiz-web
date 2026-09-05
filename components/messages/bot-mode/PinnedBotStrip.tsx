'use client'

import type { BotRosterItem } from '@/lib/messages/bot-roster'
import { BotAvatar, botAvatarActivity } from './BotAvatar'
import { BotRowMenu, useBotRowMenu } from './BotRowMenu'

/**
 * Signature move: the favourite bot is one tap from the first Messages screen.
 * Horizontal strip of pinned avatars above the roster; renders nothing when
 * no pin is set or the pinned bot is not on this computer.
 */
export function PinnedBotStrip({
  bots,
  activeBotId,
  onOpen,
  onUnpin,
  onOpenSettings,
  className = '',
}: {
  bots: BotRosterItem[]
  activeBotId?: string | null
  onOpen: (botId: string) => void
  onUnpin?: (botId: string) => void
  onOpenSettings?: (botId: string) => void
  className?: string
}) {
  if (bots.length === 0) return null
  return (
    <div
      data-testid="pinned-bot-strip"
      role="list"
      aria-label="Pinned bots"
      className={`flex gap-3 overflow-x-auto px-1 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`.trim()}
    >
      {bots.map((bot) => (
        <PinnedBotItem
          key={bot.id}
          bot={bot}
          active={bot.id === activeBotId}
          onOpen={onOpen}
          onUnpin={onUnpin}
          onOpenSettings={onOpenSettings}
        />
      ))}
    </div>
  )
}

function PinnedBotItem({
  bot,
  active,
  onOpen,
  onUnpin,
  onOpenSettings,
}: {
  bot: BotRosterItem
  active: boolean
  onOpen: (botId: string) => void
  onUnpin?: (botId: string) => void
  onOpenSettings?: (botId: string) => void
}) {
  const menu = useBotRowMenu()
  const activity = botAvatarActivity({ presence: bot.presence?.state })
  const items = [
    ...(onUnpin ? [{ id: 'unpin', label: 'Unpin', icon: 'keep_off', onSelect: () => onUnpin(bot.id) }] : []),
    ...(onOpenSettings ? [{ id: 'settings', label: 'Bot settings', icon: 'settings', onSelect: () => onOpenSettings(bot.id) }] : []),
  ]
  return (
    <div role="listitem" className="relative shrink-0">
      <button
        type="button"
        data-testid={`pinned-bot-${bot.id}`}
        aria-label={`Open pinned bot ${bot.name}`}
        aria-current={active ? 'true' : undefined}
        onClick={() => onOpen(bot.id)}
        {...menu.pressHandlers}
        className={`flex w-[72px] flex-col items-center gap-1.5 rounded-xl px-1 py-1.5 text-center select-none hover:bg-[var(--color-row-hover)] focus-visible:ring-2 focus-visible:ring-primary/60 ${
          active ? 'bg-[var(--color-row-hover)]' : ''
        }`}
      >
        <span className={`grid place-items-center rounded-full p-[3px] ${active ? 'ring-2 ring-primary/70' : 'ring-1 ring-[var(--color-pib-line)]'}`}>
          <BotAvatar
            name={bot.name}
            avatarUrl={bot.avatarUrl}
            avatarStyle={bot.avatarStyle}
            colorKey={bot.colorKey}
            activity={activity}
            size={52}
            className="[border-radius:50%] [&_.bot-avatar__image]:rounded-full [&_.bot-avatar__ring]:rounded-full"
            testId={`pinned-bot-avatar-${bot.id}`}
          />
        </span>
        <span className="w-full truncate text-[11px] leading-4 text-[var(--color-pib-text)]">{bot.name}</span>
      </button>
      {menu.open && items.length > 0 ? (
        <BotRowMenu botName={bot.name} items={items} onClose={menu.close} align="center" />
      ) : null}
    </div>
  )
}
