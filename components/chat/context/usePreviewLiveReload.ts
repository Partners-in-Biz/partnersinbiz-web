'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Soft-reload helper for Context Dock previews.
 * First load for a key shows loading state; refreshRevision re-fetches without blanking.
 */
export function usePreviewLiveReloadKey(primaryKey: string) {
  const loadedKeyRef = useRef<string | null>(null)
  const [softRefreshing, setSoftRefreshing] = useState(false)

  useEffect(() => {
    loadedKeyRef.current = null
    setSoftRefreshing(false)
  }, [primaryKey])

  const beginLoad = useCallback(() => {
    if (loadedKeyRef.current === primaryKey) setSoftRefreshing(true)
  }, [primaryKey])

  const endLoadSuccess = useCallback(() => {
    loadedKeyRef.current = primaryKey
    setSoftRefreshing(false)
  }, [primaryKey])

  const endLoadError = useCallback(() => {
    setSoftRefreshing(false)
  }, [])

  const isInitialLoad = useCallback(() => loadedKeyRef.current !== primaryKey, [primaryKey])

  return {
    softRefreshing,
    beginLoad,
    endLoadSuccess,
    endLoadError,
    isInitialLoad,
  }
}

/** Poll while a dock is open so agent writes appear without remounting. */
export function useOpenDockPolling(
  open: boolean,
  onTick: () => void,
  intervalMs = 6_000,
) {
  const onTickRef = useRef(onTick)
  useEffect(() => {
    onTickRef.current = onTick
  }, [onTick])
  useEffect(() => {
    if (!open) return
    const id = window.setInterval(() => {
      onTickRef.current()
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs, open])
}
