'use client'

import { Icon } from '@/components/studio'
import { useEffect, useRef, useState } from 'react'
import {
  chatContextReferenceKey,
  type ChatContextReadModel,
  type ChatArtifactSummary,
  type ChatContextAction,
  type ChatContextActionReceipt,
  type ContextDisplayState,
  type ContextItemSummary,
} from '@/lib/chat-context/types'
import { displayStateLabel, displayStateStyle } from '@/lib/chat-context/displayStateStyles'
import { ContextArtifactCard } from './ContextArtifactCard'
import { ContextAttentionMoment } from './ContextAttentionMoment'
import { ProjectTaskFeed } from './ProjectTaskFeed'
import { RuntimeExecutionSection, type RuntimeExecution } from '@/components/messages/hermes/RuntimeInspectorRail'
import { DocumentContextPreview } from './DocumentContextPreview'
import { DesignAuditContextPreview } from './DesignAuditContextPreview'
import { DesignIterationContextPreview } from './DesignIterationContextPreview'
import { EmailContextComposer } from './EmailContextComposer'
import { CampaignContextPreview } from './CampaignContextPreview'
import { SocialContextPreview } from './SocialContextPreview'
import { InvoiceContextPreview, QuoteContextPreview } from './CommerceDocumentContextPreview'
import { LinkedWorkbenchFolderPreview } from './LinkedWorkbenchFolderPreview'
import type { ChatContextOption } from './ContextSelector'
import { ContextActionReceiptCard } from './ContextActionReceiptCard'
import { ArtifactCanvas } from './ArtifactCanvas'
import type { RichMessagePart } from '@/lib/hermes/types'

const RICH_GENERIC_KINDS = new Set(['company', 'contact', 'task'])
const DOCK_PREVIEW_KINDS = new Set(['document', 'email', 'campaign', 'social', 'invoice', 'quote', 'design', 'artifact'])
export const CONTEXT_CANVAS_MIN_WIDTH = 420
export const CONTEXT_CANVAS_MAX_WIDTH = 960

function clampCanvasWidth(width: number) {
  return Math.min(CONTEXT_CANVAS_MAX_WIDTH, Math.max(CONTEXT_CANVAS_MIN_WIDTH, width))
}

function displayDate(value: string | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

/** Three-step card density for project/context items (default = title only). */
export type ContextItemExpandLevel = 'collapsed' | 'summary' | 'full'

export function nextContextItemExpandLevel(
  current: ContextItemExpandLevel,
  options: { canSummary: boolean; canFull: boolean },
): ContextItemExpandLevel {
  if (current === 'collapsed') {
    if (options.canSummary) return 'summary'
    if (options.canFull) return 'full'
    return 'collapsed'
  }
  if (current === 'summary') {
    if (options.canFull) return 'full'
    return 'collapsed'
  }
  return 'collapsed'
}

/** Stable order for task-state filter chips (matches kanban-ish flow). */
export const CONTEXT_ITEM_STATE_FILTER_ORDER: ContextDisplayState[] = [
  'ready',
  'running',
  'waiting',
  'needs_input',
  'needs_approval',
  'blocked',
  'review',
  'complete',
  'published',
  'archived',
]

export type ContextItemStateCount = { state: ContextDisplayState; count: number; label: string }

/** Count states present in a group; empty selected set means “show all”. */
export function countContextItemStates(items: ContextItemSummary[]): ContextItemStateCount[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    const state = item.state || 'ready'
    counts.set(state, (counts.get(state) ?? 0) + 1)
  }
  const known = CONTEXT_ITEM_STATE_FILTER_ORDER
    .filter((state) => counts.has(state))
    .map((state) => ({
      state,
      count: counts.get(state)!,
      label: displayStateLabel(state),
    }))
  const extras = Array.from(counts.entries())
    .filter(([state]) => !CONTEXT_ITEM_STATE_FILTER_ORDER.includes(state as ContextDisplayState))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([state, count]) => ({
      state: state as ContextDisplayState,
      count,
      label: displayStateLabel(state),
    }))
  return [...known, ...extras]
}

