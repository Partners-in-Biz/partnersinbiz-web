'use client'

import { useEffect, useRef, useState } from 'react'
import type { ChatContextReadModel, ChatArtifactSummary, ChatContextAction } from '@/lib/chat-context/types'
import { ContextArtifactCard } from './ContextArtifactCard'
import { ContextAttentionMoment } from './ContextAttentionMoment'
import { RuntimeExecutionSection, type RuntimeExecution } from '@/components/messages/hermes/RuntimeInspectorRail'
import { DocumentContextPreview } from './DocumentContextPreview'
import type { ChatContextOption } from './ContextSelector'

export function ContextDock({ model, open, onClose, compact = false, activeArtifactId, onArtifactActivate, onAction, actionError, pendingActionId, execution, mode = 'single', onModeChange, canvasWidth = 520, onCanvasWidthChange, secondaryContext, secondaryOptions = [], onSecondaryChange }: { model: ChatContextReadModel; open: boolean; onClose: () => void; compact?: boolean; activeArtifactId?: string; onArtifactActivate?: (artifact: ChatArtifactSummary) => void; onAction?: (action: ChatContextAction) => void; actionError?: string | null; pendingActionId?: string; execution?: RuntimeExecution; mode?: 'single' | 'dual'; onModeChange?: (mode: 'single' | 'dual') => void; canvasWidth?: number; onCanvasWidthChange?: (width: number) => void; secondaryContext?: ChatContextOption; secondaryOptions?: ChatContextOption[]; onSecondaryChange?: (context: ChatContextOption) => void }) {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023px)').matches)
  const [wideDesktop, setWideDesktop] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1280px)').matches)
  const [secondaryModel, setSecondaryModel] = useState<ChatContextReadModel | null>(null)
  const [secondaryLoading, setSecondaryLoading] = useState(false)
  const [secondaryLoadFailed, setSecondaryLoadFailed] = useState(false)
  const [tabletFocus, setTabletFocus] = useState<'primary' | 'secondary'>('primary')
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
    fetch(`/api/v1/chat-context/${encodeURIComponent(secondaryContext.kind)}/${encodeURIComponent(secondaryContext.id)}`, { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error('Secondary context unavailable')))
      .then((body) => { if (!controller.signal.aborted) { setSecondaryModel(body?.data ?? null); setSecondaryLoadFailed(!body?.data) } })
      .catch(() => { if (!controller.signal.aborted) { setSecondaryModel(null); setSecondaryLoadFailed(true) } })
      .finally(() => { if (!controller.signal.aborted) setSecondaryLoading(false) })
    return () => controller.abort()
  }, [mode, open, secondaryContext, tabletLandscape, wideDesktop])
  useEffect(() => {
    setTabletFocus('primary')
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
  const visibleContext = visibleModel?.context ?? secondaryContext ?? model.context
  const visibleIcon = 'icon' in visibleContext ? visibleContext.icon : 'link'
  const groups = visibleModel?.groups.filter((group) => group.items.length) ?? []
  return <>{sheet && <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-30 bg-black/55" />}<aside ref={dialogRef} tabIndex={-1} role="dialog" aria-modal={sheet ? 'true' : 'false'} aria-label={`${visibleContext.label} context`} data-presentation={sheet ? 'sheet' : dual ? 'dual' : 'canvas'} style={!sheet && wideDesktop ? { width: `${canvasWidth}px` } : undefined} className={sheet ? 'fixed inset-0 z-40 flex flex-col overflow-hidden border border-[var(--color-card-border)] bg-[var(--color-surface,#151515)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] shadow-2xl' : `absolute bottom-0 right-0 top-[98px] z-40 flex w-[42%] min-w-[420px] max-w-[640px] flex-col overflow-hidden rounded-bl-xl border border-[var(--color-card-border)] bg-[var(--color-surface,#151515)] shadow-2xl xl:w-auto`}>
    {!sheet && wideDesktop && <button type="button" role="separator" aria-label="Resize context canvas" aria-orientation="vertical" aria-valuemin={420} aria-valuemax={640} aria-valuenow={canvasWidth} onKeyDown={(event) => { if (event.key === 'ArrowLeft') onCanvasWidthChange?.(Math.min(640, canvasWidth + 20)); if (event.key === 'ArrowRight') onCanvasWidthChange?.(Math.max(420, canvasWidth - 20)) }} onPointerDown={(event) => { resizeRef.current = { x: event.clientX, width: canvasWidth }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={(event) => { if (!resizeRef.current) return; onCanvasWidthChange?.(Math.min(640, Math.max(420, resizeRef.current.width + resizeRef.current.x - event.clientX))) }} onPointerUp={(event) => { resizeRef.current = null; event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={() => { resizeRef.current = null }} className="absolute -left-3 top-0 z-10 h-full w-6 cursor-col-resize touch-none bg-transparent outline-none before:absolute before:bottom-0 before:left-1/2 before:top-0 before:w-px before:-translate-x-1/2 before:bg-[var(--color-card-border)] hover:before:bg-primary/60 focus-visible:before:bg-primary" />}
    <header data-testid="context-dock-header" className="flex min-h-14 items-center gap-2 border-b border-[var(--color-card-border)] px-3 pb-2 pt-[max(.5rem,env(safe-area-inset-top))]"><span aria-hidden="true" className="material-symbols-outlined grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-[18px] text-primary">{visibleIcon}</span><div className="min-w-0 flex-1"><p className="text-[9px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">{visibleContext.kind.replaceAll('_', ' ')}</p><h2 className="truncate text-sm font-semibold text-[var(--color-pib-text)]">{visibleContext.label}</h2></div>{wideDesktop && secondaryOptions.length > 0 && <button type="button" aria-label={dual ? 'Use single context canvas' : 'Use dual context canvas'} aria-pressed={Boolean(dual)} onClick={() => onModeChange?.(dual ? 'single' : 'dual')} className="hidden h-8 items-center gap-1 rounded-lg border border-[var(--color-card-border)] px-2 text-[10px] text-[var(--color-pib-text-muted)] hover:bg-white/[0.06] xl:inline-flex"><span aria-hidden="true" className="material-symbols-outlined text-[15px]">splitscreen</span>{dual ? 'Single' : 'Dual focus'}</button>}<button ref={closeRef} type="button" aria-label="Close context dock" onClick={onClose} className="inline-flex h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs text-[var(--color-pib-text-muted)] outline-none hover:bg-white/[0.07] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 xl:h-8"><span className="material-symbols-outlined text-[17px]" aria-hidden="true">arrow_back</span>{sheet && <span>Back to chat</span>}</button></header>
    {tabletLandscape && secondaryContext && <div className="border-b border-[var(--color-card-border)] bg-black/10 px-3 py-2"><div role="tablist" aria-label="Context focus" className="grid grid-cols-2 gap-1 rounded-xl bg-black/20 p-1"><button ref={primaryTabRef} type="button" role="tab" tabIndex={tabletSecondaryActive ? -1 : 0} aria-selected={!tabletSecondaryActive} aria-controls="context-dock-scroll-body" onClick={() => setTabletFocus('primary')} onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'End') { event.preventDefault(); setTabletFocus('secondary'); secondaryTabRef.current?.focus() } }} className={`min-h-11 min-w-0 truncate rounded-lg px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${!tabletSecondaryActive ? 'bg-primary/15 font-semibold text-primary' : 'text-[var(--color-pib-text-muted)]'}`}>{model.context.label}</button><button ref={secondaryTabRef} type="button" role="tab" tabIndex={tabletSecondaryActive ? 0 : -1} aria-selected={tabletSecondaryActive} aria-controls="context-dock-scroll-body" onClick={() => setTabletFocus('secondary')} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'Home') { event.preventDefault(); setTabletFocus('primary'); primaryTabRef.current?.focus() } }} className={`min-h-11 min-w-0 truncate rounded-lg px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${tabletSecondaryActive ? 'bg-primary/15 font-semibold text-primary' : 'text-[var(--color-pib-text-muted)]'}`}>{secondaryContext.label}</button></div>{secondaryOptions.length > 1 && <select aria-label="Choose related context" value={`${secondaryContext.kind}:${secondaryContext.id}`} onChange={(event) => { const next = secondaryOptions.find((option) => `${option.kind}:${option.id}` === event.target.value); if (next) { onSecondaryChange?.(next); setTabletFocus('secondary') } }} className="mt-2 h-11 w-full rounded-lg border border-[var(--color-card-border)] bg-black/20 px-2 text-xs text-[var(--color-pib-text)]">{secondaryOptions.map((option) => <option key={`${option.kind}:${option.id}`} value={`${option.kind}:${option.id}`}>{option.label}</option>)}</select>}</div>}
    {dual && <div className="flex items-center gap-2 border-b border-[var(--color-card-border)] bg-black/10 px-3 py-2"><span className="text-[10px] font-label uppercase tracking-[0.15em] text-[var(--color-pib-text-muted)]">Second focus</span><select aria-label="Secondary context" value={`${secondaryContext.kind}:${secondaryContext.id}`} onChange={(event) => { const next = secondaryOptions.find((option) => `${option.kind}:${option.id}` === event.target.value); if (next) onSecondaryChange?.(next) }} className="h-11 min-w-0 flex-1 rounded-lg border border-[var(--color-card-border)] bg-black/20 px-2 py-1.5 text-xs text-[var(--color-pib-text)] xl:h-9">{secondaryOptions.map((option) => <option key={`${option.kind}:${option.id}`} value={`${option.kind}:${option.id}`}>{option.label}</option>)}</select></div>}
    <div id="context-dock-scroll-body" data-testid="context-dock-scroll-body" className={`min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))] ${dual ? 'grid content-start gap-3' : 'space-y-4'}`}>
      {tabletSecondaryActive && secondaryLoading && <div role="status" className="rounded-xl border border-[var(--color-card-border)] p-3 text-xs text-[var(--color-pib-text-muted)]">Loading related context…</div>}
      {tabletSecondaryActive && secondaryLoadFailed && <div role="alert" className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">This related context is unavailable.</div>}
      {actionError && <div role="alert" className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{actionError}</div>}
      {execution?.activeMessage?.runId && <RuntimeExecutionSection {...execution} />}
      {visibleModel?.context.kind === 'document' && <DocumentContextPreview documentId={visibleModel.context.id} />}
      {visibleModel?.preview?.kind === 'summary' && visibleModel.preview.text && <section className="rounded-xl border border-[var(--color-card-border)] bg-white/[0.025] p-3"><h3 className="text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">Preview</h3><p className="mt-2 text-xs leading-relaxed text-[var(--color-pib-text)]">{visibleModel.preview.text}</p></section>}
      {visibleModel && visibleModel.attention.length > 0 && <section aria-label="Attention" className="space-y-2">{visibleModel.attention.map((item) => <ContextAttentionMoment key={item.id} attention={item} onAction={onAction} pendingActionId={pendingActionId} />)}</section>}
      {groups.map((group) => <section key={group.id}><h3 className="mb-2 text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">{group.label}</h3><ul>{group.items.map((item) => <li key={item.id} className="border-b border-white/[0.06] py-2 text-xs text-[var(--color-pib-text)]">{item.label}</li>)}</ul></section>)}
      {visibleModel && visibleModel.artifacts.length > 0 && <section><h3 className="mb-2 text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">Artifacts</h3><div className="space-y-2">{visibleModel.artifacts.map((artifact) => <div key={artifact.id} data-active={artifact.id === activeArtifactId || undefined}><ContextArtifactCard artifact={artifact} selected={artifact.id === activeArtifactId} onActivate={onArtifactActivate} onAction={onAction} pendingActionId={pendingActionId} /></div>)}</div></section>}
      {visibleModel && visibleModel.activity.length > 0 && <section><h3 className="mb-2 text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">Activity</h3><ul>{visibleModel.activity.map((item) => <li key={item.id} className="py-1 text-[11px] text-[var(--color-pib-text-muted)]">{item.label}</li>)}</ul></section>}
      {visibleModel?.context.href && <a href={visibleModel.context.href} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/15 xl:min-h-9">Open full workspace<span aria-hidden="true" className="material-symbols-outlined text-[15px]">open_in_new</span></a>}
      {dual && <section className="rounded-xl border border-primary/20 bg-primary/[0.035] p-3"><p className="text-[9px] font-label uppercase tracking-[0.18em] text-primary">Related context</p><h3 className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">{secondaryModel?.context.label ?? secondaryContext.label}</h3><p className="mt-2 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">{secondaryModel?.pulse.headline ?? secondaryContext.summary ?? 'Live details load from the authoritative workspace.'}</p>{secondaryModel?.pulse.progress && <p className="mt-3 text-xs text-[var(--color-pib-text)]">{secondaryModel.pulse.progress.complete} of {secondaryModel.pulse.progress.total} complete</p>}{(secondaryModel?.context.href ?? secondaryContext.href) && <a href={secondaryModel?.context.href ?? secondaryContext.href} className="mt-3 inline-flex min-h-11 items-center gap-1 rounded-lg border border-[var(--color-card-border)] px-3 text-xs text-[var(--color-pib-text)] xl:min-h-9">Open workspace<span aria-hidden="true" className="material-symbols-outlined text-[14px]">open_in_new</span></a>}</section>}
    </div>
  </aside></>
}
