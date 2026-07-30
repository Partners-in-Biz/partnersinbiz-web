'use client'

import { useEffect, useRef, useState } from 'react'
import { chatContextReferenceKey, type ChatContextReadModel, type ChatArtifactSummary, type ChatContextAction, type ContextItemSummary } from '@/lib/chat-context/types'
import { displayStateLabel, displayStateStyle } from '@/lib/chat-context/displayStateStyles'
import { ContextArtifactCard } from './ContextArtifactCard'
import { ContextAttentionMoment } from './ContextAttentionMoment'
import { ProjectTaskFeed } from './ProjectTaskFeed'
import { RuntimeExecutionSection, type RuntimeExecution } from '@/components/messages/hermes/RuntimeInspectorRail'
import { DocumentContextPreview } from './DocumentContextPreview'
import { EmailContextComposer } from './EmailContextComposer'
import { CampaignContextPreview } from './CampaignContextPreview'
import { SocialContextPreview } from './SocialContextPreview'
import { InvoiceContextPreview, QuoteContextPreview } from './CommerceDocumentContextPreview'
import { LinkedWorkbenchFolderPreview } from './LinkedWorkbenchFolderPreview'
import type { ChatContextOption } from './ContextSelector'

const RICH_GENERIC_KINDS = new Set(['company', 'contact', 'task'])
const DOCK_PREVIEW_KINDS = new Set(['document', 'email', 'campaign', 'social', 'invoice', 'quote'])
export const CONTEXT_CANVAS_MIN_WIDTH = 420
export const CONTEXT_CANVAS_MAX_WIDTH = 960

function clampCanvasWidth(width: number) {
  return Math.min(CONTEXT_CANVAS_MAX_WIDTH, Math.max(CONTEXT_CANVAS_MIN_WIDTH, width))
}

