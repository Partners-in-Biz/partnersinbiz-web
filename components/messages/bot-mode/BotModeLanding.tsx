'use client'

import { BOT_MODE_COPY } from '@/lib/messages/experience-mode'
import type { BotRosterItem } from './BotRoster'
import type { VisibleBotComputer } from '@/lib/messages/bot-computers'

const CANVAS_SURFACES = ['Email', 'Invoice', 'Quote', 'Campaign', 'Social', 'Document', 'Design']

export function BotModeLanding({
  bots,
  computers,
  onStartChannel,
  onOpenWorkbench,
}: {
  bots: BotRosterItem[]
  computers: VisibleBotComputer[]
  onStartChannel?: (botId: string) => void
  onOpenWorkbench?: () => void
}) {
  const featured = bots.slice(0, 8)
  const onlineComputers = computers.filter((computer) => computer.online)
  return (
    <div data-testid="bot-mode-landing" className="mx-auto flex max-w-3xl flex-col gap-6 px-2 py-6">
      <div>
        <p className="pib-label text-primary">{BOT_MODE_COPY.landingEyebrow}</p>
        <h2 className="mt-1 text-xl font-semibold text-[var(--color-pib-text)]">{BOT_MODE_COPY.landingTitle}</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-pib-text-muted)]">{BOT_MODE_COPY.landingBody}</p>
      </div>
      <div>
        <p className="mb-2 text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Explore bots</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {featured.length === 0 ? (
            <p className="text-sm text-[var(--color-pib-text-muted)]">No Bots are visible yet.</p>
          ) : featured.map((bot) => (
            <button
              key={bot.id}
              type="button"
              data-testid={`bot-landing-card-${bot.id}`}
              onClick={() => onStartChannel?.(bot.id)}
              className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-left hover:border-primary/30 hover:bg-primary/[0.06]"
            >
              <span className="block text-sm font-semibold text-[var(--color-pib-text)]">{bot.name}</span>
              <span className="mt-1 block text-xs text-[var(--color-pib-text-muted)]">{bot.role}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <article className="rounded-lg border border-white/[0.08] bg-black/20 p-3">
          <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Computers</p>
          <p className="mt-1 text-sm text-[var(--color-pib-text)]">
            {onlineComputers.length} online · {computers.length} paired
          </p>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Watch files, terminal, and browser beside the channel.</p>
          {onOpenWorkbench && (
            <button
              type="button"
              onClick={onOpenWorkbench}
              className="mt-3 inline-flex h-11 items-center rounded-md border border-white/[0.1] px-3 text-xs text-[var(--color-pib-text)] hover:bg-white/[0.06] xl:h-8"
            >
              Show computers
            </button>
          )}
        </article>
        <article className="rounded-lg border border-white/[0.08] bg-black/20 p-3">
          <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Intelligent canvas</p>
          <p className="mt-1 text-sm text-[var(--color-pib-text)]">Review work as a surface, not a dump.</p>
          <p className="mt-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">
            {CANVAS_SURFACES.join(' · ')}
          </p>
        </article>
      </div>
    </div>
  )
}
