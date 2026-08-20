'use client'

import { BOT_MODE_COPY } from '@/lib/messages/experience-mode'

export interface BotRosterItem {
  id: string
  name: string
  role: string
  iconKey?: string
  colorKey?: string
  defaultModel?: string
  channelCount: number
  lastChannelTitle?: string | null
  onlineComputerCount: number
}

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
  compact = false,
}: {
  bots: BotRosterItem[]
  activeBotId?: string | null
  onSelectBot: (botId: string) => void
  onStartChannel?: (botId: string) => void
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
    <div data-testid="bot-roster" className="flex min-h-0 flex-col gap-1">
      <div className="flex items-center justify-between px-1 text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]/75">
        <span>{BOT_MODE_COPY.railLabel}</span>
        <span className="font-mono text-[10px] tracking-normal">{bots.length}</span>
      </div>
      {bots.length === 0 ? (
        <p className="px-2 py-3 text-xs text-[var(--color-pib-text-muted)]">No Bots are visible for this organisation yet.</p>
      ) : bots.map((bot) => {
        const selected = bot.id === activeBotId
        return (
          <article
            key={bot.id}
            data-testid={`bot-roster-card-${bot.id}`}
            className={`rounded-md border px-2 py-1.5 ${
              selected ? 'border-primary/35 bg-primary/[0.08]' : 'border-white/[0.06] bg-white/[0.025]'
            }`}
          >
            <div className="flex min-w-0 items-start gap-1">
              <button
                type="button"
                aria-label={`Open ${bot.name}`}
                aria-pressed={selected}
                onClick={() => onSelectBot(bot.id)}
                className="flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-white/[0.05] xl:min-h-0"
              >
                <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${COLOR[bot.colorKey ?? ''] ?? 'bg-primary'}`} />
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-semibold text-[var(--color-pib-text)]">{bot.name}</span>
                  <span className="mt-0.5 block truncate text-[10px] leading-4 text-[var(--color-pib-text-muted)]">{bot.role}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-[var(--color-pib-text-muted)]/80">
                    {bot.channelCount} channel{bot.channelCount === 1 ? '' : 's'}
                    {bot.onlineComputerCount > 0 ? ` · ${bot.onlineComputerCount} computer${bot.onlineComputerCount === 1 ? '' : 's'} online` : ''}
                    {bot.lastChannelTitle ? ` · ${bot.lastChannelTitle}` : ''}
                  </span>
                </span>
              </button>
              {onStartChannel && (
                <button
                  type="button"
                  aria-label={`Start channel with ${bot.name}`}
                  onClick={() => onStartChannel(bot.id)}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-primary xl:h-7 xl:w-7"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">add</span>
                </button>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}
