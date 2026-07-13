'use client'

import { useEffect, useRef, useState } from 'react'
import type { ChatContextReadModel, ChatArtifactSummary, ChatContextAction } from '@/lib/chat-context/types'
import { ContextArtifactCard } from './ContextArtifactCard'
import { ContextAttentionMoment } from './ContextAttentionMoment'
import { RuntimeExecutionSection, type RuntimeExecution } from '@/components/messages/hermes/RuntimeInspectorRail'

export function ContextDock({ model, open, onClose, compact = false, activeArtifactId, onArtifactActivate, onAction, actionError, pendingActionId, execution }: { model: ChatContextReadModel; open: boolean; onClose: () => void; compact?: boolean; activeArtifactId?: string; onArtifactActivate?: (artifact: ChatArtifactSummary) => void; onAction?: (action: ChatContextAction) => void; actionError?: string | null; pendingActionId?: string; execution?: RuntimeExecution }) {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023px)').matches)
  const sheet = compact || mobile
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
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
  const groups = model.groups.filter((group) => group.items.length)
  return <>{sheet && <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-30 bg-black/45" />}<aside ref={dialogRef} tabIndex={-1} role="dialog" aria-modal={sheet ? 'true' : 'false'} aria-label={`${model.context.label} context`} data-presentation={sheet ? 'sheet' : 'drawer'} className={sheet ? 'fixed inset-x-2 bottom-2 top-[14%] z-40 flex flex-col overflow-hidden rounded-xl border border-[var(--color-card-border)] bg-[var(--color-surface,#151515)] shadow-2xl' : 'absolute inset-y-0 right-0 z-40 flex w-[340px] flex-col overflow-hidden rounded-r-xl border border-[var(--color-card-border)] bg-[var(--color-surface,#151515)] shadow-2xl'}>
    <header className="flex items-start gap-2 border-b border-[var(--color-card-border)] p-3"><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold text-on-surface">{model.context.label}</h2>{model.pulse.headline && <p className="mt-1 text-[11px] text-on-surface-variant">{model.pulse.headline}</p>}</div><button ref={closeRef} type="button" aria-label="Close context dock" onClick={onClose} className="grid h-7 w-7 place-items-center rounded-md text-on-surface-variant outline-none hover:bg-white/[0.07] hover:text-on-surface focus-visible:ring-2 focus-visible:ring-primary/60"><span className="material-symbols-outlined text-[17px]" aria-hidden="true">close</span></button></header>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
      {actionError && <div role="alert" className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{actionError}</div>}
      {execution?.activeMessage?.runId && <RuntimeExecutionSection {...execution} />}
      {model.attention.length > 0 && <section aria-label="Attention" className="space-y-2">{model.attention.map((item) => <ContextAttentionMoment key={item.id} attention={item} onAction={onAction} pendingActionId={pendingActionId} />)}</section>}
      {groups.map((group) => <section key={group.id}><h3 className="mb-2 text-[10px] font-label uppercase tracking-[0.18em] text-on-surface-variant">{group.label}</h3><ul>{group.items.map((item) => <li key={item.id} className="border-b border-white/[0.06] py-2 text-xs text-on-surface">{item.label}</li>)}</ul></section>)}
      {model.artifacts.length > 0 && <section><h3 className="mb-2 text-[10px] font-label uppercase tracking-[0.18em] text-on-surface-variant">Artifacts</h3><div className="space-y-2">{model.artifacts.map((artifact) => <div key={artifact.id} data-active={artifact.id === activeArtifactId || undefined}><ContextArtifactCard artifact={artifact} selected={artifact.id === activeArtifactId} onActivate={onArtifactActivate} onAction={onAction} pendingActionId={pendingActionId} /></div>)}</div></section>}
      {model.activity.length > 0 && <section><h3 className="mb-2 text-[10px] font-label uppercase tracking-[0.18em] text-on-surface-variant">Activity</h3><ul>{model.activity.map((item) => <li key={item.id} className="py-1 text-[11px] text-on-surface-variant">{item.label}</li>)}</ul></section>}
    </div>
  </aside></>
}
