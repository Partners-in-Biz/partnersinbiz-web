'use client'

import { useMemo, useState } from 'react'

export interface ContactActivityTimelineActivity {
  id: string
  type?: string
  summary?: string
  notes?: string
  createdAt?: unknown
  createdByRef?: {
    displayName?: string
    uid?: string
  }
}

interface ContactActivityTimelineProps {
  activities: ContactActivityTimelineActivity[]
  loading: boolean
  contactName?: string
  onAddNote?: () => void
  onContinueActivity?: (activity: ContactActivityTimelineActivity) => void
  hasMore?: boolean
  onLoadMore?: () => void
}

const TYPE_LABELS: Record<string, string> = {
  email_sent: 'Email sent',
  email_received: 'Email received',
  email_replied: 'Email replied',
  email_opened: 'Email opened',
  email_open: 'Email opened',
  email_clicked: 'Email clicked',
  email_click: 'Email clicked',
  call: 'Call',
  note: 'Note',
  sms_sent: 'SMS sent',
  meeting_scheduled: 'Meeting scheduled',
  contact_captured: 'Contact captured',
  form_submission: 'Form submission',
  page_visit: 'Page visit',
  stage_change: 'Stage changed',
  deal_stage_change: 'Deal stage changed',
  tag_added: 'Tag added',
  tag_removed: 'Tag removed',
  sequence_enrolled: 'Enrolled in sequence',
  sequence_completed: 'Sequence completed',
}

const ACTIVITY_ICONS: Record<string, string> = {
  note: 'notes',
  email_sent: 'mail',
  email_received: 'inbox',
  email_replied: 'reply',
  email_opened: 'drafts',
  email_open: 'drafts',
  email_clicked: 'ads_click',
  email_click: 'ads_click',
  sms_sent: 'sms',
  sequence_enrolled: 'route',
  sequence_completed: 'route',
  contact_captured: 'add_circle',
  form_submission: 'assignment_turned_in',
  page_visit: 'travel_explore',
  call: 'call',
  meeting_scheduled: 'event',
  stage_change: 'swap_horiz',
  deal_stage_change: 'trending_up',
  tag_added: 'label',
  tag_removed: 'label_off',
}

const ALL_FILTER = '__all__'

function readableActivityType(type: string | undefined): string {
  const key = type?.trim() ?? ''
  if (!key) return 'Activity type missing'
  const fallback = key.replace(/[_-]+/g, ' ').trim()
  return TYPE_LABELS[key] ?? (fallback ? fallback.charAt(0).toUpperCase() + fallback.slice(1) : 'Activity type missing')
}

function activitySummary(activity: ContactActivityTimelineActivity): string {
  return activity.summary?.trim() || activity.notes?.trim() || 'Activity summary missing'
}

function formatActivityDate(value: unknown): string {
  if (!value) return 'Activity time not captured'
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Activity date needs review' : formatDate(value)
  }
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? 'Activity date needs review' : formatDate(date)
  }
  if (typeof value !== 'object') return 'Activity date needs review'

  const timestamp = value as { seconds?: number; _seconds?: number; toDate?: () => Date; toMillis?: () => number }
  if (typeof timestamp.toDate === 'function') {
    const date = timestamp.toDate()
    return Number.isNaN(date.getTime()) ? 'Activity date needs review' : formatDate(date)
  }
  if (typeof timestamp.toMillis === 'function') {
    const date = new Date(timestamp.toMillis())
    return Number.isNaN(date.getTime()) ? 'Activity date needs review' : formatDate(date)
  }

  const seconds = timestamp.seconds ?? timestamp._seconds
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 'Activity date needs review'
  const date = new Date(seconds * 1000)
  return Number.isNaN(date.getTime()) ? 'Activity date needs review' : formatDate(date)
}

