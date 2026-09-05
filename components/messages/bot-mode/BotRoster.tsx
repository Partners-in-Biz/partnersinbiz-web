'use client'

import type { BotRosterItem } from '@/lib/messages/bot-roster'
import { botRosterRelativeTime } from '@/lib/messages/bot-roster'
import type { AgentPresenceState } from '@/lib/messages/agent-presence'
import { Icon } from '@/components/studio'
import { HoverTip } from '@/components/ui/HoverTip'
import { BotAvatar, botAvatarActivity } from './BotAvatar'
import { BotRowMenu, useBotRowMenu, type BotRowMenuItem } from './BotRowMenu'

export type { BotRosterItem }

const PRESENCE_DOT: Record<AgentPresenceState, string> = {
  idle: 'bg-[var(--color-pib-text-muted)]/50',
  thinking: 'bg-[color-mix(in_srgb,var(--st-info)_80%,white)] animate-pulse',
  working: 'bg-emerald-400',
  waiting: 'bg-[color-mix(in_srgb,var(--st-warning)_80%,white)]',
  blocked: 'bg-rose-400',
  done: 'bg-emerald-300',
}

function presenceTip(bot: BotRosterItem): string {
  const step = bot.presence?.currentStep?.trim()
  if (step) return step
  const state = bot.presence?.state
  if (!state || state === 'idle') return `${bot.name} · ${bot.role}`
  return state.charAt(0).toUpperCase() + state.slice(1)
}

