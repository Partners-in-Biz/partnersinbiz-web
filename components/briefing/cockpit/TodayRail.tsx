'use client'

import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/studio'
import { scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import { BRIEFING_WORK_LANES, type BriefingWorkKind } from '@/lib/briefing/workKind'
import type { Mode } from './cockpitTypes'
import { useTodayMeetings, type Meeting } from './useTodayMeetings'
import { useUnreadEmail } from './useUnreadEmail'

export type TodayRailProps = {
  mode: Mode
  orgId?: string
  portalScope?: PortalOrgRouteScope
  laneCounts: Record<BriefingWorkKind, number>
  activeLane: BriefingWorkKind | null
  onSelectLane: (lane: BriefingWorkKind) => void
  autoRefresh: boolean
  onToggleLive: () => void
  onSnapshot: () => void
  snapshotting: boolean
  /** Bumped by the desk on every feed load so calendar + inbox refresh on the same tick. */
  refreshKey: number
}

const RAIL_BUTTON_CLASS = 'flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] text-[var(--color-pib-text-muted)] transition hover:bg-[var(--color-pib-surface-muted)] hover:text-[var(--color-pib-text)]'

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return iso
  }
}

function upcomingMeetings(meetings: Meeting[], now: number | null, limit: number): Array<{ meeting: Meeting; isNext: boolean }> {
  const list = Array.isArray(meetings) ? meetings : []
  const timed = list.filter((meeting) => !meeting.allDay)
  const nextIndex = now === null ? -1 : timed.findIndex((meeting) => new Date(meeting.end || meeting.start).getTime() > now)
  const start = nextIndex >= 0 ? nextIndex : Math.max(0, timed.length - limit)
  return timed.slice(start, start + limit).map((meeting, index) => ({ meeting, isNext: nextIndex >= 0 && index === 0 }))
}

export function TodayRail({
  mode,
  orgId,
  portalScope,
  laneCounts,
  activeLane,
  onSelectLane,
  autoRefresh,
  onToggleLive,
  onSnapshot,
  snapshotting,
  refreshKey,
}: TodayRailProps) {
  const calendar = useTodayMeetings(orgId || undefined)
  const inbox = useUnreadEmail(mode, orgId || undefined, 1)
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (refreshKey <= 0) return
    void calendar.reload()
    void inbox.reload()
    // reload identities change with orgId only; refreshKey is the trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  const meetings = useMemo(() => upcomingMeetings(calendar.meetings, now, 3), [calendar.meetings, now])
  const totalMeetings = Array.isArray(calendar.meetings) ? calendar.meetings.length : 0

  const inboxHref = mode === 'admin' ? '/admin/email' : scopedPortalPath('/portal/email', portalScope ?? {})
  const calendarConnectHref = mode === 'admin'
    ? '/api/v1/admin/mailbox/google/authorize?scope=workspace&returnTo=/admin/briefings'
    : '/api/v1/portal/email/google/authorize?scope=workspace&returnTo=/portal/briefings'

  return (
    <section
      aria-label="Today"
      data-testid="briefings-today-rail"
      className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-[6px] border border-[var(--color-pib-line)] bg-[var(--color-card)]/65 px-2 py-1"
    >
      {/* Today: meetings */}
      <div className="flex min-w-0 items-center gap-1.5" aria-label="Today's meetings">
        <span className="flex h-7 shrink-0 items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-pib-text-muted)]">
          <Icon name="calendar_today" />
          Today
        </span>
        {calendar.loading ? (
          <span className="text-[11px] text-[var(--color-pib-text-muted)]">Loading calendar…</span>
        ) : calendar.status !== 'connected' ? (
          <a href={calendarConnectHref} className="text-[11px] text-[var(--color-pib-accent)] hover:underline">
            {calendar.status === 'needs_reconnect' ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}
          </a>
        ) : meetings.length === 0 ? (
          <span className="text-[11px] text-[var(--color-pib-text-muted)]">No more meetings today</span>
        ) : (
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {meetings.map(({ meeting, isNext }) => {
              const href = meeting.meetUrl ?? meeting.htmlLink ?? undefined
              const content = (
                <>
                  <span className={`tabular-nums ${isNext ? 'text-emerald-500' : 'text-[var(--color-pib-text)]'}`}>{formatTime(meeting.start)}</span>
                  <span className="max-w-36 truncate text-[var(--color-pib-text)]" title={meeting.title}>{meeting.title}</span>
                  {meeting.meetUrl ? <span className="text-emerald-500">Join</span> : null}
                </>
              )
              const className = `flex h-7 shrink-0 items-center gap-1.5 rounded border px-2 text-[11px] ${isNext ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-[var(--color-pib-line)]'}`
              return href ? (
                <a key={meeting.id} href={href} target="_blank" rel="noopener noreferrer" className={`${className} hover:bg-[var(--color-pib-surface-muted)]`} aria-label={`${meeting.meetUrl ? 'Join' : 'Open'} ${meeting.title} at ${formatTime(meeting.start)}`}>
                  {content}
                </a>
              ) : (
                <span key={meeting.id} className={className}>{content}</span>
              )
            })}
            {totalMeetings > meetings.length ? (
              <span className="shrink-0 text-[10px] text-[var(--color-pib-text-muted)]">+{totalMeetings - meetings.length}</span>
            ) : null}
          </div>
        )}
      </div>

      {/* Lane counters */}
      <nav aria-label="Work lanes" className="hidden items-center gap-0.5 lg:flex">
        {BRIEFING_WORK_LANES.map((lane) => {
          const count = laneCounts[lane.id] ?? 0
          const selected = activeLane === lane.id
          return (
            <button
              key={lane.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelectLane(lane.id)}
              title={lane.description}
              className={`${RAIL_BUTTON_CLASS} ${selected ? 'bg-[var(--color-row-hover)] text-[var(--color-pib-text)]' : ''}`}
            >
              <Icon name={lane.icon} />
              <span>{lane.label}</span>
              <span className={`tabular-nums ${count > 0 ? 'text-[var(--color-pib-text)]' : 'text-emerald-500'}`}>{count}</span>
            </button>
          )
        })}
      </nav>

      {/* Right: inbox, live, snapshot */}
      <div className="ml-auto flex items-center gap-0.5">
        {inbox.status === 'connected' ? (
          <a href={inboxHref} className={RAIL_BUTTON_CLASS} aria-label={`Inbox: ${inbox.unreadCount} unread`}>
            <Icon name="mail" />
            <span className="hidden sm:inline">Inbox</span>
            <span className={`tabular-nums ${inbox.unreadCount > 0 ? 'text-[var(--color-pib-text)]' : 'text-emerald-500'}`}>{inbox.unreadCount}</span>
          </a>
        ) : null}
        <button
          type="button"
          onClick={onToggleLive}
          className={`${RAIL_BUTTON_CLASS} hidden lg:flex ${autoRefresh ? 'bg-emerald-400/10 text-emerald-500' : ''}`}
          aria-pressed={autoRefresh}
        >
          <Icon name={autoRefresh ? 'sync' : 'sync_disabled'} />
          {autoRefresh ? 'Live on' : 'Live off'}
        </button>
        <button type="button" onClick={onSnapshot} disabled={snapshotting} className={`${RAIL_BUTTON_CLASS} hidden lg:flex disabled:opacity-50`}>
          <Icon name="bookmark_added" />
          {snapshotting ? 'Saving' : 'Snapshot'}
        </button>
      </div>
    </section>
  )
}
