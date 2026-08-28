'use client'

import type { ReactNode } from 'react'
import { BotComputerStrip } from '@/components/messages/bot-mode/BotComputerStrip'
import type { VisibleBotComputer } from '@/lib/messages/bot-computers'
import type { WorkbenchTab } from '@/lib/messages/workbench/types'

const WORKBENCH_ACTIONS: Array<{ id: WorkbenchTab; label: string; icon: string }> = [
  { id: 'files', label: 'Files', icon: 'folder' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal' },
  { id: 'browser', label: 'Browser', icon: 'language' },
]

export function ConversationOverflowSheet({
  open,
  onClose,
  title,
  subtitle,
  connectionWhere,
  isCommandSession = false,
  canBindCommandSession = false,
  commandSessionBusy = false,
  onBindCommandSession,
  computers = [],
  computersHref,
  activeComputerId,
  isolatedFolder,
  browserProfileId,
  showAgentWorkbench = false,
  workbenchOpen = false,
  onOpenWorkbench,
  onToggleWorkbench,
  showInspect = false,
  onOpenInspect,
  modelControl,
  effortControl,
  approvalControl,
  runtimeStatus,
  queuedCount,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string | null
  subtitle?: string | null
  connectionWhere?: { display: string; online?: boolean | null } | null
  isCommandSession?: boolean
  canBindCommandSession?: boolean
  commandSessionBusy?: boolean
  onBindCommandSession?: () => void
  computers?: VisibleBotComputer[]
  computersHref?: string
  activeComputerId?: string | null
  isolatedFolder?: string | null
  browserProfileId?: string | null
  showAgentWorkbench?: boolean
  workbenchOpen?: boolean
  onOpenWorkbench?: (tab: WorkbenchTab) => void
  onToggleWorkbench?: () => void
  showInspect?: boolean
  onOpenInspect?: () => void
  modelControl?: ReactNode
  effortControl?: ReactNode
  approvalControl?: ReactNode
  runtimeStatus?: string | null
  queuedCount?: number
  children?: ReactNode
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/55 md:hidden" data-testid="conversation-overflow-backdrop">
      <button
        type="button"
        aria-label="Close conversation options"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Conversation options"
        data-testid="conversation-overflow-sheet"
        className="relative z-10 flex max-h-[min(88dvh,40rem)] flex-col overflow-hidden rounded-t-2xl border border-[var(--color-card-border)] bg-[var(--color-surface,#151515)] pb-[max(.75rem,env(safe-area-inset-bottom))]"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-card-border)] px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--color-pib-text)]">{title || 'Conversation'}</p>
            {subtitle && <p className="mt-0.5 truncate text-[11px] text-[var(--color-pib-text-muted)]">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label="Close conversation options"
            onClick={onClose}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--color-pib-text-muted)] hover:bg-white/[0.08]"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-3">
          {(isCommandSession || canBindCommandSession || connectionWhere) && (
            <section aria-label="Session" className="space-y-2">
              <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Session</p>
              {isCommandSession && (
                <span
                  data-testid="overflow-command-session-badge"
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200"
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">hub</span>
                  Command session
                </span>
              )}
              {canBindCommandSession && onBindCommandSession && (
                <button
                  type="button"
                  data-testid="overflow-bind-command-session"
                  disabled={commandSessionBusy}
                  onClick={() => { onBindCommandSession(); onClose() }}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 text-[12px] font-semibold text-[var(--color-pib-text)]"
                >
                  <span className="material-symbols-outlined text-[15px]" aria-hidden="true">link</span>
                  {commandSessionBusy ? 'Linking…' : 'Use as command session'}
                </button>
              )}
              {connectionWhere && (
                <p data-testid="overflow-connection-where" className="flex items-center gap-1.5 text-[12px] text-[var(--color-pib-text-muted)]">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      connectionWhere.online === true
                        ? 'bg-emerald-400'
                        : connectionWhere.online === false
                          ? 'bg-amber-400'
                          : 'bg-white/30'
                    }`}
                  />
                  {connectionWhere.display}
                </p>
              )}
            </section>
          )}

          {computersHref && (
            <section aria-label="Computers" className="space-y-2">
              <BotComputerStrip
                computers={computers}
                activeComputerId={activeComputerId}
                computersHref={computersHref}
                workbenchOpen={workbenchOpen}
                isolatedFolder={isolatedFolder}
                browserProfileId={browserProfileId}
                onOpenWorkbench={showAgentWorkbench ? (tab) => { onOpenWorkbench?.(tab); onClose() } : undefined}
                onToggleWorkbench={showAgentWorkbench ? () => { onToggleWorkbench?.(); onClose() } : undefined}
              />
            </section>
          )}

          {(showAgentWorkbench || showInspect) && (
            <section aria-label="Workbench" className="space-y-2">
              <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Tools</p>
              <div className="grid grid-cols-2 gap-2">
                {showAgentWorkbench && (
                  <button
                    type="button"
                    data-testid="overflow-workbench"
                    onClick={() => { onToggleWorkbench?.(); onClose() }}
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-card-border)] bg-white/[0.04] px-3 text-[12px] font-medium text-[var(--color-pib-text)]"
                  >
                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">dock_to_left</span>
                    Workbench
                  </button>
                )}
                {showInspect && (
                  <button
                    type="button"
                    data-testid="overflow-inspect"
                    onClick={() => { onOpenInspect?.(); onClose() }}
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-card-border)] bg-white/[0.04] px-3 text-[12px] font-medium text-[var(--color-pib-text)]"
                  >
                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">developer_board</span>
                    Inspect
                  </button>
                )}
                {showAgentWorkbench && WORKBENCH_ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    data-testid={`overflow-workbench-${action.id}`}
                    onClick={() => { onOpenWorkbench?.(action.id); onClose() }}
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-card-border)] bg-white/[0.04] px-3 text-[12px] font-medium text-[var(--color-pib-text)]"
                  >
                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{action.icon}</span>
                    {action.label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {(modelControl || effortControl || approvalControl || runtimeStatus || typeof queuedCount === 'number') && (
            <section aria-label="Runtime" className="space-y-2" data-testid="conversation-overflow-runtime">
              <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Runtime</p>
              {(runtimeStatus || typeof queuedCount === 'number') && (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--color-pib-text-muted)]">
                  {runtimeStatus && (
                    <span className="inline-flex h-7 items-center rounded-full border border-white/10 px-2">{runtimeStatus}</span>
                  )}
                  {typeof queuedCount === 'number' && (
                    <span className="inline-flex h-7 items-center rounded-full border border-white/10 px-2">{queuedCount} queued</span>
                  )}
                </div>
              )}
              {approvalControl}
              {modelControl}
              {effortControl}
            </section>
          )}

          {children}
        </div>
      </section>
    </div>
  )
}
