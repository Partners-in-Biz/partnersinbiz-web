'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Mode } from './cockpitTypes'

export type MailItem = { id: string; from: string; subject: string; snippet: string; receivedAt: string | null; read: boolean; threadId?: string | null; accountEmail: string }
type State = { status: 'connected' | 'not_connected'; messages: MailItem[]; unreadCount: number }

const DISCONNECTED: State = { status: 'not_connected', messages: [], unreadCount: 0 }

/** Tolerate `{ data: { id: 'ok' } }`-style mocks and partial payloads: anything that is not an array counts as no messages. */
function messagesFrom(raw: unknown): MailItem[] {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const payload = body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : body
  return Array.isArray(payload.messages) ? (payload.messages as MailItem[]) : []
}

export function useUnreadEmail(mode: Mode, orgId: string | undefined, topN = 5) {
  const [state, setState] = useState<State>({ status: 'connected', messages: [], unreadCount: 0 })
  // Only the first load shows a loading state; background reloads keep the current count on screen.
  const [loading, setLoading] = useState(true)
  const loadedRef = useRef(false)
  const reload = useCallback(async () => {
    if (!loadedRef.current) setLoading(true)
    try {
      const endpoint = mode === 'admin' ? '/api/v1/admin/mailbox/messages' : '/api/v1/portal/email/messages'
      const res = await fetch(`${endpoint}?folder=inbox&limit=50`)
      const body = await res.json()
      if (!res.ok) { setState(DISCONNECTED); return }
      const unread = messagesFrom(body).filter((m) => m && typeof m === 'object' && !m.read)
      setState({ status: 'connected', messages: unread.slice(0, topN), unreadCount: unread.length })
    } catch { setState(DISCONNECTED) }
    finally {
      loadedRef.current = true
      setLoading(false)
    }
  }, [mode, orgId, topN])
  useEffect(() => { reload() }, [reload])
  return { ...state, loading, reload }
}
