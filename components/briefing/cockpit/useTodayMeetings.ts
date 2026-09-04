'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

export type Meeting = { id: string; title: string; start: string; end: string; allDay: boolean; meetUrl: string | null; htmlLink: string | null; status: string; attendeeCount: number; location: string | null }
type CalendarStatus = 'connected' | 'not_connected' | 'needs_reconnect'
type State = { status: CalendarStatus; meetings: Meeting[] }

const STATUSES: readonly CalendarStatus[] = ['connected', 'not_connected', 'needs_reconnect']

/**
 * Coerce whatever the API (or a test mock) returns into a safe state. The desk
 * test suite mocks unknown URLs as `{ ok: true, data: { id: 'ok' } }`, so a
 * missing or non-array `meetings` must not crash the rail.
 */
function normaliseState(raw: unknown): State {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const status = STATUSES.includes(body.status as CalendarStatus) ? (body.status as CalendarStatus) : 'connected'
  const meetings = Array.isArray(body.meetings) ? (body.meetings as Meeting[]) : []
  return { status, meetings }
}

export function useTodayMeetings(orgId: string | undefined) {
  const [state, setState] = useState<State>({ status: 'connected', meetings: [] })
  // `loading` is only true until the first response lands. Background reloads
  // (60s rail poll, feed tick) keep the current chips on screen instead of
  // flashing "Loading calendar…" every minute.
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadedRef = useRef(false)
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const reload = useCallback(async () => {
    if (!loadedRef.current) setLoading(true)
    try {
      const params = new URLSearchParams({ tz })
      if (orgId) params.set('orgId', orgId)
      const res = await fetch(`/api/v1/workspace/calendar/today?${params.toString()}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Calendar failed')
      setState(normaliseState(body?.data ?? body))
      setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Calendar failed') }
    finally {
      loadedRef.current = true
      setLoading(false)
    }
  }, [orgId, tz])
  useEffect(() => { reload() }, [reload])
  return { ...state, loading, error, reload }
}
