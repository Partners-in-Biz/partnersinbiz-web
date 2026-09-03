'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/studio'
import type {
  WorkbenchBrowserSessionViewState,
  WorkbenchBrowserTarget,
  WorkbenchChangeFile,
  WorkbenchFileNode,
  WorkbenchFilePreview,
  WorkbenchFilesSource,
  WorkbenchRuntimeSummary,
  WorkbenchSessionViewState,
  WorkbenchTab,
  WorkbenchTerminalEntry,
  WorkbenchTerminalMode,
  WorkbenchTunnelViewState,
} from '@/lib/messages/workbench/types'
import { shouldRenderClosedWorkbenchIconStrip } from '@/lib/messages/mobile-conversation-chrome'
import { WorkbenchBrowserPanel } from './WorkbenchBrowserPanel'
import { WorkbenchChangesPanel } from './WorkbenchChangesPanel'
import { WorkbenchFilesPanel } from './WorkbenchFilesPanel'
import { WorkbenchTerminalPanel } from './WorkbenchTerminalPanel'

/**
 * Panel content width, in px, excluding the fixed-width icon strip. Mirrors
 * the resize pattern used by `ContextDock` (see CONTEXT_CANVAS_MIN/MAX_WIDTH).
 */
export const WORKBENCH_MIN_WIDTH = 420
export const WORKBENCH_MAX_WIDTH = 720
export const WORKBENCH_DEFAULT_WIDTH = 480

const ICON_STRIP_WIDTH = 40

function clampWorkbenchWidth(width: number): number {
  return Math.min(WORKBENCH_MAX_WIDTH, Math.max(WORKBENCH_MIN_WIDTH, width))
}

const TABS: Array<{ id: WorkbenchTab; icon: string; label: string }> = [
  { id: 'files', icon: 'folder', label: 'Files' },
  { id: 'terminal', icon: 'terminal', label: 'Terminal' },
  { id: 'browser', icon: 'language', label: 'Browser' },
  { id: 'changes', icon: 'difference', label: 'Changes' },
]

function badgeCount(count: number): string | null {
  if (count <= 0) return null
  return count > 99 ? '99+' : String(count)
}

function useIsMobileViewport(): boolean {
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023px)').matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width: 1023px)')
    const update = () => setMobile(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])
  return mobile
}

