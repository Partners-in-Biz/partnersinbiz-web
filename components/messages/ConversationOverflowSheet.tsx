'use client'

import type { ReactNode } from 'react'
import { MessagesExperienceSwitch } from '@/components/messages/bot-mode/MessagesExperienceSwitch'
import { BotComputerStrip } from '@/components/messages/bot-mode/BotComputerStrip'
import type { VisibleBotComputer } from '@/lib/messages/bot-computers'
import type { MessagesExperienceMode } from '@/lib/messages/experience-mode'
import type { WorkbenchTab } from '@/lib/messages/workbench/types'
import { Icon } from '@/components/studio'

const WORKBENCH_ACTIONS: Array<{ id: WorkbenchTab; label: string; icon: string }> = [
  { id: 'files', label: 'Files', icon: 'folder' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal' },
  { id: 'browser', label: 'Browser', icon: 'language' },
]

export type OverflowDesignCommand = {
  id: string
  token: string
  label: string
  description?: string
  icon: string
}

const ACTION_BUTTON_CLASS =
  'inline-flex min-h-11 w-full items-center gap-2 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-3 text-left text-[12px] font-medium text-[var(--color-pib-text)]'

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
  experienceMode,
  onExperienceModeChange,
  designCommands,
  onDesignCommand,
  conversationActions,
  deskPanel,
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
  experienceMode?: MessagesExperienceMode
  onExperienceModeChange?: (mode: MessagesExperienceMode) => void
  designCommands?: OverflowDesignCommand[]
  onDesignCommand?: (command: OverflowDesignCommand) => void
  conversationActions?: ReactNode
  /** Bot mode desk (screen + routines) for phone overflow */
  deskPanel?: ReactNode
  children?: ReactNode
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-[var(--color-pib-surface-muted)]5 md:hidden" data-testid="conversation-overflow-backdrop">
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
            <p className="truncate text-sm font-medium text-[var(--color-pib-text)]">{title || 'Conversation'}</p>
            {subtitle && <p className="mt-0.5 truncate text-[11px] text-[var(--color-pib-text-muted)]">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label="Close conversation options"
            onClick={onClose}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)]"
          >
            <Icon name="close" className="text-[20px]" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-3">
          {experienceMode && onExperienceModeChange && (
            <section aria-label="Experience" data-testid="overflow-experience-switch" className="space-y-2">
              <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Experience</p>
              <MessagesExperienceSwitch
                value={experienceMode}
                onChange={(mode) => { onExperienceModeChange(mode); onClose() }}
                showLabels
              />
            </section>
          )}

          {conversationActions && (
            <section aria-label="Conversation" data-testid="overflow-conversation-actions" className="space-y-2">
              <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Conversation</p>
              <div className="grid gap-2">{conversationActions}</div>
            </section>
          )}

          {designCommands && designCommands.length > 0 && onDesignCommand && (
            <section aria-label="Design commands" data-testid="overflow-design-commands" className="space-y-2">
              <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Design commands</p>
              <div className="grid gap-2">
                {designCommands.map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    data-testid={`overflow-design-command-${command.id}`}
                    aria-label={`Insert ${command.token}`}
                    onClick={() => { onDesignCommand(command); onClose() }}
                    className={ACTION_BUTTON_CLASS}
                  >
                    <Icon name={command.icon} className="text-[16px]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{command.label}</span>
                      <span className="block truncate text-[11px] text-[var(--color-pib-text-muted)]">{command.token}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {(isCommandSession || canBindCommandSession || connectionWhere) && (
            <section aria-label="Session" className="space-y-2">
              <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Session</p>
              {isCommandSession && (
                <span
                  data-testid="overflow-command-session-badge"
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200"
                >
                  <Icon name="hub" className="text-[14px]" />
                  Command session
                </span>
              )}
              {canBindCommandSession && onBindCommandSession && (
                <button
                  type="button"
                  data-testid="overflow-bind-command-session"
                  disabled={commandSessionBusy}
                  onClick={() => { onBindCommandSession(); onClose() }}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] px-3 text-[12px] font-medium text-[var(--color-pib-text)]"
                >
                  <Icon name="link" className="text-[15px]" />
                  {commandSessionBusy ? 'Linking…' : 'Use as command session'}
                </button>
              )}
              {connectionWhere && (
                <p data-testid="overflow-connection-where" className="flex items-center gap-1.5 text-[12px] text-[var(--color-pib-text-muted)]">
                  <span
                    className={`h-1.5 w-1.5 ${ connectionWhere.online === true ? 'bg-emerald-400' : connectionWhere.online === false ? 'bg-[color-mix(in_srgb,var(--st-warning)_12%,transparent)]' : 'bg-[color-mix(in_srgb,var(--color-pib-text)_30%,transparent)]' }`} style={{ borderRadius: '50%' }}
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

          {deskPanel && (
            <section aria-label="Desk" data-testid="overflow-desk-panel" className="space-y-2">
              <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Desk</p>
              {deskPanel}
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
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-3 text-[12px] font-medium text-[var(--color-pib-text)]"
                  >
                    <Icon name="dock_to_left" className="text-[16px]" />
                    Workbench
                  </button>
                )}
                {showInspect && (
                  <button
                    type="button"
                    data-testid="overflow-inspect"
                    onClick={() => { onOpenInspect?.(); onClose() }}
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-3 text-[12px] font-medium text-[var(--color-pib-text)]"
                  >
                    <Icon name="developer_board" className="text-[16px]" />
                    Inspect
                  </button>
                )}
                {showAgentWorkbench && WORKBENCH_ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    data-testid={`overflow-workbench-${action.id}`}
                    onClick={() => { onOpenWorkbench?.(action.id); onClose() }}
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-3 text-[12px] font-medium text-[var(--color-pib-text)]"
                  >
                    <Icon name={action.icon} className="text-[16px]" />
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
                    <span className="inline-flex h-7 items-center rounded-md border border-[var(--color-pib-line)] px-2">{runtimeStatus}</span>
                  )}
                  {typeof queuedCount === 'number' && (
                    <span className="inline-flex h-7 items-center rounded-md border border-[var(--color-pib-line)] px-2">{queuedCount} queued</span>
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