export function filterContextItemsByStates(
  items: ContextItemSummary[],
  selectedStates: ReadonlySet<string>,
): ContextItemSummary[] {
  if (selectedStates.size === 0) return items
  return items.filter((item) => selectedStates.has(item.state || 'ready'))
}

export function toggleContextItemStateFilter(
  selected: ReadonlySet<string>,
  state: string,
): Set<string> {
  const next = new Set(selected)
  if (next.has(state)) next.delete(state)
  else next.add(state)
  return next
}

function ContextItemStateFilterBar({
  counts,
  selected,
  onToggle,
  onClear,
}: {
  counts: ContextItemStateCount[]
  selected: ReadonlySet<string>
  onToggle: (state: string) => void
  onClear: () => void
}) {
  if (counts.length < 2) return null
  const allActive = selected.size === 0
  const total = counts.reduce((sum, row) => sum + row.count, 0)
  return (
    <div
      data-testid="context-item-state-filter"
      role="group"
      aria-label="Filter tasks by state"
      className="mb-2 flex flex-wrap items-center gap-1"
    >
      <button
        type="button"
        aria-pressed={allActive}
        onClick={onClear}
        className={`inline-flex min-h-8 items-center gap-1 rounded-[4px] border px-2 py-0.5 text-[10px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${ allActive ? 'border-primary/40 bg-primary/15 text-primary' : 'border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-pib-surface-muted)]' }`}
      >
        All
        <span className="tabular-nums opacity-80">{total}</span>
      </button>
      {counts.map((row) => {
        const active = selected.has(row.state)
        const style = displayStateStyle(row.state)
        return (
          <button
            key={row.state}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(row.state)}
            className={`inline-flex min-h-8 items-center gap-1 rounded-[4px] border px-2 py-0.5 text-[10px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${ active ? style.badgeClassName : 'border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-pib-surface-muted)]' }`}
          >
            {row.label}
            <span className="tabular-nums opacity-80">{row.count}</span>
          </button>
        )
      })}
    </div>
  )
}

function expandLevelIcon(level: ContextItemExpandLevel): string {
  if (level === 'collapsed') return 'expand_more'
  if (level === 'summary') return 'unfold_more'
  return 'expand_less'
}

function expandLevelAriaLabel(level: ContextItemExpandLevel, label: string): string {
  if (level === 'collapsed') return `Show summary for ${label}`
  if (level === 'summary') return `Show full activity for ${label}`
  return `Collapse ${label}`
}