export interface AgentWorkbenchRailProps {
  open: boolean
  activeTab: WorkbenchTab | null
  onOpenChange: (open: boolean) => void
  onTabChange: (tab: WorkbenchTab | null) => void
  width?: number
  onWidthChange?: (width: number) => void
  runtime?: WorkbenchRuntimeSummary
  terminalEntries: WorkbenchTerminalEntry[]
  /** Phase 1 event-derived tree - used whenever no sync tree is available. */
  fileTree: WorkbenchFileNode[]
  /** Phase 2a sync-backed tree (project-sync manifest). Preferred over `fileTree` when non-empty. */
  liveFileTree?: WorkbenchFileNode[]
  /** Where `liveFileTree`/`fileTree` came from, for a small source hint in the header. */
  filesSource?: WorkbenchFilesSource
  filesLoading?: boolean
  filesMessage?: string | null
  onRefreshFiles?: () => void
  selectedFilePath?: string | null
  onSelectFilePath?: (path: string) => void
  onExpandDirectory?: (path: string) => void
  filePreview?: WorkbenchFilePreview | null
  onSaveFile?: (path: string, content: string, expectedSha256?: string) => Promise<{ sha256?: string } | void>
  changes: WorkbenchChangeFile[]
  changesMessage?: string | null
  changesLoading?: boolean
  /** Where `changes` came from - drives the Changes tab's source badge/banner. */
  changesSource?: 'live' | 'events' | 'none'
  onRefreshChanges?: () => void
  browserTargets: WorkbenchBrowserTarget[]
  /** Adds a Browser Design Mode note to the active chat composer without sending it. */
  onAddBrowserNoteToChat?: (text: string) => void
  /** Current tunnel session state (Phase 4b), owned by the host. */
  browserTunnel?: WorkbenchTunnelViewState | null
  onStartBrowserTunnel?: (port: number) => void
  onApproveBrowserTunnel?: () => void
  onKillBrowserTunnel?: () => void
  /** Current agent browser session state (Phase 4b), owned by the host. */
  browserAgentSession?: WorkbenchBrowserSessionViewState | null
  onStartBrowserAgentSession?: (startUrl?: string) => void
  onApproveBrowserAgentSession?: () => void
  onNavigateBrowserAgentSession?: (url: string) => void
  onCaptureBrowserAgentSession?: () => void
  onKillBrowserAgentSession?: () => void
  /** Design Mode drive (Phase 5): clicks/types in the agent browser at a point given in percent of the current frame. */
  onClickBrowserAgentSessionAt?: (xPct: number, yPct: number) => void
  onTypeBrowserAgentSession?: (text: string) => void
  /** Toggles device-side frame following for the agent browser session. */
  onStartBrowserAgentSessionFollow?: () => void
  onStopBrowserAgentSessionFollow?: () => void
  /** Slice-2 arbitration: the human explicitly takes the wheel from the agent. */
  onTakeControlBrowserAgentSession?: () => void
  /** Human-only toggle: allow the agent to reach private/internal hosts on this session. */
  onToggleAllowPrivateBrowserAgentSession?: () => void
  /** Requests a fresh accessibility snapshot for the Agent view (the text the agent sees). */
  onRefreshBrowserAgentSnapshot?: () => void
  /** Latest accessibility snapshot text for the Agent view; null until the first refresh. */
  browserAgentSnapshotText?: string | null
  browserAgentSnapshotLoading?: boolean
  compact?: boolean
  /** Runs an allowlisted terminal command (git status/diff, ls, pwd) against the linked computer. */
  onRunTerminalCommand?: (command: string) => void
  /** Clears locally-run terminal entries (SSE observer entries remain). */
  onClearTerminal?: () => void
  /** True while a terminal command is in flight - disables the command bar. */
  terminalRunning?: boolean
  /** Locally-tracked terminal entries for commands run from this panel, merged after `terminalEntries`. */
  localTerminalEntries?: WorkbenchTerminalEntry[]
  /** Jobs vs. interactive Session mode for the Terminal tab (Phase 3b). Defaults to uncontrolled 'jobs'. */
  terminalMode?: WorkbenchTerminalMode
  onTerminalModeChange?: (mode: WorkbenchTerminalMode) => void
  /** Current interactive session state, owned by the host (e.g. `UnifiedChat`). */
  terminalSession?: WorkbenchSessionViewState | null
  terminalSessions?: WorkbenchSessionViewState[]
  onSelectTerminalSession?: (sessionId: string) => void
  onStartTerminalSession?: () => void
  /** Approves a terminal session currently `awaiting_approval` (Phase 5). */
  onApproveTerminalSession?: () => void
  onSendTerminalSessionInput?: (line: string) => void
  /** Raw keystrokes from the xterm surface, written with stdin `mode: 'raw'`. */
  onSendTerminalSessionData?: (data: string) => void
  /** Fitted xterm grid size, forwarded to the remote pty resize control. */
  onResizeTerminalSession?: (cols: number, rows: number) => void
  onKillTerminalSession?: () => void
}

const FILES_SOURCE_LABEL: Record<WorkbenchFilesSource, string> = {
  sync: 'Synced',
  events: 'From activity',
  none: '',
}

const CHANGES_SOURCE_LABEL: Record<'live' | 'events' | 'none', string> = {
  live: 'Live',
  events: 'From activity',
  none: '',
}

/**
 * Cursor-like agent workbench: a vertical icon strip docked to the far right
 * edge (Files / Terminal / Browser / Changes) that expands into a resizable
 * panel when a tab is selected. The parent container must be `position:
 * relative` - this component renders `absolute inset-y-0 right-0`.
 *
 * Wired by `UnifiedChat` as a controlled, conversation-scoped observer panel.
 */
