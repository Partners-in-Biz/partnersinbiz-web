'use client'

import type { WorkbenchTab } from '@/lib/messages/workbench/types'
import type { VisibleBotComputer } from '@/lib/messages/bot-computers'
import { BOT_MODE_COPY } from '@/lib/messages/experience-mode'

const WORKBENCH_TABS: Array<{ id: WorkbenchTab; label: string; icon: string }> = [
  { id: 'files', label: 'Files', icon: 'folder' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal' },
  { id: 'browser', label: 'Browser', icon: 'language' },
  { id: 'changes', label: 'Changes', icon: 'difference' },
]

export function BotComputerStrip({
  computers,
  activeComputerId,
  computersHref = '/portal/settings/linked-computers',
  workbenchOpen = false,
  isolatedFolder = null,
  browserProfileId = null,
  onOpenWorkbench,
  onToggleWorkbench,
  className,
}: {
  computers: VisibleBotComputer[]
  activeComputerId?: string | null
  computersHref?: string
  workbenchOpen?: boolean
  isolatedFolder?: string | null
  browserProfileId?: string | null
  onOpenWorkbench?: (tab: WorkbenchTab) => void
  onToggleWorkbench?: () => void
  className?: string
}) {
  const onlineCount = computers.filter((computer) => computer.online).length
  return (
    <section
      data-testid="bot-computer-strip"
      aria-label={BOT_MODE_COPY.computersLabel}
      className={['flex min-h-11 shrink-0 items-center gap-2 overflow-x-auto border-b border-[var(--color-card-border)] bg-black/[0.12] px-3 py-1.5 [scrollbar-width:thin]', className].filter(Boolean).join(' ')}
    >
      <span className="inline-flex items-center gap-1 text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">
        <span aria-hidden="true" className="material-symbols-outlined text-[14px]">computer</span>
        {BOT_MODE_COPY.computersLabel}
      </span>
      {computers.length === 0 ? (
        <p className="text-[11px] text-[var(--color-pib-text-muted)]">No computers paired yet.</p>
      ) : computers.map((computer) => {
        const active = computer.id === activeComputerId
        return (
          <span
            key={computer.id}
            data-testid={`bot-computer-${computer.id}`}
            className={`inline-flex h-11 max-w-[220px] items-center gap-1.5 rounded-lg border px-2.5 text-[11px] xl:h-8 ${
              active
                ? 'border-primary/40 bg-primary/12 text-[var(--color-pib-text)]'
                : 'border-white/[0.08] bg-white/[0.04] text-[var(--color-pib-text-muted)]'
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${computer.online ? 'bg-emerald-300' : 'bg-amber-300'}`}
            />
            <span className="min-w-0 truncate">
              {computer.kind === 'vps' ? 'VPS' : 'Computer'} · {computer.label}
            </span>
            <span className="sr-only">{computer.online ? 'online' : 'unavailable'}</span>
          </span>
        )
      })}
      {isolatedFolder && (
        <span data-testid="bot-isolated-folder" className="inline-flex h-11 max-w-[260px] items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 text-[11px] text-[var(--color-pib-text-muted)] xl:h-8">
          <span aria-hidden="true" className="material-symbols-outlined text-[14px]">folder_managed</span>
          <span className="min-w-0 truncate">{isolatedFolder}</span>
          {browserProfileId ? <span className="hidden truncate sm:inline">· {browserProfileId}</span> : null}
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {onOpenWorkbench && WORKBENCH_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-label={`Open ${tab.label} on the computer`}
            onClick={() => onOpenWorkbench(tab.id)}
            className="grid h-11 w-11 place-items-center rounded-md text-[var(--color-pib-text-muted)] hover:bg-white/[0.07] hover:text-[var(--color-pib-text)] xl:h-8 xl:w-8"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{tab.icon}</span>
          </button>
        ))}
        {onToggleWorkbench && (
          <button
            type="button"
            aria-label={workbenchOpen ? 'Hide computer workbench' : 'Show computer workbench'}
            aria-pressed={workbenchOpen}
            onClick={onToggleWorkbench}
            className="inline-flex h-11 items-center gap-1 rounded-md border border-white/[0.1] px-2 text-[11px] text-[var(--color-pib-text)] hover:bg-white/[0.06] xl:h-8"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[15px]">dock_to_left</span>
            Workbench
          </button>
        )}
        <a
          href={computersHref}
          className="inline-flex h-11 items-center rounded-md px-2 text-[11px] text-primary hover:bg-primary/10 xl:h-8"
        >
          {onlineCount}/{computers.length || 0} online
        </a>
      </span>
    </section>
  )
}