function PresenceAvatar({
  bot,
  size,
}: {
  bot: BotRosterItem
  size: number
}) {
  const state = bot.presence?.state ?? 'idle'
  return (
    <span className="relative shrink-0" data-testid={`bot-roster-avatar-${bot.id}`} data-presence={state}>
      <BotAvatar
        name={bot.name}
        avatarUrl={bot.avatarUrl}
        avatarStyle={bot.avatarStyle}
        colorKey={bot.colorKey}
        activity={botAvatarActivity({ presence: state })}
        size={size}
      />
      {state !== 'idle' ? (
        <span
          data-testid={`bot-roster-presence-${bot.id}`}
          aria-hidden="true"
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-[var(--color-pib-bg)] ${PRESENCE_DOT[state]}`}
        />
      ) : null}
    </span>
  )
}

export function BotRoster({
  bots,
  activeBotId,
  pinnedBotId,
  onSelectBot,
  onStartChannel,
  onShareBot,
  onTogglePin,
  onOpenSettings,
  compact = false,
}: {
  bots: BotRosterItem[]
  activeBotId?: string | null
  pinnedBotId?: string | null
  onSelectBot: (botId: string) => void
  onStartChannel?: (botId: string) => void
  onShareBot?: (botId: string) => void
  /** Enables the long-press / right-click row menu with Pin / Unpin. */
  onTogglePin?: (botId: string) => void
  /** "Bot settings" in the row menu: opens the bot with its profile (look, pin, email). */
  onOpenSettings?: (botId: string) => void
  compact?: boolean
}) {
  if (compact) {
    return (
      <div data-testid="bot-roster-compact" className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
        {bots.map((bot) => (
          <HoverTip key={bot.id} label={presenceTip(bot)} side="right" className="shrink-0">
            <button
              type="button"
              aria-label={`Open ${bot.name}`}
              onClick={() => onSelectBot(bot.id)}
              className={`relative grid h-11 w-11 place-items-center rounded-md xl:h-10 xl:w-10 ${
                bot.id === activeBotId ? 'ring-2 ring-white/70' : 'opacity-80 hover:opacity-100'
              }`}
            >
              <BotAvatar
                name={bot.name}
                avatarUrl={bot.avatarUrl}
                avatarStyle={bot.avatarStyle}
                colorKey={bot.colorKey}
                activity={botAvatarActivity({ presence: bot.presence?.state })}
                size={32}
              />
              {bot.id === pinnedBotId ? (
                <Icon name="keep" className="absolute -left-0.5 -top-0.5 text-[11px] text-primary" />
              ) : null}
              {bot.presence && bot.presence.state !== 'idle' ? (
                <span
                  data-testid={`bot-roster-presence-${bot.id}`}
                  aria-hidden="true"
                  className={`absolute bottom-0.5 right-0.5 h-2 w-2 rounded-full border border-[var(--color-pib-bg)] ${PRESENCE_DOT[bot.presence.state]}`}
                />
              ) : null}
            </button>
          </HoverTip>
        ))}
      </div>
    )
  }

  return (
    <div data-testid="bot-roster" className="flex min-h-0 flex-col gap-0.5">
      {bots.length === 0 ? (
        <p className="px-2 py-3 text-xs text-[var(--color-pib-text-muted)]">No agents on this computer yet. Create one or pick another machine.</p>
      ) : bots.map((bot) => (
        <BotRosterRow
          key={bot.id}
          bot={bot}
          selected={bot.id === activeBotId}
          pinned={bot.id === pinnedBotId}
          onSelectBot={onSelectBot}
          onStartChannel={onStartChannel}
          onShareBot={onShareBot}
          onTogglePin={onTogglePin}
          onOpenSettings={onOpenSettings}
        />
      ))}
    </div>
  )
}

const ACTION_BUTTON_CLASS = 'grid h-8 w-8 place-items-center rounded text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-primary xl:h-6 xl:w-6 xl:opacity-0 xl:group-hover/bot:opacity-100 xl:group-focus-within/bot:opacity-100'

function BotRosterRow({
  bot,
  selected,
  pinned,
  onSelectBot,
  onStartChannel,
  onShareBot,
  onTogglePin,
  onOpenSettings,
}: {
  bot: BotRosterItem
  selected: boolean
  pinned: boolean
  onSelectBot: (botId: string) => void
  onStartChannel?: (botId: string) => void
  onShareBot?: (botId: string) => void
  onTogglePin?: (botId: string) => void
  onOpenSettings?: (botId: string) => void
}) {
  const menu = useBotRowMenu()
  const hasMenu = Boolean(onTogglePin || onOpenSettings)
  const preview = bot.lastPreview || bot.role
  const timeLabel = botRosterRelativeTime(bot.lastAt)
  const menuItems: BotRowMenuItem[] = [
    ...(onTogglePin
      ? [{ id: pinned ? 'unpin' : 'pin', label: pinned ? 'Unpin' : 'Pin', icon: pinned ? 'keep_off' : 'keep', onSelect: () => onTogglePin(bot.id) }]
      : []),
    ...(onOpenSettings
      ? [{ id: 'settings', label: 'Bot settings', icon: 'settings', onSelect: () => onOpenSettings(bot.id) }]
      : []),
  ]
  const actionCount = (hasMenu ? 1 : 0) + (onShareBot && bot.shareable ? 1 : 0) + (onStartChannel ? 1 : 0)
  const paddingRight = actionCount >= 3 ? 'pr-24 xl:pr-[4.5rem]' : 'pr-16 xl:pr-12'

  return (
    <article
      data-testid={`bot-roster-card-${bot.id}`}
      data-pinned={pinned ? 'true' : undefined}
      className={`group/bot relative min-w-0 rounded-md ${
        selected ? 'bg-[var(--color-row-hover)] ring-1 ring-[var(--color-pib-line)]' : 'hover:bg-[var(--color-row-hover)]'
      } ${menu.open ? 'z-30' : ''}`}
    >
      <HoverTip label={presenceTip(bot)} side="right" className="block min-w-0 w-full">
        <button
          type="button"
          aria-label={`Open ${bot.name}`}
          aria-pressed={selected}
          onClick={() => onSelectBot(bot.id)}
          {...(hasMenu ? menu.pressHandlers : {})}
          className={`flex min-h-12 min-w-0 w-full items-center gap-2.5 py-1.5 pl-2 text-left select-none xl:min-h-11 ${paddingRight}`}
        >
          <PresenceAvatar bot={bot} size={36} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1">
                {pinned ? <Icon name="keep" className="shrink-0 text-[11px] text-primary" /> : null}
                <span className="truncate text-[13px] font-medium leading-4 text-[var(--color-pib-text)]">{bot.name}</span>
              </span>
              {timeLabel ? <span className="shrink-0 font-mono text-[10px] text-[var(--color-pib-text-muted)]">{timeLabel}</span> : null}
            </span>
            <span className="mt-0.5 block truncate text-[11px] leading-4 text-[var(--color-pib-text-muted)]">{preview}</span>
          </span>
        </button>
      </HoverTip>
      <div className="absolute right-0.5 top-1/2 flex -translate-y-1/2 items-center">
        {hasMenu && (
          <button
            type="button"
            aria-label={`${bot.name} options`}
            aria-haspopup="menu"
            aria-expanded={menu.open}
            data-testid={`bot-roster-menu-${bot.id}`}
            onClick={() => menu.setOpen((open) => !open)}
            className={`${ACTION_BUTTON_CLASS} ${menu.open ? 'text-primary xl:opacity-100' : ''}`}
          >
            <Icon name="more_horiz" className="text-[15px]" />
          </button>
        )}
        {onShareBot && bot.shareable && (
          <button
            type="button"
            aria-label={`Share ${bot.name}`}
            onClick={() => onShareBot(bot.id)}
            className={ACTION_BUTTON_CLASS}
          >
            <Icon name="ios_share" className="text-[15px]" />
          </button>
        )}
        {onStartChannel && (
          <button
            type="button"
            aria-label={`Start channel with ${bot.name}`}
            onClick={() => onStartChannel(bot.id)}
            className={ACTION_BUTTON_CLASS}
          >
            <Icon name="add" className="text-[15px]" />
          </button>
        )}
      </div>
      {menu.open && menuItems.length > 0 ? (
        <BotRowMenu botName={bot.name} items={menuItems} onClose={menu.close} />
      ) : null}
    </article>
  )
}
