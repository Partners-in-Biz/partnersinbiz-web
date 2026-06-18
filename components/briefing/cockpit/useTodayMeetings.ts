'use client'
import { useCallback, useEffect, useState } from 'react'

export type Meeting = { id: string; title: string; start: string; end: string; allDay: boolean; meetUrl: string | null; htmlLink: string | null; status: string; attendeeCount: number; location: string | null }
type State = { status: 'connected' | 'not_connected' | 'needs_reconnect'; meetings: Meeting[] }

export function useTodayMeetings(orgId: string | undefined) {
  const [state, setState] = useState<State>({ status: 'connected', meetings: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ tz })
      if (orgId) params.set('orgId', orgId)
      const res = await fetch(`/api/v1/workspace/calendar/today?${params.toString()}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Calendar failed')
      setState((body.data ?? body) as State)
      setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Calendar failed') }
    finally { setLoading(false) }
  }, [orgId, tz])
  useEffect(() => { reload() }, [reload])
  return { ...state, loading, error, reload }
}
