'use client'
import { useCallback, useEffect, useState } from 'react'
import type { Mode } from './cockpitTypes'

export type MailItem = { id: string; from: string; subject: string; snippet: string; receivedAt: string | null; read: boolean; threadId?: string | null; accountEmail: string }
type State = { status: 'connected' | 'not_connected'; messages: MailItem[]; unreadCount: number }

export function useUnreadEmail(mode: Mode, orgId: string | undefined, topN = 5) {
  const [state, setState] = useState<State>({ status: 'connected', messages: [], unreadCount: 0 })
  const [loading, setLoading] = useState(true)
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const endpoint = mode === 'admin' ? '/api/v1/admin/mailbox/messages' : '/api/v1/portal/email/messages'
      const res = await fetch(`${endpoint}?folder=inbox&limit=50`)
      const body = await res.json()
      if (!res.ok) { setState({ status: 'not_connected', messages: [], unreadCount: 0 }); return }
      const all = ((body.data ?? body).messages ?? []) as MailItem[]
      const unread = all.filter((m) => !m.read)
      setState({ status: 'connected', messages: unread.slice(0, topN), unreadCount: unread.length })
    } catch { setState({ status: 'not_connected', messages: [], unreadCount: 0 }) }
    finally { setLoading(false) }
  }, [mode, orgId, topN])
  useEffect(() => { reload() }, [reload])
  return { ...state, loading, reload }
}
