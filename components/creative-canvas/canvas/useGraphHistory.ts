import { useCallback, useRef, useState } from 'react'

export interface GraphSnapshot {
  nodes: unknown[]
  edges: unknown[]
}

/**
 * In-session undo/redo history for the canvas graph.
 * Holds past/present/future snapshots of {nodes, edges}. The graph store
 * (versions API) handles durable save points; this is fast in-memory edit history.
 */
export function useGraphHistory(initial: GraphSnapshot) {
  const past = useRef<GraphSnapshot[]>([])
  const future = useRef<GraphSnapshot[]>([])
  const present = useRef<GraphSnapshot>(initial)
  const [availability, setAvailability] = useState({ canUndo: false, canRedo: false })
  const refreshAvailability = useCallback(() => {
    setAvailability({
      canUndo: past.current.length > 0,
      canRedo: future.current.length > 0,
    })
  }, [])

  const commit = useCallback((next: GraphSnapshot) => {
    past.current.push(present.current)
    present.current = next
    future.current = []
    refreshAvailability()
  }, [refreshAvailability])

  const undo = useCallback((): GraphSnapshot => {
    const prev = past.current.pop()
    if (!prev) return present.current
    future.current.push(present.current)
    present.current = prev
    refreshAvailability()
    return prev
  }, [refreshAvailability])

  const redo = useCallback((): GraphSnapshot => {
    const next = future.current.pop()
    if (!next) return present.current
    past.current.push(present.current)
    present.current = next
    refreshAvailability()
    return next
  }, [refreshAvailability])

  return {
    commit,
    undo,
    redo,
    canUndo: availability.canUndo,
    canRedo: availability.canRedo,
  }
}
