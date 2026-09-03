'use client'

import { Icon } from '@/components/studio'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatArtifactSummary, ChatContextAction, ChatContextActionReceipt } from '@/lib/chat-context/types'
import { ContextDock, CONTEXT_CANVAS_MAX_WIDTH, CONTEXT_CANVAS_MIN_WIDTH } from './ContextDock'
import { ContextStrip, EmptyContextStrip } from './ContextStrip'
import type { ReturnTypeOfUseChatContexts } from './internalTypes'
import type { RuntimeExecution } from '@/components/messages/hermes/RuntimeInspectorRail'
import { chatContextReferenceKey, type ChatContextReadModel, type ChatContextReference } from '@/lib/chat-context/types'
import type { ChatContextOption } from './ContextSelector'
import { useOpenDockPolling } from './usePreviewLiveReload'
import { MOBILE_CONVERSATION_HIDDEN_FLEX_CLASS } from '@/lib/messages/mobile-conversation-chrome'

const executionOnlyModel: ChatContextReadModel = {
  context: { kind: 'studio', id: 'execution', orgId: '', label: 'Conversation', icon: 'developer_board' },
  pulse: { label: 'Execution', metrics: [] }, groups: [], artifacts: [], attention: [], activity: [], capabilities: [], asOf: '',
}

