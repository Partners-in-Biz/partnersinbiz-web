'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatArtifactSummary, ChatContextAction } from '@/lib/chat-context/types'
import { ContextDock } from './ContextDock'
import { ContextStrip, EmptyContextStrip } from './ContextStrip'
import type { ReturnTypeOfUseChatContexts } from './internalTypes'
import type { RuntimeExecution } from '@/components/messages/hermes/RuntimeInspectorRail'
import type { ChatContextReadModel, ChatContextReference } from '@/lib/chat-context/types'
import type { ChatContextOption } from './ContextSelector'

const executionOnlyModel: ChatContextReadModel = {
  context: { kind: 'studio', id: 'execution', orgId: '', label: 'Conversation', icon: 'developer_board' },
  pulse: { label: 'Execution', metrics: [] }, groups: [], artifacts: [], attention: [], activity: [], capabilities: [], asOf: '',
}

export function ChatContextExperience({ context, compact = false, artifactRequest, execution, executionRequest, onActionResolved, onRemoveContext, onAddContext, contextPickerExpanded, contextPickerControls, onOpenChange, onPresentationChange }: { context: ReturnTypeOfUseChatContexts; compact?: boolean; artifactRequest?: { id: string; nonce: number }; execution?: RuntimeExecution; executionRequest?: number; onActionResolved?: () => void; onRemoveContext?: (value: ChatContextReference) => void; onAddContext?: () => void; contextPickerExpanded?: boolean; contextPickerControls?: string; onOpenChange?: (open: boolean) => void; onPresentationChange?: (state: { open: boolean; mode: 'single' | 'dual' }) => void }) {
  const [open, setOpen] = useState(false)
  const [canvasMode, setCanvasMode] = useState<'single' | 'dual'>('single')
  const [canvasWidth, setCanvasWidth] = useState(520)
  const [loadedCanvasStorageKey, setLoadedCanvasStorageKey] = useState('')
  const [secondaryContext, setSecondaryContext] = useState<ChatContextOption>()
  const [activeArtifactId, setActiveArtifactId] = useState<string>()
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingActionId, setPendingActionId] = useState<string>()
  const pendingRef = useRef<string | undefined>(undefined)
  const [pendingStoredSecondary, setPendingStoredSecondary] = useState<{ storageKey: string; reference: ChatContextReference; hydrationRevision: string } | null>(null)
  const secondaryOptions = useMemo<ChatContextOption[]>(() => {
    const options = new Map<string, ChatContextOption>()
    for (const option of context.contexts) {
      if (option.kind !== context.activeContext?.kind || option.id !== context.activeContext?.id) options.set(`${option.kind}:${option.id}`, option)
    }
    for (const relationship of context.model?.relationships ?? []) {
      if (relationship.kind !== context.activeContext?.kind || relationship.id !== context.activeContext?.id) options.set(`${relationship.kind}:${relationship.id}`, { kind: relationship.kind, id: relationship.id, label: relationship.label, ...(relationship.href ? { href: relationship.href } : {}) })
    }
    return [...options.values()]
  }, [context.activeContext?.id, context.activeContext?.kind, context.contexts, context.model?.relationships])
  const secondaryOptionsRef = useRef(secondaryOptions)
  secondaryOptionsRef.current = secondaryOptions
  const secondaryHydrationRevision = useMemo(() => {
    if (!context.model
      || context.model.context.kind !== context.activeContext?.kind
      || context.model.context.id !== context.activeContext?.id) return 'loading'
    const relationships = (context.model.relationships ?? [])
      .map((relationship) => `${relationship.kind}:${relationship.id}`)
      .sort()
      .join('|')
    return `${context.model.asOf}:${relationships}`
  }, [context.activeContext?.id, context.activeContext?.kind, context.model])
  const secondaryHydrationRevisionRef = useRef(secondaryHydrationRevision)
  secondaryHydrationRevisionRef.current = secondaryHydrationRevision
  const canvasStorageKey = context.conversationId && context.orgId ? `pib.messages.contextCanvas.v1:${context.orgId}:${context.conversationId}` : ''
  const actionOperationIdentity = `${canvasStorageKey}:${context.activeContext?.kind ?? ''}:${context.activeContext?.id ?? ''}`
  const actionOperationIdentityRef = useRef(actionOperationIdentity)
  actionOperationIdentityRef.current = actionOperationIdentity
  useEffect(() => { onOpenChange?.(open) }, [onOpenChange, open])
  useEffect(() => { onPresentationChange?.({ open, mode: canvasMode }) }, [canvasMode, onPresentationChange, open])
  useEffect(() => {
    pendingRef.current = undefined
    setPendingActionId(undefined)
    setActionError(null)
  }, [actionOperationIdentity])
  useEffect(() => {
    if (!canvasStorageKey) {
      setLoadedCanvasStorageKey('')
      setPendingStoredSecondary(null)
      return
    }
    try {
      const stored = JSON.parse(window.localStorage.getItem(canvasStorageKey) ?? 'null') as { open?: unknown; mode?: unknown; width?: unknown; secondary?: ChatContextReference } | null
      setOpen(stored?.open === true)
      setCanvasMode(stored?.mode === 'dual' ? 'dual' : 'single')
      const storedWidth = Number(stored?.width)
      setCanvasWidth(Number.isFinite(storedWidth) ? Math.min(640, Math.max(420, storedWidth)) : 520)
      const candidate = stored?.secondary && secondaryOptionsRef.current.find((option) => option.kind === stored.secondary?.kind && option.id === stored.secondary.id)
      if (stored?.secondary && !candidate) {
        setPendingStoredSecondary({ storageKey: canvasStorageKey, reference: stored.secondary, hydrationRevision: secondaryHydrationRevisionRef.current })
        setSecondaryContext(secondaryOptionsRef.current[0])
      } else {
        setPendingStoredSecondary(null)
        setSecondaryContext(candidate ?? secondaryOptionsRef.current[0])
      }
    } catch {
      setPendingStoredSecondary(null)
      setCanvasMode('single')
      setCanvasWidth(520)
      setSecondaryContext(secondaryOptionsRef.current[0])
    }
    setLoadedCanvasStorageKey(canvasStorageKey)
  }, [canvasStorageKey])
  useEffect(() => {
    if (!canvasStorageKey || loadedCanvasStorageKey !== canvasStorageKey) return
    if (pendingStoredSecondary?.storageKey === canvasStorageKey) {
      const restored = secondaryOptions.find((option) => option.kind === pendingStoredSecondary.reference.kind && option.id === pendingStoredSecondary.reference.id)
      if (restored) {
        setPendingStoredSecondary(null)
        setSecondaryContext(restored)
        return
      }
      if (pendingStoredSecondary.hydrationRevision === secondaryHydrationRevision) return
      setPendingStoredSecondary(null)
    }
    if (secondaryContext && secondaryOptions.some((option) => option.kind === secondaryContext.kind && option.id === secondaryContext.id)) return
    setSecondaryContext(secondaryOptions[0])
  }, [canvasStorageKey, loadedCanvasStorageKey, pendingStoredSecondary, secondaryContext, secondaryHydrationRevision, secondaryOptions])
  useEffect(() => {
    if (!canvasStorageKey || loadedCanvasStorageKey !== canvasStorageKey) return
    const storedSecondary = pendingStoredSecondary?.storageKey === canvasStorageKey
      ? pendingStoredSecondary.reference
      : secondaryContext ? { kind: secondaryContext.kind, id: secondaryContext.id } : undefined
    try { window.localStorage.setItem(canvasStorageKey, JSON.stringify({ open, mode: canvasMode, width: canvasWidth, secondary: storedSecondary })) } catch (storageError) { void storageError /* Storage policy must not break Messages. */ }
  }, [canvasMode, canvasStorageKey, canvasWidth, loadedCanvasStorageKey, open, pendingStoredSecondary, secondaryContext])
  useEffect(() => {
    if (!artifactRequest) return
    setActiveArtifactId(artifactRequest.id)
    setOpen(true)
  }, [artifactRequest])
  useEffect(() => { if (executionRequest) setOpen(true) }, [executionRequest])
  const hasExecution = Boolean(execution?.activeMessage?.runId)
  if ((!context.model || !context.activeContext) && !hasExecution) return <>
    {context.activeContext && context.contexts.length > 0
      ? <ContextStrip options={context.contexts} value={context.activeContext} onChange={context.setActiveContext} onRemove={onRemoveContext} onAdd={onAddContext} pickerExpanded={contextPickerExpanded} pickerControls={contextPickerControls} onOpen={() => { void context.refresh() }} />
      : onAddContext ? <EmptyContextStrip onAdd={onAddContext} pickerExpanded={contextPickerExpanded} pickerControls={contextPickerControls} /> : null}
    {context.error && <div role="alert" className="border-b border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">Unable to load context. <button type="button" aria-label="Retry context" onClick={() => { void context.refresh() }} className="min-h-11 px-2 underline xl:min-h-0">Retry</button></div>}
  </>
  const model = context.model ?? executionOnlyModel
  const activateArtifact = (artifact: ChatArtifactSummary) => { setActiveArtifactId(artifact.id); setOpen(true) }
  const executeAction = async (action: ChatContextAction) => {
    if (!action.href || !action.method) return
    if (pendingRef.current) return
    if ((action.destructive || action.requiresApproval) && !window.confirm(`${action.label} requires confirmation. Continue?`)) return
    const initiatingOperationIdentity = actionOperationIdentity
    pendingRef.current = action.id; setPendingActionId(action.id)
    setActionError(null)
    try {
      const response = await fetch(action.href, { method: action.method, headers: action.body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: action.body === undefined ? undefined : JSON.stringify(action.body) })
      if (!response.ok) {
        const body = typeof response.json === 'function' ? await response.json().catch(() => null) as { error?: unknown } | null : null
        const safeError = typeof body?.error === 'string' ? body.error.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 180) : ''
        throw new Error(safeError || `Context action failed (${response.status}). Try again.`)
      }
      if (actionOperationIdentityRef.current !== initiatingOperationIdentity) return
      await context.refresh()
      if (actionOperationIdentityRef.current !== initiatingOperationIdentity) return
      onActionResolved?.()
    } catch (cause) {
      if (actionOperationIdentityRef.current === initiatingOperationIdentity) setActionError(cause instanceof Error ? cause.message : 'Context action failed. Try again.')
    } finally {
      if (actionOperationIdentityRef.current === initiatingOperationIdentity && pendingRef.current === action.id) {
        pendingRef.current = undefined
        setPendingActionId(undefined)
      }
    }
  }
  return <>
    {context.model && context.activeContext
      ? <ContextStrip options={context.contexts} value={context.activeContext} model={context.model} onChange={context.setActiveContext} onRemove={onRemoveContext} onAdd={onAddContext} pickerExpanded={contextPickerExpanded} pickerControls={contextPickerControls} onOpen={() => setOpen(true)} />
      : onAddContext ? <EmptyContextStrip onAdd={onAddContext} pickerExpanded={contextPickerExpanded} pickerControls={contextPickerControls} /> : null}
    {!context.model && !context.activeContext && <button type="button" data-testid="execution-context-trigger" onClick={() => setOpen(true)} className="mx-3 mt-2 inline-flex h-11 items-center gap-2 self-start rounded-full border border-[var(--color-card-border)] bg-white/[0.04] px-3 text-xs text-[var(--color-pib-text)] outline-none focus-visible:ring-2 focus-visible:ring-primary/60 xl:h-8"><span aria-hidden="true" className="material-symbols-outlined text-[15px]">developer_board</span>Execution <span className="text-[var(--color-pib-text-muted)]">{execution?.activeMessage?.status}</span></button>}
    <ContextDock model={model} open={open} compact={compact} activeArtifactId={activeArtifactId} onArtifactActivate={activateArtifact} onAction={(action) => { void executeAction(action) }} actionError={actionError} pendingActionId={pendingActionId} execution={execution} mode={canvasMode} onModeChange={setCanvasMode} canvasWidth={canvasWidth} onCanvasWidthChange={setCanvasWidth} secondaryContext={secondaryContext} secondaryOptions={secondaryOptions} onSecondaryChange={(next) => { setPendingStoredSecondary(null); setSecondaryContext(next) }} onClose={() => setOpen(false)} />
  </>
}
