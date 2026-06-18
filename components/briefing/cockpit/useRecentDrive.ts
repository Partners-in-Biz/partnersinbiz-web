'use client'
import { useCallback, useEffect, useState } from 'react'

export type DriveFile = { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink: string | null; iconLink: string | null; owner: string | null; shared: boolean }
type State = { status: 'connected' | 'not_connected' | 'needs_reconnect'; files: DriveFile[] }

export function useRecentDrive(orgId: string | undefined) {
  const [state, setState] = useState<State>({ status: 'connected', files: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '10' })
      if (orgId) params.set('orgId', orgId)
      const res = await fetch(`/api/v1/workspace/drive/recent?${params.toString()}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Drive failed')
      setState((body.data ?? body) as State)
      setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Drive failed') }
    finally { setLoading(false) }
  }, [orgId])
  useEffect(() => { reload() }, [reload])
  return { ...state, loading, error, reload }
}