export function AgentWorkbenchRail({
  open,
  activeTab,
  onOpenChange,
  onTabChange,
  width = WORKBENCH_DEFAULT_WIDTH,
  onWidthChange,
  runtime,
  terminalEntries,
  fileTree,
  liveFileTree,
  filesSource = 'events',
  filesLoading = false,
  filesMessage,
  onRefreshFiles,
  selectedFilePath,
  onSelectFilePath,
  onExpandDirectory,
  filePreview,
  onSaveFile,
  changes,
  changesMessage,
  changesLoading = false,
  changesSource = 'none',
  onRefreshChanges,
  browserTargets,
  onAddBrowserNoteToChat,
  browserTunnel,
  onStartBrowserTunnel,
  onApproveBrowserTunnel,
  onKillBrowserTunnel,
  browserAgentSession,
  onStartBrowserAgentSession,
  onApproveBrowserAgentSession,
  onNavigateBrowserAgentSession,
  onCaptureBrowserAgentSession,
  onKillBrowserAgentSession,
  onClickBrowserAgentSessionAt,
  onTypeBrowserAgentSession,
  onStartBrowserAgentSessionFollow,
  onStopBrowserAgentSessionFollow,
  onTakeControlBrowserAgentSession,
  onToggleAllowPrivateBrowserAgentSession,
  onRefreshBrowserAgentSnapshot,
  browserAgentSnapshotText,
  browserAgentSnapshotLoading,
  compact = false,
  onRunTerminalCommand,
  onClearTerminal,
  terminalRunning = false,
  localTerminalEntries,
  terminalMode,
  onTerminalModeChange,
  terminalSession,
  terminalSessions,
  onSelectTerminalSession,
  onStartTerminalSession,
  onApproveTerminalSession,
  onSendTerminalSessionInput,
  onSendTerminalSessionData,
  onResizeTerminalSession,
  onKillTerminalSession,
}: AgentWorkbenchRailProps) {
  const mobileViewport = useIsMobileViewport()
  const sheet = compact || mobileViewport
  const resizeRef = useRef<{ x: number; width: number } | null>(null)
  const clampedWidth = clampWorkbenchWidth(width)

  const effectiveFileTree = useMemo(
    () => (liveFileTree && liveFileTree.length > 0 ? liveFileTree : fileTree),
    [liveFileTree, fileTree],
  )

  const mergedTerminalEntries = useMemo(
    () => (localTerminalEntries && localTerminalEntries.length > 0 ? [...terminalEntries, ...localTerminalEntries] : terminalEntries),
    [terminalEntries, localTerminalEntries],
  )

  const counts: Record<WorkbenchTab, number> = {
    files: effectiveFileTree.length,
    terminal: mergedTerminalEntries.length,
    browser: browserTargets.length,
    changes: changes.length,
  }

  const openPathInFiles = (path: string) => {
    onSelectFilePath?.(path)
    onTabChange('files')
    onOpenChange(true)
  }

  const selectTab = (tab: WorkbenchTab) => {
    if (open && activeTab === tab) {
      onOpenChange(false)
      return
    }
    onTabChange(tab)
    onOpenChange(true)
  }

  const close = () => {
    onOpenChange(false)
  }

  const clampResize = (nextWidth: number) => onWidthChange?.(clampWorkbenchWidth(nextWidth))

  const iconStrip = (
    <div
      data-testid="agent-workbench-icon-strip"
      className="flex w-10 shrink-0 flex-col items-center gap-1 border-l border-[var(--color-card-border)] bg-[var(--color-surface,#151515)] py-2"
    >
      {TABS.map((tab) => {
        const isActive = open && activeTab === tab.id
        const count = badgeCount(counts[tab.id])
        return (
          <button
            key={tab.id}
            type="button"
            data-testid={`agent-workbench-tab-${tab.id}`}
            aria-label={tab.label}
            aria-pressed={isActive}
            title={tab.label}
            onClick={() => selectTab(tab.id)}
            className={[
              'relative grid h-9 w-9 shrink-0 place-items-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/60',
              isActive
                ? 'bg-primary/15 text-primary'
                : 'text-[var(--color-pib-text-muted)] hover:bg-[var(--color-pib-surface-muted)] hover:text-[var(--color-pib-text)]',
            ].join(' ')}
          >
            <Icon name={tab.icon} className="text-[19px]" />
            {count && (
              <span
                aria-hidden="true"
                className="absolute -right-1 -top-1 min-w-[15px] rounded-md bg-primary px-1 text-center text-[9px] font-medium leading-[15px] text-black"
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )

  if (shouldRenderClosedWorkbenchIconStrip({ open })) {
    return (
      <div data-testid="agent-workbench-rail" data-open="false" className="absolute inset-y-0 right-0 z-30 hidden md:flex">
        {iconStrip}
      </div>
    )
  }

  const activeTabMeta = TABS.find((tab) => tab.id === activeTab) ?? TABS[0]

  const runtimeStrip = runtime && (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--color-pib-text-muted)]">
      {runtime.hasMapping ? (
        <>
          {runtime.label && <span className="truncate">{runtime.label}</span>}
          {runtime.mappingLabel && (
            <span className="rounded-md border border-[var(--color-card-border)] px-1.5 py-0.5">{runtime.mappingLabel}</span>
          )}
          {runtime.projectName && (
            <span className="rounded-md border border-[var(--color-card-border)] px-1.5 py-0.5">{runtime.projectName}</span>
          )}
          {runtime.folderScope && <span className="truncate font-mono">{runtime.folderScope}</span>}
        </>
      ) : (
        <span>No workspace mapping - showing activity derived from tool calls only.</span>
      )}
    </div>
  )

  const panelBody = (
    <>
      <header className="shrink-0 border-b border-[var(--color-card-border)] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Icon name={activeTabMeta.icon} className="text-[16px] text-primary" />
            <p className="truncate text-xs font-medium text-[var(--color-pib-text)]">{activeTabMeta.label}</p>
            {activeTabMeta.id === 'files' && filesSource !== 'none' && (
              <span className="shrink-0 rounded-md border border-[var(--color-card-border)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                {FILES_SOURCE_LABEL[filesSource]}
              </span>
            )}
            {activeTabMeta.id === 'changes' && changesSource !== 'none' && (
              <span
                className={[
                  'shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] uppercase tracking-wide',
                  changesSource === 'live'
                    ? 'border-emerald-400/30 text-emerald-300'
                    : 'border-[var(--color-card-border)] text-[var(--color-pib-text-muted)]',
                ].join(' ')}
              >
                {CHANGES_SOURCE_LABEL[changesSource]}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {activeTabMeta.id === 'files' && onRefreshFiles && (
              <button
                type="button"
                aria-label="Refresh files"
                onClick={onRefreshFiles}
                disabled={filesLoading}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)] disabled:opacity-50"
              >
                <Icon name="refresh" className={`text-[15px] ${filesLoading ? 'animate-spin' : ''}`} />
              </button>
            )}
            {activeTabMeta.id === 'changes' && onRefreshChanges && (
              <button
                type="button"
                aria-label="Refresh changes"
                onClick={onRefreshChanges}
                disabled={changesLoading}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)] disabled:opacity-50"
              >
                <Icon name="refresh" className={`text-[15px] ${changesLoading ? 'animate-spin' : ''}`} />
              </button>
            )}
            <button
              type="button"
              aria-label="Close workbench"
              onClick={close}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)]"
            >
              <Icon name="close" className="text-[16px]" />
            </button>
          </div>
        </div>
        {runtimeStrip}
      </header>
      <div data-testid="agent-workbench-panel-body" className="min-h-0 flex-1 overflow-hidden">
        {activeTabMeta.id === 'files' && (
          <WorkbenchFilesPanel
            tree={effectiveFileTree}
            message={filesMessage}
            selectedPath={selectedFilePath}
            onSelectPath={onSelectFilePath}
            onExpandDirectory={onExpandDirectory}
            preview={filePreview}
            onSave={onSaveFile}
          />
        )}
        {activeTabMeta.id === 'terminal' && (
          <WorkbenchTerminalPanel
            entries={mergedTerminalEntries}
            onRunCommand={onRunTerminalCommand}
            onClear={onClearTerminal}
            running={terminalRunning}
            mode={terminalMode}
            onModeChange={onTerminalModeChange}
            session={terminalSession}
            terminalSessions={terminalSessions}
            onSelectSession={onSelectTerminalSession}
            onStartSession={onStartTerminalSession}
            onApproveSession={onApproveTerminalSession}
            onSendSessionInput={onSendTerminalSessionInput}
            onSendSessionData={onSendTerminalSessionData}
            onResizeSession={onResizeTerminalSession}
            onKillSession={onKillTerminalSession}
          />
        )}
        {activeTabMeta.id === 'browser' && (
          <WorkbenchBrowserPanel
            targets={browserTargets}
            onAddToChat={onAddBrowserNoteToChat}
            tunnel={browserTunnel}
            onStartTunnel={onStartBrowserTunnel}
            onApproveTunnel={onApproveBrowserTunnel}
            onKillTunnel={onKillBrowserTunnel}
            browserSession={browserAgentSession}
            onStartBrowserSession={onStartBrowserAgentSession}
            onApproveBrowserSession={onApproveBrowserAgentSession}
            onNavigateBrowserSession={onNavigateBrowserAgentSession}
            onCaptureBrowserSession={onCaptureBrowserAgentSession}
            onKillBrowserSession={onKillBrowserAgentSession}
            onClickAt={onClickBrowserAgentSessionAt}
            onTypeAt={onTypeBrowserAgentSession}
            onFollowStart={onStartBrowserAgentSessionFollow}
            onFollowStop={onStopBrowserAgentSessionFollow}
            onTakeControl={onTakeControlBrowserAgentSession}
            onToggleAllowPrivate={onToggleAllowPrivateBrowserAgentSession}
            onRefreshSnapshot={onRefreshBrowserAgentSnapshot}
            snapshotText={browserAgentSnapshotText}
            snapshotLoading={browserAgentSnapshotLoading}
          />
        )}
        {activeTabMeta.id === 'changes' && (
          <WorkbenchChangesPanel
            changes={changes}
            message={changesMessage}
            onOpenInFiles={openPathInFiles}
            source={changesSource}
            loading={changesLoading}
          />
        )}
      </div>
    </>
  )

  if (sheet) {
    return (
      <div
        data-testid="agent-workbench-rail"
        data-open="true"
        data-presentation="sheet"
        className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-[var(--color-surface,#151515)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
      >
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-2 py-2">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id
            const count = badgeCount(counts[tab.id])
            return (
              <button
                key={tab.id}
                type="button"
                data-testid={`agent-workbench-tab-${tab.id}`}
                aria-pressed={isActive}
                onClick={() => onTabChange(tab.id)}
                className={[
                  'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-medium',
                  isActive ? 'bg-primary/15 text-primary' : 'text-[var(--color-pib-text-muted)]',
                ].join(' ')}
              >
                <Icon name={tab.icon} className="text-[16px]" />
                {tab.label}
                {count && <span className="rounded-md bg-[var(--color-pib-surface-muted)] px-1.5 text-[10px]">{count}</span>}
              </button>
            )
          })}
          <button
            type="button"
            aria-label="Close workbench"
            onClick={close}
            className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-md text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)]"
          >
            <Icon name="close" className="text-[17px]" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{panelBody}</div>
      </div>
    )
  }

  return (
    <div
      data-testid="agent-workbench-rail"
      data-open="true"
      data-presentation="panel"
      className="absolute inset-y-0 right-0 z-30 flex"
      style={{ width: `${clampedWidth + ICON_STRIP_WIDTH}px` }}
    >
      <button
        type="button"
        role="separator"
        aria-label="Resize agent workbench"
        aria-orientation="vertical"
        aria-valuemin={WORKBENCH_MIN_WIDTH}
        aria-valuemax={WORKBENCH_MAX_WIDTH}
        aria-valuenow={clampedWidth}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') clampResize(clampedWidth + 20)
          if (event.key === 'ArrowRight') clampResize(clampedWidth - 20)
        }}
        onPointerDown={(event) => {
          resizeRef.current = { x: event.clientX, width: clampedWidth }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!resizeRef.current) return
          clampResize(resizeRef.current.width + resizeRef.current.x - event.clientX)
        }}
        onPointerUp={(event) => {
          resizeRef.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => { resizeRef.current = null }}
        className="group/resize relative z-10 flex w-1.5 shrink-0 cursor-col-resize touch-none items-center justify-center bg-transparent outline-none"
      >
        <span
          aria-hidden="true"
          className="h-full w-px bg-[var(--color-card-border)] transition-colors group-hover/resize:bg-primary/70 group-focus-visible/resize:bg-primary"
        />
      </button>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-[var(--color-card-border)] bg-[var(--color-surface,#151515)]">
        {panelBody}
      </div>
      {iconStrip}
    </div>
  )
}

export default AgentWorkbenchRail
