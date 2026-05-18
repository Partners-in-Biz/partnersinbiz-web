'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import type { Notification } from '@/lib/notifications/types'
import { fmtTimestamp } from '@/components/admin/email/fmtTimestamp'

type NotificationWithId = Notification & { id: string }

const TYPE_ICONS: Record<string, string> = {
  'task.assigned': 'task_alt',
  'invoice.paid': 'payments',
  'mention': 'alternate_email',
  'form.submitted': 'contact_page',
  'deal.won': 'monetization_on',
  'deal.lost': 'trending_down',
  'contact.created': 'person_add',
  'sequence.enrolled': 'route',
  'comment': 'comment',
}

function notifIcon(type: string): string {
  return TYPE_ICONS[type] ?? 'notifications'
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<NotificationWithId[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [markingRead, setMarkingRead] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)

  // Close panel on click outside
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  const fetchNotifications = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/crm/notifications?limit=20')
      if (!res.ok) return
      const body = await res.json() as {
        success?: boolean
        data?: { notifications?: NotificationWithId[]; unreadCount?: number }
      }
      const list = body.data?.notifications ?? []
      const unread = body.data?.unreadCount ?? list.filter(n => n.status === 'unread').length
      setNotifications(list)
      setUnreadCount(unread)
    } catch {
      // silent fail
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch on mount
  useEffect(() => {
    void fetchNotifications()
  }, [fetchNotifications])

  function togglePanel() {
    setOpen(prev => !prev)
  }

  async function markAllRead() {
    if (markingRead || unreadCount === 0) return
    setMarkingRead(true)
    // Optimistic
    setNotifications(prev => prev.map(n => ({ ...n, status: 'read' as const })))
    setUnreadCount(0)
    try {
      await fetch('/api/v1/crm/notifications/mark-read', { method: 'POST' })
    } catch {
      // silent fail — optimistic state stays
    } finally {
      setMarkingRead(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Bell button */}
      <button
        onClick={togglePanel}
        title="Notifications"
        className="relative flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05] transition-colors"
        aria-label="Open notifications"
      >
        <span className="material-symbols-outlined text-[20px]">
          {unreadCount > 0 ? 'notifications_active' : 'notifications'}
        </span>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-1 leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 rounded-[var(--radius-card)] border border-[var(--color-pib-line)] shadow-xl z-50 overflow-hidden"
          style={{ background: 'var(--color-sidebar, var(--color-pib-surface))' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-pib-line)] bg-white/[0.02]">
            <p className="eyebrow !text-[10px]">Notifications</p>
            {unreadCount > 0 && (
              <button
                onClick={() => void markAllRead()}
                disabled={markingRead}
                className="text-[10px] text-[var(--color-pib-accent)] hover:underline disabled:opacity-50 cursor-pointer"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[400px] overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="p-4 space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="pib-skeleton h-12" />
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <span className="material-symbols-outlined text-3xl text-[var(--color-pib-text-muted)] block mb-2">
                  notifications_none
                </span>
                <p className="text-sm text-[var(--color-pib-text-muted)]">No notifications yet</p>
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  className={[
                    'flex items-start gap-3 px-4 py-3 border-b border-[var(--color-pib-line)] last:border-0 transition-colors',
                    n.status === 'unread' ? 'bg-[var(--color-pib-accent-soft)]/10' : 'hover:bg-white/[0.02]',
                  ].join(' ')}
                >
                  <div className="shrink-0 w-7 h-7 rounded-full bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] flex items-center justify-center mt-0.5">
                    <span className="material-symbols-outlined text-[13px] text-[var(--color-pib-text-muted)]">
                      {notifIcon(n.type)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={['text-xs leading-snug', n.status === 'unread' ? 'font-medium text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text-muted)]'].join(' ')}>
                      {n.title ?? n.body ?? n.type}
                    </p>
                    {n.body && n.title && (
                      <p className="text-[11px] text-[var(--color-pib-text-muted)] mt-0.5 truncate">{n.body}</p>
                    )}
                    <p className="text-[10px] text-[var(--color-pib-text-muted)] mt-1 font-mono">
                      {fmtTimestamp(n.createdAt)}
                    </p>
                  </div>
                  {n.status === 'unread' && (
                    <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--color-pib-accent)] mt-1.5" />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
