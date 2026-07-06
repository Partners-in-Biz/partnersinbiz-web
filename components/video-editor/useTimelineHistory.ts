'use client'

import { useCallback, useRef, useState } from 'react'
import type { EditorTimeline } from '@/lib/video-editor/types'

export function useTimelineHistory(initial: EditorTimeline) {
  const past = useRef<EditorTimeline[]>([])
  const future = useRef<EditorTimeline[]>([])
  const present = useRef<EditorTimeline>(initial)
  const [availability, setAvailability] = useState({ canUndo: false, canRedo: false })

  const refreshAvailability = useCallback(() => {
    setAvailability({ canUndo: past.current.length > 0, canRedo: future.current.length > 0 })
  }, [])

  const reset = useCallback((snapshot: EditorTimeline) => {
    past.current = []
    future.current = []
    present.current = snapshot
    refreshAvailability()
  }, [refreshAvailability])

  const commit = useCallback((next: EditorTimeline) => {
    past.current.push(present.current)
    if (past.current.length > 100) past.current.shift()
    present.current = next
    future.current = []
    refreshAvailability()
  }, [refreshAvailability])

  const undo = useCallback((): EditorTimeline => {
    const prev = past.current.pop()
    if (!prev) return present.current
    future.current.push(present.current)
    present.current = prev
    refreshAvailability()
    return prev
  }, [refreshAvailability])

  const redo = useCallback((): EditorTimeline => {
    const next = future.current.pop()
    if (!next) return present.current
    past.current.push(present.current)
    present.current = next
    refreshAvailability()
    return next
  }, [refreshAvailability])

  return { commit, undo, redo, reset, canUndo: availability.canUndo, canRedo: availability.canRedo }
}
