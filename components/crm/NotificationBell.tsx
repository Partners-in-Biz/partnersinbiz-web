'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import type { Notification } from '@/lib/notifications/types'
import { fmtTimestamp } from '@/lib/format/timestamp'

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

interface NotificationBellProps {
  mode?: 'crm' | 'admin'
  orgId?: string
  userId?: string
}

export function NotificationBell({ mode = 'crm', orgId, userId }: NotificationBellProps = {}) {
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
      const endpoint = mode === 'admin'
        ? `/api/v1/notifications?orgId=${encodeURIComponent(orgId ?? '')}&limit=20${userId ? `&userId=${encodeURIComponent(userId)}` : ''}`
        : '/api/v1/crm/notifications?limit=20'
      if (mode === 'admin' && !orgId) return
      const res = await fetch(endpoint)
      if (!res.ok) return
      const body = await res.json() as {
        success?: boolean
        data?: {
          notifications?: NotificationWithId[]
          unreadCount?: number
          items?: NotificationWithId[]
        }
      }
      const list = mode === 'admin'
        ? (body.data?.items ?? [])
        : (body.data?.notifications ?? [])
      const unread = body.data?.unreadCount ?? list.filter(n => n.status === 'unread').length
      setNotifications(list)
      setUnreadCount(unread)
    } catch {
      // silent fail
    } finally {
      setLoading(false)
    }
  }, [mode, orgId, userId])

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
      if (mode === 'admin') {
        await fetch('/api/v1/notifications/read-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId, userId }),
        })
      } else {
        await fetch('/api/v1/crm/notifications/mark-read', { method: 'POST' })
      }
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
              <div className="px-4 py-5">
                <div className="flex items-start gap-3">
                  <span
                    className="material-symbols-outlined rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-2 text-[20px] text-emerald-300"
                    aria-hidden="true"
                  >
                    task_alt
                  </span>
                  <div>
                    <p className="eyebrow !text-[10px]">Quiet inbox</p>
                    <h3 className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">
                      No CRM alerts need action
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">
                      You are clear on owner gaps, deal movement, form submissions, and follow-up automation alerts.
                    </p>
                  </div>
                </div>
                <div className="mt-4 rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] px-3 py-2">
                  <p className="eyebrow !text-[10px]">Monitoring</p>
                  <p className="mt-1 text-xs font-medium text-[var(--color-pib-text)]">
                    Watching owner, deal, and intake signals
                  </p>
                </div>
              </div>
            ) : (
              notifications.map(n => {
                const rowClassName = [
                  'flex items-start gap-3 px-4 py-3 border-b border-[var(--color-pib-line)] last:border-0 transition-colors text-left w-full',
                  n.status === 'unread' ? 'bg-[var(--color-pib-accent-soft)]/10' : 'hover:bg-white/[0.02]',
                  n.link ? 'cursor-pointer hover:bg-white/[0.04]' : '',
                ].join(' ')
                const content = (
                  <>
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
                  </>
                )

                return n.link ? (
                  <a key={n.id} href={n.link} className={rowClassName}>
                    {content}
                  </a>
                ) : (
                  <div key={n.id} className={rowClassName}>
                    {content}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
