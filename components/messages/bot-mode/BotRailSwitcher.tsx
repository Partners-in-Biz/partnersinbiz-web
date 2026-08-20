'use client'

import { BOT_MODE_COPY } from '@/lib/messages/experience-mode'

export type BotRailSection = 'bots' | 'inbox' | 'channels'

const TABS: Array<{ id: BotRailSection; label: string }> = [
  { id: 'bots', label: BOT_MODE_COPY.railLabel },
  { id: 'inbox', label: BOT_MODE_COPY.inboxLabel },
  { id: 'channels', label: BOT_MODE_COPY.channelsLabel },
]

export function BotRailSwitcher({
  value,
  onChange,
  botsCount,
  inboxCount,
  channelsCount,
}: {
  value: BotRailSection
  onChange: (section: BotRailSection) => void
  botsCount: number
  inboxCount: number
  channelsCount: number
}) {
  const counts: Record<BotRailSection, number> = {
    bots: botsCount,
    inbox: inboxCount,
    channels: channelsCount,
  }

  return (
    <div
      role="tablist"
      aria-label="Bot mode lists"
      data-testid="bot-rail-switcher"
      className="grid grid-cols-3 gap-0.5 rounded-md border border-white/[0.08] bg-black/20 p-0.5"
    >
      {TABS.map((tab) => {
        const selected = tab.id === value
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`bot-rail-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={`flex h-8 min-w-0 items-center justify-center gap-1 rounded px-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${
              selected
                ? 'bg-white/[0.1] text-[var(--color-pib-text)]'
                : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]'
            }`}
          >
            <span className="truncate">{tab.label}</span>
            <span className="font-mono text-[10px] font-medium tracking-normal text-[var(--color-pib-text-muted)]">{counts[tab.id]}</span>
          </button>
        )
      })}
    </div>
  )
}