export function ChatContextExperience({ context, compact = false, artifactRequest, focusRequest, execution, executionRequest, closeRequest = 0, previewRefreshSignal = 0, onActionResolved, onRemoveContext, onAddContext, contextPickerExpanded, contextPickerControls, onOpenChange, onPresentationChange, preferCanvas = false, hideFirstPaintChrome = false }: { context: ReturnTypeOfUseChatContexts; compact?: boolean; artifactRequest?: { id: string; nonce: number }; focusRequest?: { kind: ChatContextReference['kind']; id: string; projectId?: string; nonce: number }; execution?: RuntimeExecution; executionRequest?: number; closeRequest?: number; /** Bumps when parent messages/runs change so dock previews soft-reload. */ previewRefreshSignal?: number; onActionResolved?: () => void; onRemoveContext?: (value: ChatContextReference) => void; onAddContext?: () => void; contextPickerExpanded?: boolean; contextPickerControls?: string; onOpenChange?: (open: boolean) => void; onPresentationChange?: (state: { open: boolean; mode: 'single' | 'dual'; width: number }) => void; preferCanvas?: boolean; hideFirstPaintChrome?: boolean }) {
  const [open, setOpen] = useState(false)
  const [canvasMode, setCanvasMode] = useState<'single' | 'dual'>('single')
  const [canvasWidth, setCanvasWidth] = useState(520)
  const [loadedCanvasStorageKey, setLoadedCanvasStorageKey] = useState('')
  const [secondaryContext, setSecondaryContext] = useState<ChatContextOption>()
  const [activeArtifactId, setActiveArtifactId] = useState<string>()
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionReceipt, setActionReceipt] = useState<ChatContextActionReceipt | null>(null)
  const [pendingActionId, setPendingActionId] = useState<string>()
  const [secondaryRefreshRevision, setSecondaryRefreshRevision] = useState(0)
  const [previewRefreshRevision, setPreviewRefreshRevision] = useState(0)
  const lastExecutionStatusRef = useRef<string | undefined>(undefined)
  const lastFocusRequestNonceRef = useRef<number | undefined>(undefined)
  const lastArtifactRequestNonceRef = useRef<number | undefined>(undefined)
  const lastExecutionRequestRef = useRef<number | undefined>(undefined)
  const setActiveContextRef = useRef(context.setActiveContext)
  setActiveContextRef.current = context.setActiveContext
  const pendingRef = useRef<string | undefined>(undefined)
  const actionIdempotencyRef = useRef(new Map<string, string>())
  const [pendingStoredSecondary, setPendingStoredSecondary] = useState<{ storageKey: string; reference: ChatContextReference; hydrationRevision: string } | null>(null)
  const secondaryOptions = useMemo<ChatContextOption[]>(() => {
    const options = new Map<string, ChatContextOption>()
    for (const option of context.contexts) {
      if (chatContextReferenceKey(option) !== (context.activeContext ? chatContextReferenceKey(context.activeContext) : '')) options.set(chatContextReferenceKey(option), option)
    }
    for (const relationship of context.model?.relationships ?? []) {
      const option = { kind: relationship.kind, id: relationship.id, label: relationship.label, ...(relationship.href ? { href: relationship.href } : {}) }
      if (chatContextReferenceKey(option) !== (context.activeContext ? chatContextReferenceKey(context.activeContext) : '')) options.set(chatContextReferenceKey(option), option)
    }
    return [...options.values()]
  }, [context.activeContext?.id, context.activeContext?.kind, context.activeContext?.projectId, context.contexts, context.model?.relationships])
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
  const actionOperationIdentity = `${canvasStorageKey}:${context.activeContext ? chatContextReferenceKey(context.activeContext) : ''}:${secondaryContext ? chatContextReferenceKey(secondaryContext) : ''}`
  const actionOperationIdentityRef = useRef(actionOperationIdentity)
  actionOperationIdentityRef.current = actionOperationIdentity
  useEffect(() => { onOpenChange?.(open) }, [onOpenChange, open])
  useEffect(() => { onPresentationChange?.({ open, mode: canvasMode, width: canvasWidth }) }, [canvasMode, canvasWidth, onPresentationChange, open])
  useEffect(() => { if (closeRequest > 0) setOpen(false) }, [closeRequest])
  useEffect(() => {
    pendingRef.current = undefined
    setPendingActionId(undefined)
    setActionError(null)
    setActionReceipt(null)
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
      setCanvasWidth(Number.isFinite(storedWidth) ? Math.min(CONTEXT_CANVAS_MAX_WIDTH, Math.max(CONTEXT_CANVAS_MIN_WIDTH, storedWidth)) : 520)
      const candidate = stored?.secondary && secondaryOptionsRef.current.find((option) => chatContextReferenceKey(option) === chatContextReferenceKey(stored.secondary!))
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
    if (!preferCanvas || hideFirstPaintChrome) return
    if (!canvasStorageKey || loadedCanvasStorageKey !== canvasStorageKey) return
    const hasSurface = Boolean(context.activeContext) || (context.model?.artifacts?.length ?? 0) > 0
    if (!hasSurface) return
    try {
      const stored = JSON.parse(window.localStorage.getItem(canvasStorageKey) ?? 'null') as { open?: unknown } | null
      if (stored && typeof stored.open === 'boolean') return
    } catch {
      // Ignore canvas storage policy failures.
    }
    setOpen(true)
  }, [canvasStorageKey, context.activeContext, context.model?.artifacts?.length, hideFirstPaintChrome, loadedCanvasStorageKey, preferCanvas])
  useEffect(() => {
    if (!canvasStorageKey || loadedCanvasStorageKey !== canvasStorageKey) return
    if (pendingStoredSecondary?.storageKey === canvasStorageKey) {
      const restored = secondaryOptions.find((option) => chatContextReferenceKey(option) === chatContextReferenceKey(pendingStoredSecondary.reference))
      if (restored) {
        setPendingStoredSecondary(null)
        setSecondaryContext(restored)
        return
      }
      if (pendingStoredSecondary.hydrationRevision === secondaryHydrationRevision) return
      setPendingStoredSecondary(null)
    }
    if (secondaryContext && secondaryOptions.some((option) => chatContextReferenceKey(option) === chatContextReferenceKey(secondaryContext))) return
    setSecondaryContext(secondaryOptions[0])
  }, [canvasStorageKey, loadedCanvasStorageKey, pendingStoredSecondary, secondaryContext, secondaryHydrationRevision, secondaryOptions])
  useEffect(() => {
    if (!canvasStorageKey || loadedCanvasStorageKey !== canvasStorageKey) return
    const storedSecondary = pendingStoredSecondary?.storageKey === canvasStorageKey
      ? pendingStoredSecondary.reference
      : secondaryContext ? { kind: secondaryContext.kind, id: secondaryContext.id, ...(secondaryContext.projectId ? { projectId: secondaryContext.projectId } : {}) } : undefined
    try { window.localStorage.setItem(canvasStorageKey, JSON.stringify({ open, mode: canvasMode, width: canvasWidth, secondary: storedSecondary })) } catch (storageError) { void storageError /* Storage policy must not break Messages. */ }
  }, [canvasMode, canvasStorageKey, canvasWidth, loadedCanvasStorageKey, open, pendingStoredSecondary, secondaryContext])
  useEffect(() => {
    if (!artifactRequest) return
    // Only open on a new request nonce. Re-renders / unstable parent callbacks must not force the dock back open after the user closes it.
    if (lastArtifactRequestNonceRef.current === artifactRequest.nonce) return
    lastArtifactRequestNonceRef.current = artifactRequest.nonce
    setActiveArtifactId(artifactRequest.id)
    setOpen(true)
  }, [artifactRequest])
  useEffect(() => {
    if (!focusRequest) return
    // Gate on nonce only. focusRequest stays mounted after open_context handoff; setActiveContext identity
    // changes whenever conversation contextRefs refresh, which previously re-opened the dock after close.
    if (lastFocusRequestNonceRef.current === focusRequest.nonce) return
    lastFocusRequestNonceRef.current = focusRequest.nonce
    setActiveContextRef.current({
      kind: focusRequest.kind,
      id: focusRequest.id,
      ...(focusRequest.projectId ? { projectId: focusRequest.projectId } : {}),
    })
    setOpen(true)
    setPreviewRefreshRevision((revision) => revision + 1)
  }, [focusRequest])
  useEffect(() => {
    if (!executionRequest) return
    if (lastExecutionRequestRef.current === executionRequest) return
    lastExecutionRequestRef.current = executionRequest
    setOpen(true)
  }, [executionRequest])

  const refreshContext = context.refresh

  // When an agent run finishes, soft-reload dock previews (same id stays focused).
  useEffect(() => {
    const status = execution?.activeMessage?.status
    const prev = lastExecutionStatusRef.current
    lastExecutionStatusRef.current = status
    if (!status || status === prev) return
    if (status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'error') {
      setPreviewRefreshRevision((revision) => revision + 1)
      setSecondaryRefreshRevision((revision) => revision + 1)
      void refreshContext()
    }
  }, [execution?.activeMessage?.status, refreshContext])

  // Parent message stream / content updates
  useEffect(() => {
    if (!previewRefreshSignal) return
    setPreviewRefreshRevision((revision) => revision + 1)
    void refreshContext()
  }, [previewRefreshSignal, refreshContext])

  // While dock is open, poll so agent mid-run writes still surface.
  useOpenDockPolling(open, () => {
    setPreviewRefreshRevision((revision) => revision + 1)
    setSecondaryRefreshRevision((revision) => revision + 1)
  }, 6_000)

  const hasExecution = Boolean(execution?.activeMessage?.runId)
  const firstPaintChromeClass = compact ? undefined : MOBILE_CONVERSATION_HIDDEN_FLEX_CLASS
  const executionTriggerClass = compact ? 'inline-flex' : 'hidden md:inline-flex'
  if ((!context.model || !context.activeContext) && !hasExecution) return <>
    {context.activeContext && context.contexts.length > 0
      ? <ContextStrip options={context.contexts} value={context.activeContext} onChange={context.setActiveContext} onRemove={onRemoveContext} onAdd={onAddContext} pickerExpanded={contextPickerExpanded} pickerControls={contextPickerControls} onOpen={() => { void context.refresh() }} className={firstPaintChromeClass} />
      : onAddContext ? <EmptyContextStrip onAdd={onAddContext} pickerExpanded={contextPickerExpanded} pickerControls={contextPickerControls} className={firstPaintChromeClass} /> : null}
    {context.error && <div role="alert" className="border-b border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">Unable to load context. <button type="button" aria-label="Retry context" onClick={() => { void context.refresh() }} className="min-h-11 px-2 underline xl:min-h-0">Retry</button></div>}
  </>
  const model = context.model ?? executionOnlyModel
  const activateArtifact = (artifact: ChatArtifactSummary) => { setActiveArtifactId(artifact.id); setOpen(true) }
  const executeAction = async (action: ChatContextAction, actionContext?: ChatContextOption) => {
    if (!action.href || !action.method) return
    if (pendingRef.current) return
    if (!context.conversationId) {
      setActionError('This action needs a saved conversation. Refresh Messages and try again.')
      return
    }
    const confirmed = action.destructive || action.requiresApproval
      ? window.confirm(`${action.label} requires confirmation. Continue?`)
      : false
    if ((action.destructive || action.requiresApproval) && !confirmed) return
    const targetContext = actionContext ?? context.activeContext
    if (!targetContext) return
    const initiatingOperationIdentity = actionOperationIdentity
    const operationKey = `${initiatingOperationIdentity}:${targetContext.kind}:${targetContext.id}:${action.id}:${action.method}:${action.href}:${JSON.stringify(action.body ?? null)}`
    let idempotencyKey = actionIdempotencyRef.current.get(operationKey)
    if (!idempotencyKey) {
      const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      idempotencyKey = `chat-action-${randomId}`
      actionIdempotencyRef.current.set(operationKey, idempotencyKey)
    }
    pendingRef.current = action.id; setPendingActionId(action.id)
    setActionError(null)
    setActionReceipt(null)
    try {
      const response = await fetch(`/api/v1/conversations/${encodeURIComponent(context.conversationId)}/context-actions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          context: {
            kind: targetContext.kind,
            id: targetContext.id,
            ...(targetContext.projectId ? { projectId: targetContext.projectId } : {}),
          },
          action,
          confirmed,
        }),
      })
      const body = typeof response.json === 'function'
        ? await response.json().catch(() => null) as { data?: { receipt?: ChatContextActionReceipt }; receipt?: ChatContextActionReceipt; error?: unknown } | null
        : null
      let receipt = body?.data?.receipt ?? body?.receipt
      if (receipt && actionOperationIdentityRef.current === initiatingOperationIdentity) setActionReceipt(receipt)
      if (!response.ok) {
        actionIdempotencyRef.current.delete(operationKey)
        const safeError = typeof body?.error === 'string' ? body.error.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 180) : ''
        throw new Error(safeError || `Context action failed (${response.status}). Try again.`)
      }
      if (!receipt) throw new Error('The action completed without a verifiable receipt. Refresh and check the live record.')
      for (let attempt = 0; receipt.status === 'running' && attempt < 15; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000))
        if (actionOperationIdentityRef.current !== initiatingOperationIdentity) return
        const receiptResponse = await fetch(
          `/api/v1/conversations/${encodeURIComponent(context.conversationId)}/context-actions?receiptId=${encodeURIComponent(receipt.id)}`,
          { cache: 'no-store' },
        )
        if (!receiptResponse.ok) continue
        const receiptBody = await receiptResponse.json().catch(() => null) as { data?: { receipt?: ChatContextActionReceipt } } | null
        if (receiptBody?.data?.receipt) {
          receipt = receiptBody.data.receipt
          setActionReceipt(receipt)
        }
      }
      if (receipt.status === 'succeeded' || receipt.status === 'failed') {
        actionIdempotencyRef.current.delete(operationKey)
      }
      if (actionOperationIdentityRef.current !== initiatingOperationIdentity) return
      if (receipt.status === 'succeeded') {
        if (actionContext) setSecondaryRefreshRevision((revision) => revision + 1)
        await context.refresh()
        if (actionOperationIdentityRef.current !== initiatingOperationIdentity) return
        onActionResolved?.()
      } else if (receipt.status === 'indeterminate') {
        setActionError(receipt.error ?? 'The result is unknown. Check the live record before retrying.')
      } else if (receipt.status === 'running') {
        setActionError('This action is still running. Its receipt will be reused if you check again.')
      }
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
      ? <ContextStrip options={context.contexts} value={context.activeContext} model={context.model} onChange={context.setActiveContext} onRemove={onRemoveContext} onAdd={onAddContext} pickerExpanded={contextPickerExpanded} pickerControls={contextPickerControls} onOpen={() => setOpen(true)} className={firstPaintChromeClass} />
      : onAddContext ? <EmptyContextStrip onAdd={onAddContext} pickerExpanded={contextPickerExpanded} pickerControls={contextPickerControls} className={firstPaintChromeClass} /> : null}
    {!context.model && !context.activeContext && <button type="button" data-testid="execution-context-trigger" onClick={() => setOpen(true)} className={`mx-3 mt-2 h-11 items-center gap-2 self-start rounded-[4px] border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-3 text-xs text-[var(--color-pib-text)] outline-none focus-visible:ring-2 focus-visible:ring-primary/60 xl:h-8 ${executionTriggerClass}`}><Icon name="developer_board" className="text-[15px]" />Execution <span className="text-[var(--color-pib-text-muted)]">{execution?.activeMessage?.status}</span></button>}
    <ContextDock model={model} open={open} compact={compact} activeArtifactId={activeArtifactId} onArtifactActivate={activateArtifact} onAction={(action, actionContext) => { void executeAction(action, actionContext) }} actionError={actionError} actionReceipt={actionReceipt} pendingActionId={pendingActionId} execution={execution} mode={canvasMode} onModeChange={setCanvasMode} canvasWidth={canvasWidth} onCanvasWidthChange={setCanvasWidth} secondaryContext={secondaryContext} secondaryOptions={secondaryOptions} onSecondaryChange={(next) => { setPendingStoredSecondary(null); setSecondaryContext(next) }} secondaryRefreshRevision={secondaryRefreshRevision} previewRefreshRevision={previewRefreshRevision} workbenchFolder={context.activeContext?.kind === 'workspace_folder' && context.activeContext.workbenchPath && context.conversationId ? { conversationId: context.conversationId, path: context.activeContext.workbenchPath } : undefined} onClose={() => setOpen(false)} />
  </>
}
