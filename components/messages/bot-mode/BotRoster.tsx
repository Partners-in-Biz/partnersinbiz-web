'use client'

import type { BotRosterItem } from '@/lib/messages/bot-roster'

export type { BotRosterItem }

const COLOR: Record<string, string> = {
  violet: 'bg-violet-400',
  sky: 'bg-sky-400',
  amber: 'bg-amber-400',
  emerald: 'bg-emerald-400',
  rose: 'bg-rose-400',
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
            className={`relative grid h-11 w-11 place-items-center rounded-lg xl:h-10 xl:w-10 ${
              bot.id === activeBotId ? 'bg-primary/14 text-primary' : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.07]'
            }`}
          >
            <span aria-hidden="true" className={`absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${COLOR[bot.colorKey ?? ''] ?? 'bg-primary'}`} />
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{bot.iconKey || 'smart_toy'}</span>
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
        const channelLabel = `${bot.channelCount} channel${bot.channelCount === 1 ? '' : 's'}`
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
              title={bot.lastChannelTitle ? `${bot.role} · ${bot.lastChannelTitle}` : bot.role}
              onClick={() => onSelectBot(bot.id)}
              className="flex h-9 min-w-0 w-full items-center gap-2 py-1 pl-2 pr-16 text-left xl:pr-12"
            >
              <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${COLOR[bot.colorKey ?? ''] ?? 'bg-primary'}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold leading-4 text-[var(--color-pib-text)]">{bot.name}</span>
                <span className="block truncate text-[10px] leading-3 text-[var(--color-pib-text-muted)]">{bot.role}</span>
              </span>
              <span className="shrink-0 font-mono text-[10px] text-[var(--color-pib-text-muted)]/80">{channelLabel}</span>
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
