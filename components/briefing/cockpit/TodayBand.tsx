'use client'
import { useEffect, useState } from 'react'
import type { Meeting } from './useTodayMeetings'
import { Icon } from '@/components/studio'

type Props = {
  status: 'connected' | 'not_connected' | 'needs_reconnect'
  meetings: Meeting[]
  loading: boolean
  mode: 'admin' | 'portal'
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return iso
  }
}

export function TodayBand({ status, meetings, loading, mode }: Props) {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  if (loading) {
    return (
      <div className="border-b border-[var(--color-pib-line)] px-4 py-2 text-xs text-[var(--color-pib-text-muted)]">
        Loading today&apos;s calendar&hellip;
      </div>
    )
  }

  if (status !== 'connected') {
    const href =
      mode === 'admin'
        ? '/api/v1/admin/mailbox/google/authorize?scope=workspace&returnTo=/admin/briefings'
        : '/api/v1/portal/email/google/authorize?scope=workspace&returnTo=/portal/briefings'
    const label =
      status === 'needs_reconnect' ? 'Reconnect Google Calendar' : 'Connect Google Calendar'
    return (
      <div className="flex items-center gap-2 border-b border-[var(--color-pib-line)] px-4 py-2 text-xs text-[var(--color-pib-text-muted)]">
        <span aria-hidden="true"><Icon name="calendar_today" /></span>
        <a href={href} className="text-[var(--color-pib-accent)] hover:underline">
          {label}
        </a>
      </div>
    )
  }

  const nextIdx = now === null ? -1 : meetings.findIndex((m) => !m.allDay && new Date(m.start).getTime() > now)

  return (
    <div className="flex items-center gap-2 overflow-x-auto border-b border-[var(--color-pib-line)] bg-[var(--color-surface)] px-3 py-2">
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-[var(--color-pib-text-muted)]">
        Today
      </span>
      {meetings.length === 0 && (
        <span className="text-xs text-[var(--color-pib-text-muted)]">No meetings today</span>
      )}
      {meetings.map((m, i) => (
        <div
          key={m.id}
          className={`flex shrink-0 flex-col gap-0.5 rounded-lg border p-1.5 text-xs ${
            i === nextIdx
              ? 'border-green-500 bg-green-500/10'
              : 'border-[var(--color-pib-line)] bg-[var(--color-card)]'
          }`}
          style={{ minWidth: 110 }}
        >
          <span
            className={` ${i === nextIdx ? 'text-green-400' : 'text-[var(--color-pib-text)]'}`}
          >
            {m.allDay ? 'All day' : formatTime(m.start)}
          </span>
          <span className="truncate text-[var(--color-pib-text-muted)]" title={m.title}>
            {m.title}
          </span>
          {m.meetUrl && (
            <a
              href={m.meetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-400 hover:underline"
            >
              ▶ Join
            </a>
          )}
        </div>
      ))}
      {meetings.length > 0 && (
        <span className="ml-auto shrink-0 text-[10px] text-[var(--color-pib-text-muted)]">
          {meetings.length} meeting{meetings.length !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  )
}
