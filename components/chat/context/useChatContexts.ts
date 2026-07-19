'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { selectActiveContext } from '@/lib/chat-context/selection'
import type { ChatContextReadModel, ChatContextReference } from '@/lib/chat-context/types'
import type { ChatContextOption } from './ContextSelector'
import { contextReferenceTypeFrom } from '@/lib/context-references/types'

const REFRESH_MS = 5_000
interface Conversation { id: string; scope?: string; scopeRefId?: string; contextRefs?: Array<{ type?: string; kind?: string; id: string; label?: string; href?: string; summary?: string }> }
const selectionKey = (orgId: string, conversationId: string) => `pib.messages.contextSelection.v1:${orgId}:${conversationId}`
const seenKey = (orgId: string, conversationId: string, context: ChatContextReference) => `pib.messages.contextSeen.v1:${orgId}:${conversationId}:${context.kind}:${context.id}`

function optionsFor(conversation: Conversation | null): ChatContextOption[] {
  if (!conversation) return []
  const result = new Map<string, ChatContextOption>()
  if (conversation.scope === 'project' && conversation.scopeRefId) result.set(`project:${conversation.scopeRefId}`, { kind: 'project', id: conversation.scopeRefId, label: 'Project' })
  for (const ref of conversation.contextRefs ?? []) {
    const kind = contextReferenceTypeFrom(ref.kind ?? ref.type)
    if (kind) result.set(`${kind}:${ref.id}`, { kind, id: ref.id, label: ref.label ?? 'Context', ...(ref.href ? { href: ref.href } : {}), ...(ref.summary ? { summary: ref.summary } : {}) })
  }
  return [...result.values()]
}

export function useChatContexts(orgId: string, conversation: Conversation | null, autoPoll = true) {
  const contexts = useMemo(() => optionsFor(conversation), [conversation])
  const scoped = useMemo<ChatContextReference | undefined>(() => conversation?.scope === 'project' && conversation.scopeRefId ? { kind: 'project', id: conversation.scopeRefId } : undefined, [conversation?.scope, conversation?.scopeRefId])
  const [explicit, setExplicit] = useState<ChatContextReference>()
  const activeContext = selectActiveContext({ explicit, conversation: scoped, attached: contexts, available: contexts })
  const [model, setModel] = useState<ChatContextReadModel | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [routineUpdateCount, setRoutineUpdateCount] = useState(0)
  const modelsByContext = useRef(new Map<string, ChatContextReadModel>())
  const seenByContext = useRef(new Map<string, number>())
  const contextKey = activeContext ? `${activeContext.kind}:${activeContext.id}` : ''
  const activeKeyRef = useRef(contextKey)
  const requestRef = useRef<{ generation: number; controller?: AbortController }>({ generation: 0 })
  activeKeyRef.current = contextKey

  useEffect(() => {
    requestRef.current.controller?.abort(); requestRef.current.generation += 1
    modelsByContext.current.clear(); seenByContext.current.clear()
    setModel(null); setError(null); setRoutineUpdateCount(0)
    if (!conversation) { setExplicit(undefined); return }
    try { const stored = window.sessionStorage.getItem(selectionKey(orgId, conversation.id)); setExplicit(stored ? JSON.parse(stored) : undefined) } catch { setExplicit(undefined) }
  }, [conversation?.id, orgId])

  const setActiveContext = useCallback((next: ChatContextReference) => {
    const nextKey = `${next.kind}:${next.id}`
    setExplicit(next)
    setModel(modelsByContext.current.get(nextKey) ?? null)
    setError(null)
    const storedSeen = conversation ? Number(window.localStorage.getItem(seenKey(orgId, conversation.id, next)) ?? 0) : 0
    seenByContext.current.set(nextKey, storedSeen)
    const cached = modelsByContext.current.get(nextKey)
    setRoutineUpdateCount(cached ? cached.activity.filter((item) => ['pickup', 'running', 'waiting', 'dependency_released'].includes(item.type) && Date.parse(item.occurredAt) > storedSeen).length : 0)
    if (conversation) window.sessionStorage.setItem(selectionKey(orgId, conversation.id), JSON.stringify(next))
  }, [conversation, orgId])

  useEffect(() => {
    if (!activeContext || !conversation) return
    const cached = modelsByContext.current.get(contextKey) ?? null
    setModel(cached)
    setError(null)
    const storedSeen = Number(window.localStorage.getItem(seenKey(orgId, conversation.id, activeContext)) ?? 0)
    if (!seenByContext.current.has(contextKey)) seenByContext.current.set(contextKey, storedSeen)
    setRoutineUpdateCount(cached ? cached.activity.filter((item) => ['pickup', 'running', 'waiting', 'dependency_released'].includes(item.type) && Date.parse(item.occurredAt) > storedSeen).length : 0)
  }, [activeContext?.id, activeContext?.kind, contextKey, conversation?.id, orgId])

  const refresh = useCallback(async () => {
    if (!conversation || !activeContext) return
    requestRef.current.controller?.abort()
    const controller = new AbortController()
    const generation = ++requestRef.current.generation
    requestRef.current.controller = controller
    try {
      const response = await fetch(`/api/v1/chat-context/${encodeURIComponent(activeContext.kind)}/${encodeURIComponent(activeContext.id)}`, { signal: controller.signal })
      if (!response.ok) throw new Error(`context refresh failed: ${response.status}`)
      const body = await response.json(); const next = body?.data as ChatContextReadModel | undefined
      if (!next?.context || !next.pulse) throw new Error('context response is invalid')
      const requestedKey = `${activeContext.kind}:${activeContext.id}`
      modelsByContext.current.set(requestedKey, next)
      if (controller.signal.aborted || generation !== requestRef.current.generation || activeKeyRef.current !== requestedKey) return
      setModel(next); setError(null)
      const key = seenKey(orgId, conversation.id, activeContext)
      if (!seenByContext.current.has(requestedKey)) seenByContext.current.set(requestedKey, Number(window.localStorage.getItem(key) ?? 0))
      const routine = next.activity.filter((item) => ['pickup', 'running', 'waiting', 'dependency_released'].includes(item.type) && Date.parse(item.occurredAt) > (seenByContext.current.get(requestedKey) ?? 0)).length
      setRoutineUpdateCount(routine)
    } catch (cause) {
      if (controller.signal.aborted || generation !== requestRef.current.generation) return
      setError(cause instanceof Error ? cause : new Error('Context refresh failed'))
    }
  }, [activeContext?.id, activeContext?.kind, conversation?.id, orgId])

  useEffect(() => {
    if (!autoPoll || !activeContext) return
    let cancelled = false
    const load = () => { if (!cancelled && document.visibilityState !== 'hidden') void refresh() }
    load(); const timer = window.setInterval(load, REFRESH_MS)
    const visibility = () => load(); document.addEventListener('visibilitychange', visibility)
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility) }
  }, [activeContext?.id, activeContext?.kind, autoPoll, refresh])

  const dismissRoutineUpdates = useCallback(() => {
    setRoutineUpdateCount(0)
    if (!conversation || !activeContext) return
    const now = Date.now(); seenByContext.current.set(contextKey, now); window.localStorage.setItem(seenKey(orgId, conversation.id, activeContext), String(now))
  }, [activeContext, contextKey, conversation, orgId])

  return { contexts, activeContext, setActiveContext, model, error, refresh, routineUpdateCount, dismissRoutineUpdates, conversationId: conversation?.id, orgId }
}