function formatDate(date: Date): string {
  return date.toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function activityActor(activity: ContactActivityTimelineActivity): string {
  const displayName = activity.createdByRef?.displayName?.trim()
  if (displayName) return displayName
  if (activity.createdByRef?.uid?.trim()) return 'Activity actor identity missing'
  return 'Activity actor not captured'
}

export function ContactActivityTimeline({
  activities,
  loading,
  contactName,
  onAddNote,
  onContinueActivity,
  hasMore = false,
  onLoadMore,
}: ContactActivityTimelineProps) {
  const contactLabel = contactName?.trim() || 'this contact'
  const [typeFilter, setTypeFilter] = useState<string>(ALL_FILTER)

  // Build the filter options from the event types actually present in the data,
  // so the dropdown never offers a type with zero activity.
  const filterOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const activity of activities) {
      const key = String(activity.type ?? '').trim()
      if (!key) continue
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([type, count]) => ({ type, count, label: readableActivityType(type) }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [activities])

  // If the active filter no longer matches any data, fall back to "all".
  const effectiveFilter = typeFilter !== ALL_FILTER && !filterOptions.some((o) => o.type === typeFilter)
    ? ALL_FILTER
    : typeFilter

  const visibleActivities = useMemo(
    () => effectiveFilter === ALL_FILTER
      ? activities
      : activities.filter((a) => String(a.type ?? '').trim() === effectiveFilter),
    [activities, effectiveFilter],
  )

  if (loading) {
    return (
      <div className="space-y-3 p-5">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="pib-skeleton h-12" />
        ))}
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="p-10">
        <div className="mx-auto flex max-w-lg flex-col items-center gap-3 text-center">
          <span
            aria-hidden="true"
            className="material-symbols-outlined flex h-10 w-10 items-center justify-center rounded-md border border-[var(--color-pib-line)] bg-white/[0.04] text-[20px] text-[var(--color-pib-accent)]"
          >
            history
          </span>
          <div>
            <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
              Relationship activity missing
            </p>
            <h3 className="mt-1 text-base font-semibold text-[var(--color-pib-text)]">
              {`Start ${contactLabel}'s activity trail`}
            </h3>
            <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
              Log the first note, call, email, or meeting so the whole team can see what happened, who followed up, and what should happen next.
            </p>
          </div>
          {onAddNote && (
            <button
              type="button"
              onClick={onAddNote}
              aria-label={`Log first activity note for ${contactLabel}`}
              className="btn-pib-primary mt-4 inline-flex items-center gap-1.5 text-xs"
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">edit_note</span>
              Start activity trail
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="px-5 pb-4">
      {filterOptions.length > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-pib-line)] py-3">
          <label htmlFor="activity-type-filter" className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
            Filter by event type
          </label>
          <select
            id="activity-type-filter"
            value={effectiveFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label={`Filter ${contactLabel}'s activity by event type`}
            className="input-pib text-xs"
          >
            <option value={ALL_FILTER}>All events ({activities.length})</option>
            {filterOptions.map((option) => (
              <option key={option.type} value={option.type}>
                {option.label} ({option.count})
              </option>
            ))}
          </select>
        </div>
      )}

      {effectiveFilter !== ALL_FILTER && visibleActivities.length === 0 && (
        <p className="py-6 text-center text-sm text-[var(--color-pib-text-muted)]">
          No {readableActivityType(effectiveFilter).toLowerCase()} events for {contactLabel}.
        </p>
      )}

      {visibleActivities.map((activity) => {
        const summary = activitySummary(activity)
        return (
          <div key={activity.id} className="flex gap-3 border-b border-[var(--color-pib-line)] py-3 last:border-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]">
              <span className="material-symbols-outlined text-[14px] text-[var(--color-pib-text-muted)]">
                {ACTIVITY_ICONS[String(activity.type ?? '')] ?? 'circle'}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                {readableActivityType(activity.type)}
              </p>
              <p className="mt-1 text-sm text-[var(--color-pib-text)]">{summary}</p>
              <p className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">
                {activityActor(activity)} · {formatActivityDate(activity.createdAt)}
              </p>
            </div>
            {onContinueActivity && (
              <button
                type="button"
                onClick={() => onContinueActivity(activity)}
                aria-label={`Continue from activity ${summary} with ${contactLabel}`}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--color-pib-line)] px-2 py-1 text-[11px] font-medium text-[var(--color-pib-accent)] transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
              >
                <span className="material-symbols-outlined text-[13px]" aria-hidden="true">edit_note</span>
                Continue
              </button>
            )}
          </div>
        )
      })}
      {hasMore && onLoadMore && (
        <button
          type="button"
          onClick={onLoadMore}
          aria-label={`Load more activity for ${contactLabel}`}
          className="w-full py-2 text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]"
        >
          Load more
        </button>
      )}
    </div>
  )
}
