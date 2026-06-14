'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface ActivityEvent {
  id: string
  orgId: string
  type: string
  actorId: string
  actorName: string
  actorRole: 'admin' | 'client' | 'ai'
  description: string
  entityId?: string
  entityType?: string
  entityTitle?: string
  createdAt: any
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function ActivityIcon({ type }: { type: string }) {
  const icons: Record<string, string> = {
    post_approved: '✅',
    post_rejected: '❌',
    post_scheduled: '📅',
    task_created: '📋',
    task_completed: '✅',
    comment_added: '💬',
    invoice_sent: '📄',
    invoice_paid: '💰',
    member_added: '👤',
  }
  return icons[type] ?? '◆'
}

function ActorBadge({ role }: { role: 'admin' | 'client' | 'ai' }) {
  const styles: Record<string, { bg: string; text: string; label: string }> = {
    admin: { bg: 'var(--color-accent-v2)', text: 'var(--color-on-accent)', label: 'Admin' },
    client: { bg: 'var(--color-outline)', text: 'var(--color-on-surface-variant)', label: 'Client' },
    ai: { bg: 'var(--color-secondary)', text: 'var(--color-on-secondary)', label: 'AI' },
  }
  const style = styles[role]
  return (
    <span
      className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: `${style.bg}20`, color: style.bg }}
    >
      {style.label}
    </span>
  )
}

function formatDate(date: Date | string | any): string {
  if (!date) return ''
  const d = date instanceof Date ? date : date.toDate?.() ?? new Date(date)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}

function getDateGroup(date: Date | string | any): string {
  if (!date) return ''
  const d = date instanceof Date ? date : date.toDate?.() ?? new Date(date)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const dateStr = d.toDateString()
  const todayStr = today.toDateString()
  const yesterdayStr = yesterday.toDateString()

  if (dateStr === todayStr) return 'Today'
  if (dateStr === yesterdayStr) return 'Yesterday'
  return formatDate(d)
}

function formatTime(date: Date | string | any): string {
  if (!date) return ''
  const d = date instanceof Date ? date : date.toDate?.() ?? new Date(date)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function formatRelativeTime(date: Date | string | any): string {
  if (!date) return ''
  const d = date instanceof Date ? date : date.toDate?.() ?? new Date(date)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
  return formatDate(d)
}

export default function ActivityPage() {
  const params = useParams()
  const slug = params.slug as string
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fetch org ID, then activity
    fetch('/api/v1/organizations')
      .then(r => r.json())
      .then(body => {
        const org = Array.isArray(body.data) ? body.data.find((item: { slug?: string }) => item.slug === slug) : null
        if (org) {
          return fetch(`/api/v1/activity?orgId=${encodeURIComponent(org.id)}&limit=50`, {
            headers: { 'X-Org-Id': org.id, 'X-Org-Slug': slug },
          })
            .then(r => r.json())
            .then(body => {
              setEvents(body.data ?? [])
            })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [slug])

  // Group events by date
  const grouped: Record<string, ActivityEvent[]> = {}
  events.forEach(event => {
    const group = getDateGroup(event.createdAt)
    if (!grouped[group]) grouped[group] = []
    grouped[group].push(event)
  })

  const groupOrder = ['Today', 'Yesterday']
  const sortedGroups = [
    ...groupOrder.filter(g => grouped[g]),
    ...Object.keys(grouped).filter(g => !groupOrder.includes(g)),
  ]

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-outline-variant px-6 py-4">
        <h1 className="font-headline text-xl font-bold text-on-surface">Activity Log</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Track all account activity, approvals, and events
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 space-y-8">
          {loading ? (
            // Loading skeleton
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="pib-card p-4 flex gap-4">
                  <Skeleton className="w-10 h-10 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : events.length === 0 ? (
            // Empty state
            <div className="text-center py-12">
              <p className="text-on-surface-variant text-sm">
                No activity yet for this workspace.
              </p>
            </div>
          ) : (
            // Timeline
            sortedGroups.map(groupLabel => (
              <div key={groupLabel}>
                {/* Date divider */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-px bg-outline-variant" />
                  <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant/60 px-3">
                    {groupLabel}
                  </span>
                  <div className="flex-1 h-px bg-outline-variant" />
                </div>

                {/* Events */}
                <div className="space-y-3">
                  {grouped[groupLabel].map((event) => (
                    <div
                      key={event.id}
                      className="pib-card p-4 flex gap-4 border-l-2"
                      style={{ borderLeftColor: 'var(--color-outline-variant)' }}
                    >
                      {/* Timeline icon */}
                      <div className="shrink-0 text-xl leading-none pt-1">
                        {ActivityIcon({ type: event.type })}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <p className="text-sm font-medium text-on-surface flex-1">
                            {event.description}
                          </p>
                          <ActorBadge role={event.actorRole} />
                        </div>

                        {/* Meta */}
                        <div className="flex items-center gap-3 text-xs text-on-surface-variant">
                          <span>{event.actorName}</span>
                          <span>•</span>
                          <time title={formatTime(event.createdAt)}>
                            {formatRelativeTime(event.createdAt)}
                          </time>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
