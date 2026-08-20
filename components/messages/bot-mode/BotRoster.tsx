'use client'

import type { BotRosterItem } from '@/lib/messages/bot-roster'
import { botRosterRelativeTime } from '@/lib/messages/bot-roster'

export type { BotRosterItem }

const COLOR: Record<string, string> = {
  violet: 'bg-violet-400',
  sky: 'bg-sky-400',
  amber: 'bg-amber-400',
  emerald: 'bg-emerald-400',
  rose: 'bg-rose-400',
}

function initials(name: string): string {
  return name
    .split(/[\s.@]+/)
    .filter(Boolean)
    .slice(0, 1)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'B'
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
          <button
            key={bot.id}
            type="button"
            aria-label={`Open ${bot.name}`}
            title={`${bot.name} · ${bot.role}`}
            onClick={() => onSelectBot(bot.id)}
            className={`relative grid h-11 w-11 place-items-center rounded-full text-[12px] font-semibold text-black xl:h-10 xl:w-10 ${
              COLOR[bot.colorKey ?? ''] ?? 'bg-primary'
            } ${bot.id === activeBotId ? 'ring-2 ring-white/70' : 'opacity-80 hover:opacity-100'}`}
          >
            {initials(bot.name)}
          </button>
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
              selected ? 'bg-white/[0.08] ring-1 ring-white/[0.06]' : 'hover:bg-white/[0.045]'
            }`}
          >
            <button
              type="button"
              aria-label={`Open ${bot.name}`}
              aria-pressed={selected}
              title={preview}
              onClick={() => onSelectBot(bot.id)}
              className="flex min-h-12 min-w-0 w-full items-center gap-2.5 py-1.5 pl-2 pr-16 text-left xl:min-h-11 xl:pr-12"
            >
              <span aria-hidden="true" className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-black ${COLOR[bot.colorKey ?? ''] ?? 'bg-primary'}`}>
                {initials(bot.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold leading-4 text-[var(--color-pib-text)]">{bot.name}</span>
                  {timeLabel ? <span className="shrink-0 font-mono text-[10px] text-[var(--color-pib-text-muted)]">{timeLabel}</span> : null}
                </span>
                <span className="mt-0.5 block truncate text-[11px] leading-4 text-[var(--color-pib-text-muted)]">{preview}</span>
              </span>
            </button>
            <div className="absolute right-0.5 top-1/2 flex -translate-y-1/2 items-center">
              {onShareBot && bot.shareable && (
                <button
                  type="button"
                  aria-label={`Share ${bot.name}`}
                  onClick={() => onShareBot(bot.id)}
                  className="grid h-8 w-8 place-items-center rounded text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-primary xl:h-6 xl:w-6 xl:opacity-0 xl:group-hover/bot:opacity-100 xl:group-focus-within/bot:opacity-100"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[15px]">ios_share</span>
                </button>
              )}
              {onStartChannel && (
                <button
                  type="button"
                  aria-label={`Start channel with ${bot.name}`}
                  onClick={() => onStartChannel(bot.id)}
                  className="grid h-8 w-8 place-items-center rounded text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-primary xl:h-6 xl:w-6 xl:opacity-0 xl:group-hover/bot:opacity-100 xl:group-focus-within/bot:opacity-100"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[15px]">add</span>
                </button>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}
