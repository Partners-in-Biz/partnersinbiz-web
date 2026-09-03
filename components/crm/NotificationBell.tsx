'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { Notification } from '@/lib/notifications/types'
import { preferTaskNotificationHref } from '@/lib/notifications/task-links'
import { fmtTimestamp } from '@/lib/format/timestamp'
import { Icon } from '@/components/studio'

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

function displayHref(n: NotificationWithId, mode: 'crm' | 'admin'): string | null {
  return preferTaskNotificationHref({
    link: n.link,
    data: n.data,
    surface: mode === 'admin' ? 'admin' : 'portal',
  })
}

interface NotificationBellProps {
  mode?: 'crm' | 'admin'
  orgId?: string
  userId?: string
}

export function NotificationBell({ mode = 'crm', orgId, userId }: NotificationBellProps = {}) {
  const router = useRouter()
  const [notifications, setNotifications] = useState<NotificationWithId[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [markingRead, setMarkingRead] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [dropdownTop, setDropdownTop] = useState<number>(0)

  const containerRef = useRef<HTMLDivElement>(null)

  // Update dropdown position for fixed positioning on mobile
  const updateDropdownPosition = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      setDropdownTop(rect.bottom + 6)
    }
  }, [])

  // Recompute position on open, scroll, and resize
  useEffect(() => {
    if (open) {
      updateDropdownPosition()
      window.addEventListener('scroll', updateDropdownPosition)
      window.addEventListener('resize', updateDropdownPosition)
      return () => {
        window.removeEventListener('scroll', updateDropdownPosition)
        window.removeEventListener('resize', updateDropdownPosition)
      }
    }
  }, [open, updateDropdownPosition])

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
      // silent fail - optimistic state stays
    } finally {
      setMarkingRead(false)
    }
  }

  function markLocalRead(id: string) {
    setNotifications(prev => prev.map(item => (
      item.id === id && item.status === 'unread'
        ? { ...item, status: 'read' as const }
        : item
    )))
    setUnreadCount(prev => Math.max(0, prev - 1))
  }

  async function openNotification(n: NotificationWithId) {
    if (openingId) return
    setOpeningId(n.id)

    const wasUnread = n.status === 'unread'
    if (wasUnread) markLocalRead(n.id)

    const fallbackHref = displayHref(n, mode) || n.link || null
    let href = fallbackHref

    try {
      const endpoint = mode === 'admin'
        ? `/api/v1/notifications/${encodeURIComponent(n.id)}/open`
        : `/api/v1/crm/notifications/${encodeURIComponent(n.id)}/open`
      const res = await fetch(endpoint, { method: 'POST' })
      if (res.ok) {
        const body = await res.json() as { data?: { href?: string | null } }
        if (typeof body.data?.href === 'string' && body.data.href.trim()) {
          href = body.data.href.trim()
        }
      }
    } catch {
      // navigate with fallback even if mark/open fails
    } finally {
      setOpeningId(null)
      setOpen(false)
    }

    if (href) {
      if (href.startsWith('http://') || href.startsWith('https://')) {
        window.location.assign(href)
      } else {
        router.push(href)
      }
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
        <Icon name={unreadCount > 0 ? 'notifications_active' : 'notifications'} className="text-[18px]" />
        {unreadCount > 0 && (
          <span
            className="absolute top-1 right-1 h-1.5 w-1.5"
            style={{ borderRadius: '50%',  background: 'var(--sc-accent)' }}
            aria-hidden="true"
          />
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="fixed sm:absolute right-2 sm:right-0 top-[var(--dropdown-top)] sm:top-full z-50 mt-1.5 w-[min(20rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-[var(--color-card-border)]"
          style={{
            background: 'var(--color-sidebar, var(--color-pib-surface))',
            '--dropdown-top': `${dropdownTop}px`,
          } as React.CSSProperties}
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
                <Icon name="done_all" className="text-[13px]" />
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
                  <Icon name="task_alt" className="rounded-md border border-emerald-400/40 bg-emerald-400/10 p-1.5 text-[16px] text-emerald-100" />
                  <div>
                    <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Quiet inbox</p>
                    <h3 className="mt-0.5 text-sm font-medium text-[var(--color-pib-text)]">
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
                const href = displayHref(n, mode) || n.link
                const rowClassName = [
                  'flex items-start gap-2.5 px-3 py-2 border-b border-[var(--color-card-border)] last:border-0 transition-colors text-left w-full',
                  n.status === 'unread' ? 'bg-primary/10' : 'hover:bg-white/[0.02]',
                  href ? 'cursor-pointer hover:bg-white/[0.04]' : '',
                  openingId === n.id ? 'opacity-70' : '',
                ].join(' ')
                const content = (
                  <>
                    <span aria-hidden="true" className="mt-0.5 shrink-0" style={{ width: '1.5rem', height: '1.5rem', borderRadius: '9999px' }}>
                      <Icon name={notifIcon(n.type)} className="text-[13px]" />
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

                return href ? (
                  <button
                    key={n.id}
                    type="button"
                    className={rowClassName}
                    disabled={openingId === n.id}
                    onClick={() => void openNotification(n)}
                  >
                    {content}
                  </button>
                ) : (
                  <button
                    key={n.id}
                    type="button"
                    className={rowClassName}
                    disabled={openingId === n.id}
                    onClick={() => {
                      if (n.status === 'unread') {
                        markLocalRead(n.id)
                        void fetch(
                          mode === 'admin'
                            ? `/api/v1/notifications/${encodeURIComponent(n.id)}/open`
                            : `/api/v1/crm/notifications/${encodeURIComponent(n.id)}/open`,
                          { method: 'POST' },
                        ).catch(() => {})
                      }
                    }}
                  >
                    {content}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
