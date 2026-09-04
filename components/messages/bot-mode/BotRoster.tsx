'use client'

import type { BotRosterItem } from '@/lib/messages/bot-roster'
import { botRosterRelativeTime } from '@/lib/messages/bot-roster'
import type { AgentPresenceState } from '@/lib/messages/agent-presence'
import { Icon } from '@/components/studio'
import { HoverTip } from '@/components/ui/HoverTip'

export type { BotRosterItem }

const COLOR: Record<string, string> = {
  violet: 'bg-[color-mix(in_srgb,var(--st-info)_12%,transparent)]',
  sky: 'bg-sky-400',
  amber: 'bg-[color-mix(in_srgb,var(--st-warning)_12%,transparent)]',
  emerald: 'bg-emerald-400',
  rose: 'bg-rose-400',
}

const PRESENCE_DOT: Record<AgentPresenceState, string> = {
  idle: 'bg-[var(--color-pib-text-muted)]/50',
  thinking: 'bg-[color-mix(in_srgb,var(--st-info)_80%,white)] animate-pulse',
  working: 'bg-emerald-400',
  waiting: 'bg-[color-mix(in_srgb,var(--st-warning)_80%,white)]',
  blocked: 'bg-rose-400',
  done: 'bg-emerald-300',
}

const PRESENCE_RING: Partial<Record<AgentPresenceState, string>> = {
  thinking: 'ring-2 ring-[color-mix(in_srgb,var(--st-info)_55%,transparent)]',
  working: 'ring-2 ring-emerald-400/60',
  waiting: 'ring-2 ring-[color-mix(in_srgb,var(--st-warning)_55%,transparent)]',
  blocked: 'ring-2 ring-rose-400/55',
}

function initials(name: string): string {
  return name
    .split(/[\s.@]+/)
    .filter(Boolean)
    .slice(0, 1)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'B'
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
  sizeClass,
}: {
  bot: BotRosterItem
  sizeClass: string
}) {
  const state = bot.presence?.state ?? 'idle'
  const ring = PRESENCE_RING[state] ?? ''
  return (
    <span className={`relative shrink-0 ${ring ? `${ring} rounded-md` : ''}`}>
      <span
        aria-hidden="true"
        data-testid={`bot-roster-avatar-${bot.id}`}
        data-presence={state}
        className={`grid ${sizeClass} place-items-center rounded-md text-[13px] font-medium text-black ${COLOR[bot.colorKey ?? ''] ?? 'bg-primary'}`}
      >
        {initials(bot.name)}
      </span>
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
  onSelectBot,
  onStartChannel,
  onShareBot,
  compact = false,
}: {
  bots: BotRosterItem[]
  activeBotId?: string | null
  onSelectBot: (botId: string) => void
  onStartChannel?: (botId: string) => void
  onShareBot?: (botId: string) => void
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
              className={`relative grid h-11 w-11 place-items-center rounded-md text-[12px] font-medium text-black xl:h-10 xl:w-10 ${
                COLOR[bot.colorKey ?? ''] ?? 'bg-primary'
              } ${bot.id === activeBotId ? 'ring-2 ring-white/70' : 'opacity-80 hover:opacity-100'} ${PRESENCE_RING[bot.presence?.state ?? 'idle'] ?? ''}`}
            >
              {initials(bot.name)}
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
        <p className="px-2 py-3 text-xs text-[var(--color-pib-text-muted)]">No Bots are visible for this organisation yet.</p>
      ) : bots.map((bot) => {
        const selected = bot.id === activeBotId
        const preview = bot.lastPreview || bot.role
        const timeLabel = botRosterRelativeTime(bot.lastAt)
        return (
          <article
            key={bot.id}
            data-testid={`bot-roster-card-${bot.id}`}
            className={`group/bot relative min-w-0 rounded-md ${
              selected ? 'bg-[var(--color-row-hover)] ring-1 ring-[var(--color-pib-line)]' : 'hover:bg-[var(--color-row-hover)]'
            }`}
          >
            <HoverTip label={presenceTip(bot)} side="right" className="block min-w-0 w-full">
              <button
                type="button"
                aria-label={`Open ${bot.name}`}
                aria-pressed={selected}
                onClick={() => onSelectBot(bot.id)}
                className="flex min-h-12 min-w-0 w-full items-center gap-2.5 py-1.5 pl-2 pr-16 text-left xl:min-h-11 xl:pr-12"
              >
                <PresenceAvatar bot={bot} sizeClass="h-9 w-9 text-[13px]" />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-medium leading-4 text-[var(--color-pib-text)]">{bot.name}</span>
                    {timeLabel ? <span className="shrink-0 font-mono text-[10px] text-[var(--color-pib-text-muted)]">{timeLabel}</span> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] leading-4 text-[var(--color-pib-text-muted)]">{preview}</span>
                </span>
              </button>
            </HoverTip>
            <div className="absolute right-0.5 top-1/2 flex -translate-y-1/2 items-center">
              {onShareBot && bot.shareable && (
                <button
                  type="button"
                  aria-label={`Share ${bot.name}`}
                  onClick={() => onShareBot(bot.id)}
                  className="grid h-8 w-8 place-items-center rounded text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-primary xl:h-6 xl:w-6 xl:opacity-0 xl:group-hover/bot:opacity-100 xl:group-focus-within/bot:opacity-100"
                >
                  <Icon name="ios_share" className="text-[15px]" />
                </button>
              )}
              {onStartChannel && (
                <button
                  type="button"
                  aria-label={`Start channel with ${bot.name}`}
                  onClick={() => onStartChannel(bot.id)}
                  className="grid h-8 w-8 place-items-center rounded text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-primary xl:h-6 xl:w-6 xl:opacity-0 xl:group-hover/bot:opacity-100 xl:group-focus-within/bot:opacity-100"
                >
                  <Icon name="add" className="text-[15px]" />
                </button>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}
