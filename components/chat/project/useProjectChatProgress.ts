'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { selectActiveProjectId, type ProjectChatProgress, type ProjectChatTaskItem } from '@/lib/projects/chatProgress'
import type { ProjectOption } from './ProjectChatExperience'

const PROJECT_PROGRESS_REFRESH_MS = 60_000

// Compatibility coordinator for the shipped Project Pulse. Generic Studio and
// artifact contexts are coordinated by useChatContexts, never concurrently.

function updatedAtMillis(value: unknown): number {
  if (typeof value === 'string') return Date.parse(value) || 0
  if (typeof value === 'number') return value
  if (!value || typeof value !== 'object') return 0
  const record = value as { seconds?: unknown; _seconds?: unknown }
  const seconds = typeof record.seconds === 'number' ? record.seconds : typeof record._seconds === 'number' ? record._seconds : 0
  return seconds * 1000
}

interface ProjectConversation {
  id: string
  scope?: string
  scopeRefId?: string
  contextRefs?: Array<{ type: string; id: string; label: string }>
}

function projectOptions(conversation: ProjectConversation | null): ProjectOption[] {
  if (!conversation) return []
  const refs = conversation.contextRefs?.filter((ref) => ref.type === 'project') ?? []
  const options = new Map<string, string>()
  if (conversation.scope === 'project' && conversation.scopeRefId) {
    options.set(conversation.scopeRefId, refs.find((ref) => ref.id === conversation.scopeRefId)?.label ?? 'Project')
  }
  for (const ref of refs) options.set(ref.id, ref.label)
  return Array.from(options, ([id, label]) => ({ id, label }))
}

function seenStorageKey(orgId: string, conversationId: string, projectId: string) {
  return `pib.messages.projectSeen.v1:${orgId}:${conversationId}:${projectId}`
}

export function useProjectChatProgress(orgId: string, conversation: ProjectConversation | null, autoPoll = true) {
  const projects = useMemo(() => projectOptions(conversation), [conversation])
  const defaultProjectId = useMemo(() => selectActiveProjectId(conversation ?? {}), [conversation])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(defaultProjectId)
  const [progress, setProgress] = useState<ProjectChatProgress | null>(null)
  const [routineUpdateCount, setRoutineUpdateCount] = useState(0)
  const seenAtRef = useRef(0)

  useEffect(() => {
    setActiveProjectId(defaultProjectId)
    setProgress(null)
    setRoutineUpdateCount(0)
    seenAtRef.current = 0
  }, [conversation?.id, defaultProjectId])

  useEffect(() => {
    setProgress(null)
    setRoutineUpdateCount(0)
    seenAtRef.current = 0
  }, [activeProjectId])

  const refresh = useCallback(async () => {
    if (!conversation || !activeProjectId) return
    const res = await fetch(`/api/v1/projects/${encodeURIComponent(activeProjectId)}/chat-progress`)
    if (!res.ok) throw new Error(`project progress failed: ${res.status}`)
    const body = await res.json()
    const next = body?.data as ProjectChatProgress | undefined
    if (!next?.project || !Array.isArray(next.tasks)) throw new Error('project progress response is invalid')
    setProgress(next)

    const key = seenStorageKey(orgId, conversation.id, activeProjectId)
    if (!seenAtRef.current) seenAtRef.current = Number(window.localStorage.getItem(key) ?? 0)
    const routineStates = new Set(['ready', 'running', 'waiting', 'review'])
    setRoutineUpdateCount(next.tasks.filter((task) => (
      routineStates.has(task.state) && updatedAtMillis(task.updatedAt) > seenAtRef.current
    )).length)
    const now = Date.parse(String((next as ProjectChatProgress & { asOf?: string }).asOf ?? '')) || Date.now()
    window.localStorage.setItem(key, String(now))
  }, [activeProjectId, conversation, orgId])

  useEffect(() => {
    if (!autoPoll || !conversation || !activeProjectId) return
    let cancelled = false
    const load = () => {
      if (cancelled || document.visibilityState === 'hidden') return
      void refresh().catch(() => {})
    }
    load()
    const interval = window.setInterval(load, PROJECT_PROGRESS_REFRESH_MS)
    const onVisibility = () => load()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [activeProjectId, autoPoll, conversation, refresh])

  const tasksByResponseMessageId = useMemo(() => {
    const groups = new Map<string, ProjectChatTaskItem[]>()
    for (const task of progress?.tasks ?? []) {
      const messageId = task.chatOrigin?.responseMessageId
      if (!messageId || task.chatOrigin?.conversationId !== conversation?.id) continue
      const tasks = groups.get(messageId) ?? []
      tasks.push(task)
      groups.set(messageId, tasks)
    }
    return groups
  }, [conversation?.id, progress?.tasks])

  const dismissRoutineUpdates = useCallback(() => {
    setRoutineUpdateCount(0)
    if (!conversation || !activeProjectId) return
    const seenAt = Date.now()
    seenAtRef.current = seenAt
    window.localStorage.setItem(seenStorageKey(orgId, conversation.id, activeProjectId), String(seenAt))
  }, [activeProjectId, conversation, orgId])

  return {
    projects,
    activeProjectId,
    setActiveProjectId,
    progress,
    refresh,
    tasksByResponseMessageId,
    routineUpdateCount,
    dismissRoutineUpdates,
  }
}
