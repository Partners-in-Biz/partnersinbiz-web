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

  async function clearNotifications() {
    if (markingRead || notifications.length === 0) return
    setMarkingRead(true)
    // Optimistic: clearing means the notifications are read and no longer take UI space.
    setNotifications([])
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
        data-tip={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        data-tip-side="bottom"
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
        aria-label="Open notifications"
      >
        <span className="material-symbols-outlined text-[18px]">
          {unreadCount > 0 ? 'notifications_active' : 'notifications'}
        </span>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1.5 w-80 overflow-hidden rounded-lg border border-[var(--color-card-border)]"
          style={{ background: 'var(--color-sidebar, var(--color-pib-surface))' }}
        >
          {/* Header */}
          <div className="flex h-9 items-center justify-between border-b border-[var(--color-card-border)] px-3">
            <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Notifications</p>
            {notifications.length > 0 && (
              <button
                onClick={() => void clearNotifications()}
                disabled={markingRead}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-[var(--color-accent-text)] transition-colors hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[13px]" aria-hidden="true">done_all</span>
                Clear
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[400px] overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="space-y-2 p-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="pib-skeleton h-9" />
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-3 py-3">
                <div className="flex items-start gap-2.5">
                  <span
                    className="material-symbols-outlined rounded-md border border-emerald-400/40 bg-emerald-400/10 p-1.5 text-[16px] text-emerald-100"
                    aria-hidden="true"
                  >
                    task_alt
                  </span>
                  <div>
                    <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Quiet inbox</p>
                    <h3 className="mt-0.5 text-sm font-semibold text-[var(--color-pib-text)]">
                      No CRM alerts need action
                    </h3>
                    <p className="mt-0.5 text-xs leading-5 text-[var(--color-pib-text-muted)]">
                      You are clear on owner gaps, deal movement, form submissions, and follow-up automation alerts.
                    </p>
                  </div>
                </div>
                <div className="mt-2.5 rounded-md border border-[var(--color-card-border)] bg-black/10 px-2.5 py-2">
                  <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Monitoring</p>
                  <p className="mt-0.5 text-xs font-medium text-[var(--color-pib-text)]">
                    Watching owner, deal, and intake signals
                  </p>
                </div>
              </div>
            ) : (
              notifications.map(n => {
                const rowClassName = [
                  'flex items-start gap-2.5 px-3 py-2 border-b border-[var(--color-card-border)] last:border-0 transition-colors text-left w-full',
                  n.status === 'unread' ? 'bg-primary/10' : 'hover:bg-white/[0.02]',
                  n.link ? 'cursor-pointer hover:bg-white/[0.04]' : '',
                ].join(' ')
                const content = (
                  <>
                    <span aria-hidden="true" className="mt-0.5 shrink-0 pib-icon-tint" style={{ width: '1.5rem', height: '1.5rem', borderRadius: '9999px' }}>
                      <span className="material-symbols-outlined text-[13px]">
                        {notifIcon(n.type)}
                      </span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={['text-xs leading-snug', n.status === 'unread' ? 'font-medium text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text-muted)]'].join(' ')}>
                        {n.title ?? n.body ?? n.type}
                      </p>
                      {n.body && n.title && (
                        <p className="mt-0.5 truncate text-[11px] text-[var(--color-pib-text-muted)]">{n.body}</p>
                      )}
                      <p className="mt-0.5 font-mono text-[10px] text-[var(--color-pib-text-muted)]">
                        {fmtTimestamp(n.createdAt)}
                      </p>
                    </div>
                    {n.status === 'unread' && (
                      <span className="mt-1.5 shrink-0 pib-status-dot pib-status-dot-accent" />
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
