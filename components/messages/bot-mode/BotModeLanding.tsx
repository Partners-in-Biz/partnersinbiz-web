'use client'

import { BOT_MODE_COPY } from '@/lib/messages/experience-mode'
import type { BotRosterItem } from './BotRoster'
import type { VisibleBotComputer } from '@/lib/messages/bot-computers'
import { BotStudioPanel, type BotStudioDevice } from './BotStudioPanel'
import { PinnedBotStrip } from './PinnedBotStrip'

const CANVAS_SURFACES = ['Email', 'Invoice', 'Quote', 'Campaign', 'Social', 'Document', 'Design']

export function BotModeLanding({
  bots,
  computers,
  pinnedBotId = null,
  onOpenBot,
  onUnpinBot,
  onOpenBotSettings,
  onStartChannel,
  onOpenWorkbench,
  studioDevices = [],
  canCreateBot = false,
  creatingBot = false,
  importingBot = false,
  studioError = null,
  onCreateBot,
  onImportBot,
  defaultDeviceId = '',
  members = [],
}: {
  bots: BotRosterItem[]
  computers: VisibleBotComputer[]
  pinnedBotId?: string | null
  /** Opens the pinned bot's canonical chat (latest channel or a new one). */
  onOpenBot?: (botId: string) => void
  onUnpinBot?: (botId: string) => void
  onOpenBotSettings?: (botId: string) => void
  onStartChannel?: (botId: string) => void
  onOpenWorkbench?: () => void
  studioDevices?: BotStudioDevice[]
  canCreateBot?: boolean
  creatingBot?: boolean
  importingBot?: boolean
  studioError?: string | null
  onCreateBot?: (input: { name: string; role: string; persona: string; deviceId: string; agentHandle?: string; accessMode?: 'personal' | 'organization' | 'people'; sharedWithUserIds?: string[] }) => void
  onImportBot?: (input: { shareId: string; deviceId: string }) => void
  defaultDeviceId?: string
  members?: Array<{ uid: string; displayName?: string | null; email?: string | null }>
}) {
  const featured = bots.slice(0, 8)
  const onlineComputers = computers.filter((computer) => computer.online)
  const pinnedBot = pinnedBotId ? bots.find((bot) => bot.id === pinnedBotId) ?? null : null
  return (
    <div data-testid="bot-mode-landing" className="mx-auto flex max-w-3xl flex-col gap-6 px-2 py-6">
      {pinnedBot && onOpenBot ? (
        <div>
          <p className="mb-1 text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Pinned</p>
          <PinnedBotStrip bots={[pinnedBot]} onOpen={onOpenBot} onUnpin={onUnpinBot} onOpenSettings={onOpenBotSettings} />
        </div>
      ) : null}
      <div>
        <p className="pib-label text-primary">{BOT_MODE_COPY.landingEyebrow}</p>
        <h2 className="mt-1 text-xl font-medium text-[var(--color-pib-text)]">{BOT_MODE_COPY.landingTitle}</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-pib-text-muted)]">{BOT_MODE_COPY.landingBody}</p>
      </div>
      <div>
        <p className="mb-2 text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Explore bots</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {featured.length === 0 ? (
            <p className="text-sm text-[var(--color-pib-text-muted)]">No agents on this computer yet. Create one below or pick another machine.</p>
          ) : featured.map((bot) => (
            <button
              key={bot.id}
              type="button"
              data-testid={`bot-landing-card-${bot.id}`}
              onClick={() => onStartChannel?.(bot.id)}
              className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3 text-left hover:border-primary/30 hover:bg-primary/[0.06]"
            >
              <span className="block text-sm font-medium text-[var(--color-pib-text)]">{bot.name}</span>
              <span className="mt-1 block text-xs text-[var(--color-pib-text-muted)]">{bot.role}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <article className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3">
          <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Computers</p>
          <p className="mt-1 text-sm text-[var(--color-pib-text)]">
            {onlineComputers.length} online · {computers.length} paired
          </p>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Each Bot works in its own folder and browser profile on the linked computer or VPS.</p>
          {onOpenWorkbench && (
            <button
              type="button"
              onClick={onOpenWorkbench}
              className="mt-3 inline-flex h-11 items-center rounded-md border border-[var(--color-pib-line)] px-3 text-xs text-[var(--color-pib-text)] hover:bg-[var(--color-pib-surface-muted)] xl:h-8"
            >
              Show computers
            </button>
          )}
        </article>
        <article className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3">
          <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Intelligent canvas</p>
          <p className="mt-1 text-sm text-[var(--color-pib-text)]">Review work as a surface, not a dump.</p>
          <p className="mt-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">
            {CANVAS_SURFACES.join(' · ')}
          </p>
        </article>
      </div>
      {(onCreateBot || onImportBot) && (
        <BotStudioPanel
          devices={studioDevices}
          defaultDeviceId={defaultDeviceId}
          members={members}
          canCreate={canCreateBot}
          creating={creatingBot}
          importing={importingBot}
          error={studioError}
          onCreateBot={onCreateBot}
          onImportBot={onImportBot}
        />
      )}
    </div>
  )
}