function ContextGroupItemCard({
  item,
  expandLevel,
  onCycleExpand,
  onAction,
  pendingActionId,
  showAgentFeed,
}: {
  item: ContextItemSummary
  expandLevel: ContextItemExpandLevel
  onCycleExpand: () => void
  onAction?: (action: ChatContextAction) => void
  pendingActionId?: string
  showAgentFeed: boolean
}) {
  const style = displayStateStyle(item.state)
  const summaryText = item.detail
    || (item.agent?.summary ? item.agent.summary : undefined)
  const canSummary = Boolean(summaryText) || Boolean(item.actions?.length) || Boolean(item.updatedAt)
  const canFull = showAgentFeed || Boolean(item.agent) || Boolean(item.detail)
  const canExpand = canSummary || canFull
  const showSummary = expandLevel === 'summary' || expandLevel === 'full'
  const showFull = expandLevel === 'full'
  return (
    <li
      data-testid={`context-group-item-${item.id}`}
      data-state={item.state}
      data-expand-level={expandLevel}
      className={`overflow-hidden rounded-lg border transition-colors ${style.cardClassName} ${expandLevel !== 'collapsed' ? 'ring-1 ring-primary/25' : ''}`}
    >
      <div className="flex">
        <span aria-hidden="true" className="w-1 shrink-0 self-stretch" style={{ background: style.rail }} />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={canExpand ? expandLevel !== 'collapsed' : undefined}
            aria-label={canExpand ? expandLevelAriaLabel(expandLevel, item.label) : item.label}
            onClick={() => { if (canExpand) onCycleExpand() }}
            className={`flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 xl:min-h-0 ${canExpand ? 'hover:bg-[var(--color-pib-surface-muted)]' : 'cursor-default'}`}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium leading-snug text-[var(--color-pib-text)]">{item.label}</span>
            </span>
            <span className={`shrink-0 rounded-[4px] border px-2 py-0.5 text-[10px] font-medium capitalize ${style.badgeClassName}`}>
              {displayStateLabel(item.state)}
            </span>
            {canExpand && (
              <Icon name={expandLevelIcon(expandLevel)} className="shrink-0 text-[16px] text-[var(--color-pib-text-muted)]" />
            )}
          </button>
          {showSummary && item.actions && item.actions.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-[var(--color-pib-line)] px-3 py-2">
              {item.actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  disabled={pendingActionId === action.id}
                  onClick={() => onAction?.(action)}
                  className="min-h-11 rounded-lg border border-[var(--color-card-border)] px-3 text-[11px] text-[var(--color-pib-text)] disabled:opacity-50 xl:min-h-8"
                >
                  {pendingActionId === action.id ? 'Working…' : action.label}
                </button>
              ))}
            </div>
          )}
          {/* Mid level: compact detail only (previous default collapsed preview). */}
          {showSummary && !showFull && summaryText && (
            <div className="border-t border-[var(--color-pib-line)] px-3 py-2 text-[11px] leading-relaxed text-[var(--color-pib-text-muted)]">
              <p className="line-clamp-4 whitespace-pre-wrap">{summaryText}</p>
              {displayDate(item.updatedAt) && (
                <p className="mt-1.5 text-[10px] text-[var(--color-pib-text-muted)]">Updated {displayDate(item.updatedAt)}</p>
              )}
            </div>
          )}
          {showSummary && !showFull && !summaryText && displayDate(item.updatedAt) && (
            <div className="border-t border-[var(--color-pib-line)] px-3 py-2 text-[10px] text-[var(--color-pib-text-muted)]">
              Updated {displayDate(item.updatedAt)}
            </div>
          )}
          {/* Full level: agent activity feed / full detail (previous expand). */}
          {showFull && showAgentFeed && <ProjectTaskFeed item={item} />}
          {showFull && !showAgentFeed && item.detail && (
            <div className="border-t border-[var(--color-pib-line)] px-3 py-2 text-[11px] leading-relaxed text-[var(--color-pib-text-muted)]">
              {item.detail}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

export function ContextDock({ model, open, onClose, compact = false, activeArtifactId, onArtifactActivate, onAction, actionError, actionReceipt, pendingActionId, execution, mode = 'single', onModeChange, canvasWidth = 520, onCanvasWidthChange, secondaryContext, secondaryOptions = [], onSecondaryChange, secondaryRefreshRevision = 0, previewRefreshRevision = 0, workbenchFolder, artifactPart, onArtifactTakeOver }: { model: ChatContextReadModel; open: boolean; onClose: () => void; compact?: boolean; activeArtifactId?: string; onArtifactActivate?: (artifact: ChatArtifactSummary) => void; onAction?: (action: ChatContextAction, context?: ChatContextOption) => void; actionError?: string | null; actionReceipt?: ChatContextActionReceipt | null; pendingActionId?: string; execution?: RuntimeExecution; mode?: 'single' | 'dual'; onModeChange?: (mode: 'single' | 'dual') => void; canvasWidth?: number; onCanvasWidthChange?: (width: number) => void; secondaryContext?: ChatContextOption; secondaryOptions?: ChatContextOption[]; onSecondaryChange?: (context: ChatContextOption) => void; secondaryRefreshRevision?: number; previewRefreshRevision?: number; workbenchFolder?: { conversationId: string; path: string }; artifactPart?: RichMessagePart | null; onArtifactTakeOver?: (sessionId?: string) => void }) {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023px)').matches)
  const [wideDesktop, setWideDesktop] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1280px)').matches)
  const [secondaryModel, setSecondaryModel] = useState<ChatContextReadModel | null>(null)
  const [secondaryLoading, setSecondaryLoading] = useState(false)
  const [secondaryLoadFailed, setSecondaryLoadFailed] = useState(false)
  const [tabletFocus, setTabletFocus] = useState<'primary' | 'secondary'>('primary')
  const [itemExpandLevels, setItemExpandLevels] = useState<Record<string, ContextItemExpandLevel>>({})
  /** Empty set = show all states. Non-empty = multi-select include filter. */
  const [itemStateFilter, setItemStateFilter] = useState<Set<string>>(() => new Set())
  const sheet = compact || mobile
  const tabletLandscape = !sheet && !wideDesktop
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const primaryTabRef = useRef<HTMLButtonElement>(null)
  const secondaryTabRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const resizeRef = useRef<{ x: number; width: number } | null>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => {
    if (compact || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width: 1023px)')
    const update = () => setMobile(media.matches)
    update(); media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [compact])
  useEffect(() => {
    if (compact || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(min-width: 1280px)')
    const update = () => setWideDesktop(media.matches)
    update(); media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [compact])
  useEffect(() => {
    const needsSecondary = (wideDesktop && mode === 'dual') || tabletLandscape
    if (!open || !needsSecondary || !secondaryContext) { setSecondaryModel(null); setSecondaryLoading(false); setSecondaryLoadFailed(false); return }
    const controller = new AbortController()
    setSecondaryModel(null)
    setSecondaryLoading(true)
    setSecondaryLoadFailed(false)
    const taskProjectId = secondaryContext.kind === 'task' ? secondaryContext.projectId?.trim() : ''
    const query = taskProjectId ? `?${new URLSearchParams({ projectId: taskProjectId }).toString()}` : ''
    fetch(`/api/v1/chat-context/${encodeURIComponent(secondaryContext.kind)}/${encodeURIComponent(secondaryContext.id)}${query}`, { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error('Secondary context unavailable')))
      .then((body) => { if (!controller.signal.aborted) { setSecondaryModel(body?.data ?? null); setSecondaryLoadFailed(!body?.data) } })
      .catch(() => { if (!controller.signal.aborted) { setSecondaryModel(null); setSecondaryLoadFailed(true) } })
      .finally(() => { if (!controller.signal.aborted) setSecondaryLoading(false) })
    return () => controller.abort()
  }, [mode, open, secondaryContext, secondaryRefreshRevision, tabletLandscape, wideDesktop])
  useEffect(() => {
    setTabletFocus('primary')
    setItemExpandLevels({})
    setItemStateFilter(new Set())
  }, [model.context.id, model.context.kind])
  useEffect(() => {
    if (!secondaryContext && tabletFocus === 'secondary') setTabletFocus('primary')
  }, [secondaryContext, tabletFocus])
  useEffect(() => {
    if (!open) return
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return }
      if (event.key !== 'Tab' || !sheet || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], select:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      if (focusable.length === 0) { event.preventDefault(); dialogRef.current.focus(); return }
      const first = focusable[0]; const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); returnFocus.current?.focus() }
  }, [open, sheet])
  if (!open) return null
  const dual = mode === 'dual' && wideDesktop && secondaryContext
  const tabletSecondaryActive = tabletLandscape && tabletFocus === 'secondary' && Boolean(secondaryContext)
  const visibleModel = tabletSecondaryActive ? secondaryModel : model
  const visibleActionContext = tabletSecondaryActive ? secondaryContext : undefined
  const triggerVisibleAction = (action: ChatContextAction) => visibleActionContext ? onAction?.(action, visibleActionContext) : onAction?.(action)
  const visibleContext = visibleModel?.context ?? secondaryContext ?? model.context
  const visibleIcon = 'icon' in visibleContext ? visibleContext.icon : 'link'
  const groups = visibleModel?.groups.filter((group) => group.items.length) ?? []
  const clampResize = (width: number) => onCanvasWidthChange?.(clampCanvasWidth(width))
  return <>{sheet && <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-30 bg-[var(--color-pib-surface-muted)]5" />}<aside ref={dialogRef} tabIndex={-1} role="dialog" aria-modal={sheet ? 'true' : 'false'} aria-label={`${visibleContext.label} context`} data-presentation={sheet ? 'sheet' : dual ? 'dual' : 'canvas'} style={!sheet ? { width: `${canvasWidth}px` } : undefined} className={sheet ? 'fixed inset-0 z-40 flex flex-col overflow-hidden border border-[var(--color-card-border)] bg-[var(--color-surface,#151515)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] ' : 'absolute inset-y-0 right-0 z-40 flex max-w-[min(960px,85%)] flex-col overflow-hidden border border-[var(--color-card-border)] bg-[var(--color-surface,#151515)] '}>
    {!sheet && <button type="button" role="separator" aria-label="Resize context canvas" aria-orientation="vertical" aria-valuemin={CONTEXT_CANVAS_MIN_WIDTH} aria-valuemax={CONTEXT_CANVAS_MAX_WIDTH} aria-valuenow={canvasWidth} onKeyDown={(event) => { if (event.key === 'ArrowLeft') clampResize(canvasWidth + 20); if (event.key === 'ArrowRight') clampResize(canvasWidth - 20) }} onPointerDown={(event) => { resizeRef.current = { x: event.clientX, width: canvasWidth }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={(event) => { if (!resizeRef.current) return; clampResize(resizeRef.current.width + resizeRef.current.x - event.clientX) }} onPointerUp={(event) => { resizeRef.current = null; event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={() => { resizeRef.current = null }} className="group/resize absolute -left-1.5 top-0 z-10 flex h-full w-3 cursor-col-resize touch-none items-center justify-center bg-transparent outline-none"><span aria-hidden="true" className="h-full w-px bg-[var(--color-card-border)] transition-colors group-hover/resize:bg-primary/70 group-focus-visible/resize:bg-primary" /><span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-[4px] bg-[color-mix(in_srgb,var(--color-pib-text)_25%,transparent)] opacity-0 transition-opacity group-hover/resize:opacity-100 group-focus-visible/resize:opacity-100 group-active/resize:opacity-100" /></button>}
    <header data-testid="context-dock-header" className="relative z-10 flex min-h-12 shrink-0 items-center gap-2 overflow-hidden border-b border-[var(--color-card-border)] px-3 pb-2 pt-[max(.5rem,env(safe-area-inset-top))]"><span data-testid="context-dock-icon" className="relative z-10 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon name={visibleIcon} className="block text-[18px] leading-none" /></span><div className="relative z-10 min-w-0 flex-1"><p className="relative z-10 text-[9px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)] leading-none">{visibleContext.kind.replaceAll('_', ' ')}</p><h2 className="relative z-10 mt-0.5 truncate text-sm font-medium leading-snug text-[var(--color-pib-text)]">{visibleContext.label}</h2></div>{wideDesktop && secondaryOptions.length > 0 && <button type="button" aria-label={dual ? 'Use single context canvas' : 'Use dual context canvas'} aria-pressed={Boolean(dual)} onClick={() => onModeChange?.(dual ? 'single' : 'dual')} className="hidden h-8 items-center gap-1 rounded-lg border border-[var(--color-card-border)] px-2 text-[10px] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-pib-surface-muted)] xl:inline-flex"><Icon name="splitscreen" className="text-[15px]" />{dual ? 'Single' : 'Dual focus'}</button>}<button ref={closeRef} type="button" aria-label="Close context dock" onClick={onClose} className="inline-flex h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs text-[var(--color-pib-text-muted)] outline-none hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 xl:h-8"><Icon name="arrow_back" className="text-[17px]" />{sheet && <span>Back to chat</span>}</button></header>
    {tabletLandscape && secondaryContext && <div className="border-b border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-3 py-2"><div role="tablist" aria-label="Context focus" className="grid grid-cols-2 gap-1 rounded-[6px] bg-[var(--color-pib-surface-muted)] p-1"><button ref={primaryTabRef} type="button" role="tab" tabIndex={tabletSecondaryActive ? -1 : 0} aria-selected={!tabletSecondaryActive} aria-controls="context-dock-scroll-body" onClick={() => setTabletFocus('primary')} onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'End') { event.preventDefault(); setTabletFocus('secondary'); secondaryTabRef.current?.focus() } }} className={`min-h-11 min-w-0 truncate rounded-lg px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${!tabletSecondaryActive ? 'bg-primary/15 font-medium text-primary' : 'text-[var(--color-pib-text-muted)]'}`}>{model.context.label}</button><button ref={secondaryTabRef} type="button" role="tab" tabIndex={tabletSecondaryActive ? 0 : -1} aria-selected={tabletSecondaryActive} aria-controls="context-dock-scroll-body" onClick={() => setTabletFocus('secondary')} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'Home') { event.preventDefault(); setTabletFocus('primary'); primaryTabRef.current?.focus() } }} className={`min-h-11 min-w-0 truncate rounded-lg px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${tabletSecondaryActive ? 'bg-primary/15 font-medium text-primary' : 'text-[var(--color-pib-text-muted)]'}`}>{secondaryContext.label}</button></div>{secondaryOptions.length > 1 && <select aria-label="Choose related context" value={chatContextReferenceKey(secondaryContext)} onChange={(event) => { const next = secondaryOptions.find((option) => chatContextReferenceKey(option) === event.target.value); if (next) { onSecondaryChange?.(next); setTabletFocus('secondary') } }} className="mt-2 h-11 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-2 text-xs text-[var(--color-pib-text)]">{secondaryOptions.map((option) => <option key={chatContextReferenceKey(option)} value={chatContextReferenceKey(option)}>{option.label}</option>)}</select>}</div>}
    {dual && <div className="flex items-center gap-2 border-b border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-3 py-2"><span className="text-[10px] font-label uppercase tracking-[0.15em] text-[var(--color-pib-text-muted)]">Second focus</span><select aria-label="Secondary context" value={chatContextReferenceKey(secondaryContext)} onChange={(event) => { const next = secondaryOptions.find((option) => chatContextReferenceKey(option) === event.target.value); if (next) onSecondaryChange?.(next) }} className="h-11 min-w-0 flex-1 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-2 py-1.5 text-xs text-[var(--color-pib-text)] xl:h-9">{secondaryOptions.map((option) => <option key={chatContextReferenceKey(option)} value={chatContextReferenceKey(option)}>{option.label}</option>)}</select></div>}
    <div id="context-dock-scroll-body" data-testid="context-dock-scroll-body" className={`min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))] ${dual ? 'grid content-start gap-3' : 'space-y-4'}`}>
      {tabletSecondaryActive && secondaryLoading && <div role="status" className="rounded-[6px] border border-[var(--color-card-border)] p-3 text-xs text-[var(--color-pib-text-muted)]">Loading related context…</div>}
      {tabletSecondaryActive && secondaryLoadFailed && <div role="alert" className="rounded-[6px] border border-amber-400/30 bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)] p-3 text-xs text-[var(--st-warning)]">This related context is unavailable.</div>}
      {actionReceipt && <ContextActionReceiptCard receipt={actionReceipt} />}
      {actionError && <div role="alert" className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{actionError}</div>}
      {execution?.activeMessage?.runId && <RuntimeExecutionSection {...execution} />}
      {!tabletSecondaryActive && workbenchFolder && <LinkedWorkbenchFolderPreview {...workbenchFolder} />}
      {artifactPart ? <ArtifactCanvas part={artifactPart} onTakeOver={onArtifactTakeOver} /> : null}
      {visibleModel?.context.kind === 'document' && <DocumentContextPreview documentId={visibleModel.context.id} refreshRevision={previewRefreshRevision} />}
      {visibleModel?.context.kind === 'design' && (visibleModel.context.id.startsWith('di_')
        ? <DesignIterationContextPreview iterationId={visibleModel.context.id} refreshRevision={previewRefreshRevision} />
        : <DesignAuditContextPreview auditId={visibleModel.context.id} refreshRevision={previewRefreshRevision} />)}
      {visibleModel?.context.kind === 'email' && <EmailContextComposer messageId={visibleModel.context.id} refreshRevision={previewRefreshRevision} />}
      {visibleModel?.context.kind === 'campaign' && <CampaignContextPreview campaignId={visibleModel.context.id} refreshRevision={previewRefreshRevision} />}
      {visibleModel?.context.kind === 'social' && <SocialContextPreview postId={visibleModel.context.id} refreshRevision={previewRefreshRevision} />}
      {visibleModel?.context.kind === 'invoice' && <InvoiceContextPreview invoiceId={visibleModel.context.id} orgId={visibleModel.context.orgId} refreshRevision={previewRefreshRevision} />}
      {visibleModel?.context.kind === 'quote' && <QuoteContextPreview quoteId={visibleModel.context.id} orgId={visibleModel.context.orgId} refreshRevision={previewRefreshRevision} />}
      {visibleModel?.preview?.kind === 'summary' && !DOCK_PREVIEW_KINDS.has(visibleModel.context.kind) && (visibleModel.preview.text || visibleModel.preview.status) && <section aria-label="Context overview" className="rounded-[6px] border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] p-3"><div className="flex items-center justify-between gap-2"><h3 className="text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">Overview</h3>{visibleModel.preview.status && <span className="rounded-[4px] border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{visibleModel.preview.status}</span>}</div>{visibleModel.preview.text && <p className="mt-2 text-xs leading-relaxed text-[var(--color-pib-text)]">{visibleModel.preview.text}</p>}</section>}
      {visibleModel && visibleModel.attention.length > 0 && <section aria-label="Attention" className="space-y-2">{visibleModel.attention.map((item) => <ContextAttentionMoment key={item.id} attention={item} onAction={triggerVisibleAction} pendingActionId={pendingActionId} />)}</section>}
      {groups.map((group) => {
        const isProjectTasks = visibleModel?.context.kind === 'project' && group.id === 'tasks'
        const showStateFilter = isProjectTasks || group.id === 'tasks'
        const stateCounts = showStateFilter ? countContextItemStates(group.items) : []
        const visibleItems = showStateFilter
          ? filterContextItemsByStates(group.items, itemStateFilter)
          : group.items
        return (
          <section key={group.id} aria-label={group.label}>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className="text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">{group.label}</h3>
              {showStateFilter && itemStateFilter.size > 0 && (
                <span className="text-[10px] tabular-nums text-[var(--color-pib-text-muted)]">
                  {visibleItems.length} of {group.items.length}
                </span>
              )}
            </div>
            {showStateFilter && (
              <ContextItemStateFilterBar
                counts={stateCounts}
                selected={itemStateFilter}
                onToggle={(state) => setItemStateFilter((current) => toggleContextItemStateFilter(current, state))}
                onClear={() => setItemStateFilter(new Set())}
              />
            )}
            {visibleItems.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--color-card-border)] px-3 py-2 text-[11px] text-[var(--color-pib-text-muted)]">
                No tasks match the selected states.
              </p>
            ) : (
              <ul className="space-y-2">
                {visibleItems.map((item) => {
                  const showAgentFeed = isProjectTasks || Boolean(item.agent)
                  const summaryText = item.detail || item.agent?.summary
                  const canSummary = Boolean(summaryText) || Boolean(item.actions?.length) || Boolean(item.updatedAt)
                  const canFull = showAgentFeed || Boolean(item.agent) || Boolean(item.detail)
                  return (
                    <ContextGroupItemCard
                      key={item.id}
                      item={item}
                      expandLevel={itemExpandLevels[item.id] ?? 'collapsed'}
                      onCycleExpand={() => setItemExpandLevels((current) => {
                        const level = current[item.id] ?? 'collapsed'
                        const next = nextContextItemExpandLevel(level, { canSummary, canFull })
                        if (next === 'collapsed') {
                          const { [item.id]: _removed, ...rest } = current
                          return rest
                        }
                        return { ...current, [item.id]: next }
                      })}
                      onAction={triggerVisibleAction}
                      pendingActionId={pendingActionId}
                      showAgentFeed={showAgentFeed}
                    />
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}
      {visibleModel?.relationships && visibleModel.relationships.length > 0 && <section aria-label="Related context"><h3 className="mb-2 text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">Related context</h3><ul className="space-y-2">{visibleModel.relationships.map((relationship) => <li key={`${relationship.kind}:${relationship.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-3 py-2 text-xs"><div className="min-w-0"><p className="truncate font-medium text-[var(--color-pib-text)]">{relationship.label}</p><p className="text-[10px] text-[var(--color-pib-text-muted)]">{relationship.relation}</p></div>{relationship.href && <a href={relationship.href} className="inline-flex min-h-11 shrink-0 items-center text-primary xl:min-h-8" aria-label={`Open ${relationship.label}`}>Open</a>}</li>)}</ul></section>}
      {visibleModel && visibleModel.artifacts.length > 0 && <section><h3 className="mb-2 text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">Artifacts</h3><div className="space-y-2">{visibleModel.artifacts.map((artifact) => <div key={artifact.id} data-active={artifact.id === activeArtifactId || undefined}><ContextArtifactCard artifact={artifact} selected={artifact.id === activeArtifactId} onActivate={onArtifactActivate} onAction={triggerVisibleAction} pendingActionId={pendingActionId} /></div>)}</div></section>}
      {visibleModel && (visibleModel.activity.length > 0 || RICH_GENERIC_KINDS.has(visibleModel.context.kind)) && <section aria-label="Recent activity"><h3 className="mb-2 text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">Recent activity</h3>{visibleModel.activity.length > 0 ? <ul>{visibleModel.activity.map((item) => <li key={item.id} className="border-b border-[var(--color-pib-line)] py-2 text-[11px] text-[var(--color-pib-text-muted)]"><span className="text-[var(--color-pib-text)]">{item.label}</span>{displayDate(item.occurredAt) && <span className="ml-2 text-[10px]">{displayDate(item.occurredAt)}</span>}</li>)}</ul> : <p className="rounded-lg border border-dashed border-[var(--color-card-border)] px-3 py-2 text-[11px] text-[var(--color-pib-text-muted)]">No recent activity is available for this record yet.</p>}</section>}
      {visibleModel?.context.href && <a href={visibleModel.context.href} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[6px] border border-primary/30 bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/15 xl:min-h-9">Open full workspace<Icon name="open_in_new" className="text-[15px]" /></a>}
      {dual && <section className="rounded-[6px] border border-primary/20 bg-primary/[0.035] p-3"><p className="text-[9px] font-label uppercase tracking-[0.18em] text-primary">Related context</p><h3 className="mt-1 text-sm font-medium text-[var(--color-pib-text)]">{secondaryModel?.context.label ?? secondaryContext.label}</h3><p className="mt-2 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">{secondaryModel?.pulse.headline ?? secondaryContext.summary ?? 'Live details load from the authoritative workspace.'}</p>{secondaryModel?.pulse.progress && <p className="mt-3 text-xs text-[var(--color-pib-text)]">{secondaryModel.pulse.progress.complete} of {secondaryModel.pulse.progress.total} complete</p>}{secondaryModel?.attention.map((item) => <div key={item.id} className="mt-3"><ContextAttentionMoment attention={item} onAction={(action) => onAction?.(action, secondaryContext)} pendingActionId={pendingActionId} /></div>)}{secondaryModel?.artifacts.map((artifact) => <div key={artifact.id} className="mt-3"><ContextArtifactCard artifact={artifact} selected={artifact.id === activeArtifactId} onActivate={onArtifactActivate} onAction={(action) => onAction?.(action, secondaryContext)} pendingActionId={pendingActionId} /></div>)}{(secondaryModel?.context.href ?? secondaryContext.href) && <a href={secondaryModel?.context.href ?? secondaryContext.href} className="mt-3 inline-flex min-h-11 items-center gap-1 rounded-lg border border-[var(--color-card-border)] px-3 text-xs text-[var(--color-pib-text)] xl:min-h-9">Open workspace<Icon name="open_in_new" className="text-[14px]" /></a>}</section>}
    </div>
  </aside></>
}
