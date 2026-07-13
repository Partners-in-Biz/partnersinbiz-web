'use client'

import { useEffect, useRef, useState } from 'react'
import type { ChatArtifactSummary, ChatContextAction } from '@/lib/chat-context/types'
import { ContextDock } from './ContextDock'
import { ContextPulse } from './ContextPulse'
import type { ReturnTypeOfUseChatContexts } from './internalTypes'

export function ChatContextExperience({ context, compact = false, artifactRequest }: { context: ReturnTypeOfUseChatContexts; compact?: boolean; artifactRequest?: { id: string; nonce: number } }) {
  const [open, setOpen] = useState(false)
  const [activeArtifactId, setActiveArtifactId] = useState<string>()
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingActionId, setPendingActionId] = useState<string>()
  const pendingRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!artifactRequest) return
    setActiveArtifactId(artifactRequest.id)
    setOpen(true)
  }, [artifactRequest])
  if (!context.model || !context.activeContext) return context.error ? <div role="alert" className="border-b border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">Unable to load context. <button type="button" aria-label="Retry context" onClick={() => { void context.refresh() }} className="underline">Retry</button></div> : null
  const activateArtifact = (artifact: ChatArtifactSummary) => { setActiveArtifactId(artifact.id); setOpen(true) }
  const executeAction = async (action: ChatContextAction) => {
    if (!action.href || !action.method) return
    if (pendingRef.current) return
    if ((action.destructive || action.requiresApproval) && !window.confirm(`${action.label} requires confirmation. Continue?`)) return
    pendingRef.current = action.id; setPendingActionId(action.id)
    setActionError(null)
    try {
      const response = await fetch(action.href, { method: action.method, headers: action.body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: action.body === undefined ? undefined : JSON.stringify(action.body) })
      if (!response.ok) {
        const body = typeof response.json === 'function' ? await response.json().catch(() => null) as { error?: unknown } | null : null
        const safeError = typeof body?.error === 'string' ? body.error.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 180) : ''
        throw new Error(safeError || `Context action failed (${response.status}). Try again.`)
      }
      await context.refresh()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Context action failed. Try again.')
    } finally {
      pendingRef.current = undefined; setPendingActionId(undefined)
    }
  }
  return <>
    <ContextPulse model={context.model} contexts={context.contexts} activeContext={context.activeContext} onContextChange={context.setActiveContext} onOpen={() => setOpen(true)} />
    <ContextDock model={context.model} open={open} compact={compact} activeArtifactId={activeArtifactId} onArtifactActivate={activateArtifact} onAction={(action) => { void executeAction(action) }} actionError={actionError} pendingActionId={pendingActionId} onClose={() => setOpen(false)} />
  </>
}
