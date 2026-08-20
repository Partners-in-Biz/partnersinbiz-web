'use client'

import { BOT_MODE_COPY } from '@/lib/messages/experience-mode'

export type BotPluginSkill = {
  token: string
  label: string
  icon?: string
}

export function BotRailDock({
  userName,
  pluginsOpen,
  onTogglePlugins,
  inboxCount,
  channelsCount,
  skills,
  computersHref,
  approvalsHref,
  onOpenInbox,
  onOpenChannels,
  onOpenCanvas,
  onInsertSkill,
}: {
  userName: string
  pluginsOpen: boolean
  onTogglePlugins: () => void
  inboxCount: number
  channelsCount: number
  skills: BotPluginSkill[]
  computersHref: string
  approvalsHref: string
  onOpenInbox: () => void
  onOpenChannels: () => void
  onOpenCanvas: () => void
  onInsertSkill: (token: string) => void
}) {
  const initials = userName
    .split(/[\s.@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'You'

  return (
    <div data-testid="bot-rail-dock" className="relative shrink-0 border-t border-white/[0.08] pt-1">
      {pluginsOpen && (
        <div
          data-testid="bot-plugins-sheet"
          className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-[min(22rem,50vh)] overflow-y-auto rounded-lg border border-white/[0.1] bg-[#111] p-2 shadow-2xl"
        >
          <p className="px-1 pb-1.5 text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">{BOT_MODE_COPY.pluginsLabel}</p>
          <button type="button" data-testid="bot-plugin-inbox" onClick={onOpenInbox} className="flex h-8 w-full items-center justify-between rounded-md px-2 text-[12px] text-[var(--color-pib-text)] hover:bg-white/[0.06]">
            <span>Bot inbox</span>
            <span className="font-mono text-[10px] text-[var(--color-pib-text-muted)]">{inboxCount}</span>
          </button>
          <button type="button" data-testid="bot-plugin-channels" onClick={onOpenChannels} className="flex h-8 w-full items-center justify-between rounded-md px-2 text-[12px] text-[var(--color-pib-text)] hover:bg-white/[0.06]">
            <span>Channels</span>
            <span className="font-mono text-[10px] text-[var(--color-pib-text-muted)]">{channelsCount}</span>
          </button>
          <button type="button" data-testid="bot-plugin-canvas" onClick={onOpenCanvas} className="flex h-8 w-full items-center rounded-md px-2 text-[12px] text-[var(--color-pib-text)] hover:bg-white/[0.06]">
            Context canvas
          </button>
          <a data-testid="bot-plugin-approvals" href={approvalsHref} className="flex h-8 w-full items-center rounded-md px-2 text-[12px] text-[var(--color-pib-text)] hover:bg-white/[0.06]">
            Approvals
          </a>
          <a data-testid="bot-plugin-computers" href={computersHref} className="flex h-8 w-full items-center rounded-md px-2 text-[12px] text-[var(--color-pib-text)] hover:bg-white/[0.06]">
            Computers
          </a>
          <p className="mt-2 px-1 pb-1 text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Skills</p>
          {skills.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-[var(--color-pib-text-muted)]">Type / in the composer for skills.</p>
          ) : skills.slice(0, 8).map((skill) => (
            <button
              key={skill.token}
              type="button"
              data-testid={`bot-plugin-skill-${skill.token.replace(/^\//, '')}`}
              onClick={() => onInsertSkill(skill.token)}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-[var(--color-pib-text)] hover:bg-white/[0.06]"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[14px] text-[var(--color-pib-text-muted)]">{skill.icon || 'bolt'}</span>
              <span className="truncate">{skill.label}</span>
              <span className="ml-auto font-mono text-[10px] text-[var(--color-pib-text-muted)]">{skill.token}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 px-1 pb-1">
        <button
          type="button"
          data-testid="bot-plugins-toggle"
          aria-expanded={pluginsOpen}
          aria-label={BOT_MODE_COPY.pluginsLabel}
          onClick={onTogglePlugins}
          className={`flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-[12px] ${
            pluginsOpen ? 'bg-white/[0.08] text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.06] hover:text-[var(--color-pib-text)]'
          }`}
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">extension</span>
          {BOT_MODE_COPY.pluginsLabel}
        </button>
        <span
          data-testid="bot-rail-user"
          title={userName}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.08] text-[10px] font-semibold text-[var(--color-pib-text)]"
        >
          {initials}
        </span>
      </div>
    </div>
  )
}