function displayDate(value: string | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function ContextGroupItemCard({
  item,
  expanded,
  onToggle,
  onAction,
  pendingActionId,
  showAgentFeed,
}: {
  item: ContextItemSummary
  expanded: boolean
  onToggle: () => void
  onAction?: (action: ChatContextAction) => void
  pendingActionId?: string
  showAgentFeed: boolean
}) {
  const style = displayStateStyle(item.state)
  const canExpand = showAgentFeed || Boolean(item.agent) || Boolean(item.detail)
  return (
    <li
      data-testid={`context-group-item-${item.id}`}
      data-state={item.state}
      className={`overflow-hidden rounded-lg border transition-colors ${style.cardClassName} ${expanded ? 'ring-1 ring-primary/25' : ''}`}
    >
      <div className="flex">
        <span aria-hidden="true" className="w-1 shrink-0 self-stretch" style={{ background: style.rail }} />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={canExpand ? expanded : undefined}
            aria-label={canExpand ? `${expanded ? 'Hide' : 'Show'} activity for ${item.label}` : item.label}
            onClick={() => { if (canExpand) onToggle() }}
            className={`flex min-h-11 w-full items-start gap-2 px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 xl:min-h-0 ${canExpand ? 'hover:bg-white/[0.03]' : 'cursor-default'}`}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium leading-snug text-[var(--color-pib-text)]">{item.label}</span>
              {item.detail && !expanded && (
                <span className="mt-1 line-clamp-2 block text-[11px] leading-relaxed text-[var(--color-pib-text-muted)]">{item.detail}</span>
              )}
              {displayDate(item.updatedAt) && (
                <span className="mt-1 block text-[10px] text-[var(--color-pib-text-muted)]">Updated {displayDate(item.updatedAt)}</span>
              )}
            </span>
            <span className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${style.badgeClassName}`}>
              {displayStateLabel(item.state)}
            </span>
            {canExpand && (
              <span className="material-symbols-outlined mt-0.5 shrink-0 text-[16px] text-[var(--color-pib-text-muted)]" aria-hidden="true">
                {expanded ? 'expand_less' : 'expand_more'}
              </span>
            )}
          </button>
          {item.actions && item.actions.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-white/[0.06] px-3 py-2">
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
          {expanded && showAgentFeed && <ProjectTaskFeed item={item} />}
          {expanded && !showAgentFeed && item.detail && (
            <div className="border-t border-white/[0.06] px-3 py-2 text-[11px] leading-relaxed text-[var(--color-pib-text-muted)]">
              {item.detail}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

export function ContextDock({ model, open, onClose, compact = false, activeArtifactId, onArtifactActivate, onAction, actionError, pendingActionId, execution, mode = 'single', onModeChange, canvasWidth = 520, onCanvasWidthChange, secondaryContext, secondaryOptions = [], onSecondaryChange, secondaryRefreshRevision = 0, previewRefreshRevision = 0, workbenchFolder }: { model: ChatContextReadModel; open: boolean; onClose: () => void; compact?: boolean; activeArtifactId?: string; onArtifactActivate?: (artifact: ChatArtifactSummary) => void; onAction?: (action: ChatContextAction, context?: ChatContextOption) => void; actionError?: string | null; pendingActionId?: string; execution?: RuntimeExecution; mode?: 'single' | 'dual'; onModeChange?: (mode: 'single' | 'dual') => void; canvasWidth?: number; onCanvasWidthChange?: (width: number) => void; secondaryContext?: ChatContextOption; secondaryOptions?: ChatContextOption[]; onSecondaryChange?: (context: ChatContextOption) => void; secondaryRefreshRevision?: number; previewRefreshRevision?: number; workbenchFolder?: { conversationId: string; path: string } }) {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023px)').matches)
  const [wideDesktop, setWideDesktop] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1280px)').matches)
  const [secondaryModel, setSecondaryModel] = useState<ChatContextReadModel | null>(null)
  const [secondaryLoading, setSecondaryLoading] = useState(false)
  const [secondaryLoadFailed, setSecondaryLoadFailed] = useState(false)
  const [tabletFocus, setTabletFocus] = useState<'primary' | 'secondary'>('primary')
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)
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
    setExpandedItemId(null)
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
  return <>{sheet && <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-30 bg-black/55" />}<aside ref={dialogRef} tabIndex={-1} role="dialog" aria-modal={sheet ? 'true' : 'false'} aria-label={`${visibleContext.label} context`} data-presentation={sheet ? 'sheet' : dual ? 'dual' : 'canvas'} style={!sheet ? { width: `${canvasWidth}px` } : undefined} className={sheet ? 'fixed inset-0 z-40 flex flex-col overflow-hidden border border-[var(--color-card-border)] bg-[var(--color-surface,#151515)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] shadow-2xl' : 'absolute inset-y-0 right-0 z-40 flex max-w-[min(960px,85%)] flex-col overflow-hidden border border-[var(--color-card-border)] bg-[var(--color-surface,#151515)] shadow-2xl'}>
    {!sheet && <button type="button" role="separator" aria-label="Resize context canvas" aria-orientation="vertical" aria-valuemin={CONTEXT_CANVAS_MIN_WIDTH} aria-valuemax={CONTEXT_CANVAS_MAX_WIDTH} aria-valuenow={canvasWidth} onKeyDown={(event) => { if (event.key === 'ArrowLeft') clampResize(canvasWidth + 20); if (event.key === 'ArrowRight') clampResize(canvasWidth - 20) }} onPointerDown={(event) => { resizeRef.current = { x: event.clientX, width: canvasWidth }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={(event) => { if (!resizeRef.current) return; clampResize(resizeRef.current.width + resizeRef.current.x - event.clientX) }} onPointerUp={(event) => { resizeRef.current = null; event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={() => { resizeRef.current = null }} className="group/resize absolute -left-1.5 top-0 z-10 flex h-full w-3 cursor-col-resize touch-none items-center justify-center bg-transparent outline-none"><span aria-hidden="true" className="h-full w-px bg-[var(--color-card-border)] transition-colors group-hover/resize:bg-primary/70 group-focus-visible/resize:bg-primary" /><span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/25 opacity-0 transition-opacity group-hover/resize:opacity-100 group-focus-visible/resize:opacity-100 group-active/resize:opacity-100" /></button>}
    <header data-testid="context-dock-header" className="relative z-10 flex min-h-12 shrink-0 items-center gap-2 overflow-hidden border-b border-[var(--color-card-border)] px-3 pb-2 pt-[max(.5rem,env(safe-area-inset-top))]"><span data-testid="context-dock-icon" className="relative z-10 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><span aria-hidden="true" className="material-symbols-outlined block text-[18px] leading-none">{visibleIcon}</span></span><div className="relative z-10 min-w-0 flex-1"><p className="relative z-10 text-[9px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)] leading-none">{visibleContext.kind.replaceAll('_', ' ')}</p><h2 className="relative z-10 mt-0.5 truncate text-sm font-semibold leading-snug text-[var(--color-pib-text)]">{visibleContext.label}</h2></div>{wideDesktop && secondaryOptions.length > 0 && <button type="button" aria-label={dual ? 'Use single context canvas' : 'Use dual context canvas'} aria-pressed={Boolean(dual)} onClick={() => onModeChange?.(dual ? 'single' : 'dual')} className="hidden h-8 items-center gap-1 rounded-lg border border-[var(--color-card-border)] px-2 text-[10px] text-[var(--color-pib-text-muted)] hover:bg-white/[0.06] xl:inline-flex"><span aria-hidden="true" className="material-symbols-outlined text-[15px]">splitscreen</span>{dual ? 'Single' : 'Dual focus'}</button>}<button ref={closeRef} type="button" aria-label="Close context dock" onClick={onClose} className="inline-flex h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs text-[var(--color-pib-text-muted)] outline-none hover:bg-white/[0.07] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 xl:h-8"><span className="material-symbols-outlined text-[17px]" aria-hidden="true">arrow_back</span>{sheet && <span>Back to chat</span>}</button></header>
    {tabletLandscape && secondaryContext && <div className="border-b border-[var(--color-card-border)] bg-black/10 px-3 py-2"><div role="tablist" aria-label="Context focus" className="grid grid-cols-2 gap-1 rounded-xl bg-black/20 p-1"><button ref={primaryTabRef} type="button" role="tab" tabIndex={tabletSecondaryActive ? -1 : 0} aria-selected={!tabletSecondaryActive} aria-controls="context-dock-scroll-body" onClick={() => setTabletFocus('primary')} onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'End') { event.preventDefault(); setTabletFocus('secondary'); secondaryTabRef.current?.focus() } }} className={`min-h-11 min-w-0 truncate rounded-lg px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${!tabletSecondaryActive ? 'bg-primary/15 font-semibold text-primary' : 'text-[var(--color-pib-text-muted)]'}`}>{model.context.label}</button><button ref={secondaryTabRef} type="button" role="tab" tabIndex={tabletSecondaryActive ? 0 : -1} aria-selected={tabletSecondaryActive} aria-controls="context-dock-scroll-body" onClick={() => setTabletFocus('secondary')} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'Home') { event.preventDefault(); setTabletFocus('primary'); primaryTabRef.current?.focus() } }} className={`min-h-11 min-w-0 truncate rounded-lg px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${tabletSecondaryActive ? 'bg-primary/15 font-semibold text-primary' : 'text-[var(--color-pib-text-muted)]'}`}>{secondaryContext.label}</button></div>{secondaryOptions.length > 1 && <select aria-label="Choose related context" value={chatContextReferenceKey(secondaryContext)} onChange={(event) => { const next = secondaryOptions.find((option) => chatContextReferenceKey(option) === event.target.value); if (next) { onSecondaryChange?.(next); setTabletFocus('secondary') } }} className="mt-2 h-11 w-full rounded-lg border border-[var(--color-card-border)] bg-black/20 px-2 text-xs text-[var(--color-pib-text)]">{secondaryOptions.map((option) => <option key={chatContextReferenceKey(option)} value={chatContextReferenceKey(option)}>{option.label}</option>)}</select>}</div>}
    {dual && <div className="flex items-center gap-2 border-b border-[var(--color-card-border)] bg-black/10 px-3 py-2"><span className="text-[10px] font-label uppercase tracking-[0.15em] text-[var(--color-pib-text-muted)]">Second focus</span><select aria-label="Secondary context" value={chatContextReferenceKey(secondaryContext)} onChange={(event) => { const next = secondaryOptions.find((option) => chatContextReferenceKey(option) === event.target.value); if (next) onSecondaryChange?.(next) }} className="h-11 min-w-0 flex-1 rounded-lg border border-[var(--color-card-border)] bg-black/20 px-2 py-1.5 text-xs text-[var(--color-pib-text)] xl:h-9">{secondaryOptions.map((option) => <option key={chatContextReferenceKey(option)} value={chatContextReferenceKey(option)}>{option.label}</option>)}</select></div>}
    <div id="context-dock-scroll-body" data-testid="context-dock-scroll-body" className={`min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))] ${dual ? 'grid content-start gap-3' : 'space-y-4'}`}>
      {tabletSecondaryActive && secondaryLoading && <div role="status" className="rounded-xl border border-[var(--color-card-border)] p-3 text-xs text-[var(--color-pib-text-muted)]">Loading related context…</div>}
      {tabletSecondaryActive && secondaryLoadFailed && <div role="alert" className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">This related context is unavailable.</div>}
      {actionError && <div role="alert" className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{actionError}</div>}
      {execution?.activeMessage?.runId && <RuntimeExecutionSection {...execution} />}
      {!tabletSecondaryActive && workbenchFolder && <LinkedWorkbenchFolderPreview {...workbenchFolder} />}
      {visibleModel?.context.kind === 'document' && <DocumentContextPreview documentId={visibleModel.context.id} refreshRevision={previewRefreshRevision} />}
      {visibleModel?.context.kind === 'email' && <EmailContextComposer messageId={visibleModel.context.id} refreshRevision={previewRefreshRevision} />}
      {visibleModel?.context.kind === 'campaign' && <CampaignContextPreview campaignId={visibleModel.context.id} refreshRevision={previewRefreshRevision} />}
      {visibleModel?.context.kind === 'social' && <SocialContextPreview postId={visibleModel.context.id} refreshRevision={previewRefreshRevision} />}
      {visibleModel?.context.kind === 'invoice' && <InvoiceContextPreview invoiceId={visibleModel.context.id} orgId={visibleModel.context.orgId} refreshRevision={previewRefreshRevision} />}
      {visibleModel?.context.kind === 'quote' && <QuoteContextPreview quoteId={visibleModel.context.id} orgId={visibleModel.context.orgId} refreshRevision={previewRefreshRevision} />}
      {visibleModel?.preview?.kind === 'summary' && !DOCK_PREVIEW_KINDS.has(visibleModel.context.kind) && (visibleModel.preview.text || visibleModel.preview.status) && <section aria-label="Context overview" className="rounded-xl border border-[var(--color-card-border)] bg-white/[0.025] p-3"><div className="flex items-center justify-between gap-2"><h3 className="text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">Overview</h3>{visibleModel.preview.status && <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{visibleModel.preview.status}</span>}</div>{visibleModel.preview.text && <p className="mt-2 text-xs leading-relaxed text-[var(--color-pib-text)]">{visibleModel.preview.text}</p>}</section>}
      {visibleModel && visibleModel.attention.length > 0 && <section aria-label="Attention" className="space-y-2">{visibleModel.attention.map((item) => <ContextAttentionMoment key={item.id} attention={item} onAction={triggerVisibleAction} pendingActionId={pendingActionId} />)}</section>}
      {groups.map((group) => {
        const isProjectTasks = visibleModel?.context.kind === 'project' && group.id === 'tasks'
        return (
          <section key={group.id} aria-label={group.label}>
            <h3 className="mb-2 text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">{group.label}</h3>
            <ul className="space-y-2">
              {group.items.map((item) => (
                <ContextGroupItemCard
                  key={item.id}
                  item={item}
                  expanded={expandedItemId === item.id}
                  onToggle={() => setExpandedItemId((current) => current === item.id ? null : item.id)}
                  onAction={triggerVisibleAction}
                  pendingActionId={pendingActionId}
                  showAgentFeed={isProjectTasks || Boolean(item.agent)}
                />
              ))}
            </ul>
          </section>
        )
      })}
      {visibleModel?.relationships && visibleModel.relationships.length > 0 && <section aria-label="Related context"><h3 className="mb-2 text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">Related context</h3><ul className="space-y-2">{visibleModel.relationships.map((relationship) => <li key={`${relationship.kind}:${relationship.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-card-border)] bg-white/[0.02] px-3 py-2 text-xs"><div className="min-w-0"><p className="truncate font-medium text-[var(--color-pib-text)]">{relationship.label}</p><p className="text-[10px] text-[var(--color-pib-text-muted)]">{relationship.relation}</p></div>{relationship.href && <a href={relationship.href} className="inline-flex min-h-11 shrink-0 items-center text-primary xl:min-h-8" aria-label={`Open ${relationship.label}`}>Open</a>}</li>)}</ul></section>}
      {visibleModel && visibleModel.artifacts.length > 0 && <section><h3 className="mb-2 text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">Artifacts</h3><div className="space-y-2">{visibleModel.artifacts.map((artifact) => <div key={artifact.id} data-active={artifact.id === activeArtifactId || undefined}><ContextArtifactCard artifact={artifact} selected={artifact.id === activeArtifactId} onActivate={onArtifactActivate} onAction={triggerVisibleAction} pendingActionId={pendingActionId} /></div>)}</div></section>}
      {visibleModel && (visibleModel.activity.length > 0 || RICH_GENERIC_KINDS.has(visibleModel.context.kind)) && <section aria-label="Recent activity"><h3 className="mb-2 text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">Recent activity</h3>{visibleModel.activity.length > 0 ? <ul>{visibleModel.activity.map((item) => <li key={item.id} className="border-b border-white/[0.06] py-2 text-[11px] text-[var(--color-pib-text-muted)]"><span className="text-[var(--color-pib-text)]">{item.label}</span>{displayDate(item.occurredAt) && <span className="ml-2 text-[10px]">{displayDate(item.occurredAt)}</span>}</li>)}</ul> : <p className="rounded-lg border border-dashed border-[var(--color-card-border)] px-3 py-2 text-[11px] text-[var(--color-pib-text-muted)]">No recent activity is available for this record yet.</p>}</section>}
      {visibleModel?.context.href && <a href={visibleModel.context.href} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/15 xl:min-h-9">Open full workspace<span aria-hidden="true" className="material-symbols-outlined text-[15px]">open_in_new</span></a>}
      {dual && <section className="rounded-xl border border-primary/20 bg-primary/[0.035] p-3"><p className="text-[9px] font-label uppercase tracking-[0.18em] text-primary">Related context</p><h3 className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">{secondaryModel?.context.label ?? secondaryContext.label}</h3><p className="mt-2 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">{secondaryModel?.pulse.headline ?? secondaryContext.summary ?? 'Live details load from the authoritative workspace.'}</p>{secondaryModel?.pulse.progress && <p className="mt-3 text-xs text-[var(--color-pib-text)]">{secondaryModel.pulse.progress.complete} of {secondaryModel.pulse.progress.total} complete</p>}{secondaryModel?.attention.map((item) => <div key={item.id} className="mt-3"><ContextAttentionMoment attention={item} onAction={(action) => onAction?.(action, secondaryContext)} pendingActionId={pendingActionId} /></div>)}{secondaryModel?.artifacts.map((artifact) => <div key={artifact.id} className="mt-3"><ContextArtifactCard artifact={artifact} selected={artifact.id === activeArtifactId} onActivate={onArtifactActivate} onAction={(action) => onAction?.(action, secondaryContext)} pendingActionId={pendingActionId} /></div>)}{(secondaryModel?.context.href ?? secondaryContext.href) && <a href={secondaryModel?.context.href ?? secondaryContext.href} className="mt-3 inline-flex min-h-11 items-center gap-1 rounded-lg border border-[var(--color-card-border)] px-3 text-xs text-[var(--color-pib-text)] xl:min-h-9">Open workspace<span aria-hidden="true" className="material-symbols-outlined text-[14px]">open_in_new</span></a>}</section>}
    </div>
  </aside></>
}
