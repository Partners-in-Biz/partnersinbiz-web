'use client'

import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/studio'
import { briefingContactChannels } from '@/lib/briefing/cardFacts'
import type { BriefingCard } from '../cockpit/cockpitTypes'
import { CARD_PRIMARY_CLASS, CARD_SECONDARY_CLASS, CardFrame, Fact, Pill } from './CardFrame'
import { companyLine, isPastWhen, meetLink, metaString, personLine, whenIso, whenLabel } from './format'
import type { BookCallInput, BriefingCardActions, BusyBlock } from './types'

function defaultStart(): string {
  const next = new Date()
  next.setDate(next.getDate() + 1)
  next.setHours(10, 0, 0, 0)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}`
}

const YMD = /^\d{4}-\d{2}-\d{2}$/

function timeOf(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** "10:00–10:30 Buhle" */
export function busyBlockLabel(block: BusyBlock): string {
  const range = `${timeOf(block.start)}–${timeOf(block.end)}`
  const title = block.title?.trim()
  return title ? `${range} ${title}` : range
}

function overlaps(block: BusyBlock, start: Date, end: Date): boolean {
  const blockStart = new Date(block.start).getTime()
  const blockEnd = new Date(block.end).getTime()
  if (Number.isNaN(blockStart) || Number.isNaN(blockEnd)) return false
  return start.getTime() < blockEnd && end.getTime() > blockStart
}

function BookCallForm({
  item,
  onSubmit,
  onCancel,
  loadBusy,
  busy,
}: {
  item: BriefingCard
  onSubmit: (input: BookCallInput) => Promise<void>
  onCancel: () => void
  loadBusy: (dateYmd: string) => Promise<BusyBlock[]>
  busy: boolean
}) {
  const person = personLine(item) ?? 'contact'
  const [start, setStart] = useState(defaultStart)
  const [duration, setDuration] = useState('30')
  const [title, setTitle] = useState(`Call with ${person}`)
  const [error, setError] = useState<string | null>(null)
  const [busyBlocks, setBusyBlocks] = useState<BusyBlock[]>([])
  const busyRequest = useRef(0)
  // Keep the latest loader without re-fetching when the desk re-creates the callback.
  const loadBusyRef = useRef(loadBusy)
  loadBusyRef.current = loadBusy

  const dateYmd = start.slice(0, 10)
  useEffect(() => {
    if (!YMD.test(dateYmd)) {
      setBusyBlocks([])
      return
    }
    const request = ++busyRequest.current
    let cancelled = false
    let pending: Promise<BusyBlock[]>
    try {
      pending = Promise.resolve(loadBusyRef.current(dateYmd))
    } catch {
      pending = Promise.resolve([])
    }
    pending
      .then((blocks) => {
        if (cancelled || request !== busyRequest.current) return
        setBusyBlocks(Array.isArray(blocks) ? blocks : [])
      })
      .catch(() => {
        if (cancelled || request !== busyRequest.current) return
        setBusyBlocks([])
      })
    return () => {
      cancelled = true
    }
  }, [dateYmd])

  const startDate = new Date(start)
  const endDate = new Date(startDate.getTime() + Number(duration) * 60_000)
  const conflicts = Number.isNaN(startDate.getTime()) ? [] : busyBlocks.filter((block) => overlaps(block, startDate, endDate))

  async function submit() {
    const startDate = new Date(start)
    if (Number.isNaN(startDate.getTime())) {
      setError('Pick a date and time')
      return
    }
    const endDate = new Date(startDate.getTime() + Number(duration) * 60_000)
    setError(null)
    try {
      await onSubmit({ startAt: startDate.toISOString(), endAt: endDate.toISOString(), title: title.trim() || `Call with ${person}` })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not book the call')
    }
  }

  const fieldClass = 'h-8 w-full rounded-md border border-[var(--color-pib-line)] bg-transparent px-2 text-xs text-[var(--color-pib-text)]'

  return (
    <form
      className="mt-3 grid gap-2 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-2"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      aria-label={`Book a call with ${person}`}
    >
      <label className="grid gap-1 text-[10px] text-[var(--color-pib-text-muted)]">
        Title
        <input className={fieldClass} value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <label className="grid gap-1 text-[10px] text-[var(--color-pib-text-muted)]">
          When
          <input type="datetime-local" className={fieldClass} value={start} onChange={(event) => setStart(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-[10px] text-[var(--color-pib-text-muted)]">
          Length
          <select className={fieldClass} value={duration} onChange={(event) => setDuration(event.target.value)}>
            <option value="15">15 min</option>
            <option value="30">30 min</option>
            <option value="45">45 min</option>
            <option value="60">60 min</option>
          </select>
        </label>
      </div>
      {busyBlocks.length ? (
        <ul className="grid gap-0.5 text-[10px] text-[var(--color-pib-text-muted)]" aria-label="Busy on this day">
          {busyBlocks.map((block, index) => (
            <li key={`${block.start}-${block.end}-${index}`} className="flex items-center gap-1">
              <Icon name="event_busy" className="text-[12px]" />
              <span className="truncate">{busyBlockLabel(block)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {conflicts.length ? (
        <p className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-300" role="status">
          <Icon name="warning" className="text-[12px]" />
          Overlaps with {conflicts.map(busyBlockLabel).join(', ')}
        </p>
      ) : null}
      {error ? <p className="text-[10px] text-red-500">{error}</p> : null}
      <div className="flex items-center gap-2">
        <button type="submit" className={CARD_PRIMARY_CLASS} disabled={busy}>
          <Icon name="event_available" />
          {conflicts.length ? 'Book anyway' : 'Create invite'}
        </button>
        <button type="button" className={CARD_SECONDARY_CLASS} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
      <p className="text-[10px] text-[var(--color-pib-text-muted)]">Creates a Google Calendar event with a Meet link and invites {person}.</p>
    </form>
  )
}

export function MeetingCard({ item, actions }: { item: BriefingCard; actions: BriefingCardActions }) {
  const [booking, setBooking] = useState(false)
  const type = item.source.type
  const channels = briefingContactChannels(item)
  const person = personLine(item)
  const company = companyLine(item)
  const when = whenLabel(item)
  const past = isPastWhen(item)
  const link = meetLink(item)
  const isBooking = type === 'booking'
  const isCalendar = type === 'calendar-event'
  const eyebrow = isBooking ? 'Booking' : isCalendar ? 'Meeting' : type === 'deal' ? 'Deal call' : 'Call'
  const eyebrowIcon = isBooking || isCalendar ? 'event' : 'phone_in_talk'
  const href = actions.sourceHref(item)
  const status = metaString(item, 'bookingStatus', 'status', 'rsvpStatus')

  const primary = (() => {
    if (link) {
      return (
        <a href={link} target="_blank" rel="noopener noreferrer" className={CARD_PRIMARY_CLASS} onClick={(event) => event.stopPropagation()}>
          <Icon name="videocam" />
          Join
        </a>
      )
    }
    if (isBooking && actions.canAddMeetLink(item)) {
      return (
        <button type="button" className={CARD_PRIMARY_CLASS} disabled={actions.busy} onClick={(event) => { event.stopPropagation(); actions.addMeetLink(item) }}>
          <Icon name="add_link" />
          Add Meet link
        </button>
      )
    }
    if (channels.phone) {
      return (
        <a href={`tel:${channels.phone}`} className={CARD_PRIMARY_CLASS} onClick={(event) => event.stopPropagation()}>
          <Icon name="call" />
          Call
        </a>
      )
    }
    if (channels.email) {
      return (
        <a href={`mailto:${channels.email}`} className={CARD_PRIMARY_CLASS} onClick={(event) => event.stopPropagation()}>
          <Icon name="mail" />
          Email
        </a>
      )
    }
    if (href) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={CARD_PRIMARY_CLASS} onClick={(event) => event.stopPropagation()}>
          <Icon name="open_in_new" />
          Open
        </a>
      )
    }
    return (
      <button type="button" className={CARD_PRIMARY_CLASS} disabled={actions.busy} onClick={(event) => { event.stopPropagation(); actions.done(item) }}>
        <Icon name="done" />
        Done
      </button>
    )
  })()

  const secondary = (() => {
    if (!isBooking && !isCalendar && actions.canBookCall(item)) {
      return (
        <button type="button" className={CARD_SECONDARY_CLASS} disabled={actions.busy} onClick={(event) => { event.stopPropagation(); setBooking((value) => !value) }} aria-expanded={booking}>
          <Icon name="event_available" />
          Book call
        </button>
      )
    }
    if (link && channels.phone) {
      return (
        <a href={`tel:${channels.phone}`} className={CARD_SECONDARY_CLASS} onClick={(event) => event.stopPropagation()}>
          <Icon name="call" />
          Call
        </a>
      )
    }
    if ((isBooking || isCalendar) && (past || link)) {
      return (
        <button type="button" className={CARD_SECONDARY_CLASS} disabled={actions.busy} onClick={(event) => { event.stopPropagation(); actions.done(item) }}>
          <Icon name="done" />
          Done
        </button>
      )
    }
    return null
  })()

  return (
    <CardFrame
      item={item}
      kind="meeting"
      eyebrowIcon={eyebrowIcon}
      eyebrow={eyebrow}
      busy={actions.busy}
      onSelect={actions.select}
      onSnooze={actions.snooze}
      onSnoozeUntil={actions.snoozeUntil}
      meetingStartIso={whenIso(item)}
      onMore={actions.openMore}
      actions={
        <>
          {primary}
          {secondary}
        </>
      }
    >
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {when ? <Pill tone={past ? 'warn' : 'ok'}><Icon name="schedule" className="text-[12px]" />{past ? `${when} · passed` : when}</Pill> : null}
        {isBooking ? (
          link ? <Pill tone="ok"><Icon name="videocam" className="text-[12px]" />Meet ready</Pill> : <Pill tone="danger"><Icon name="link_off" className="text-[12px]" />Meet link missing</Pill>
        ) : null}
        {isCalendar && status ? <Pill tone="info">RSVP: {status}</Pill> : null}
        {!isBooking && !isCalendar && status ? <Pill>{status}</Pill> : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Fact label="Meeting" value={item.context.calendarEventTitle} />
        <Fact label={isCalendar ? 'Contact' : 'Who'} value={person} />
        <Fact label="Company" value={company} />
        <Fact label="Deal" value={item.context.dealTitle} />
        <Fact label="Email" value={channels.email} href={channels.email ? `mailto:${channels.email}` : null} />
        <Fact label="Phone" value={channels.phone} href={channels.phone ? `tel:${channels.phone}` : null} />
      </div>
      {booking ? (
        <BookCallForm
          item={item}
          busy={actions.busy}
          loadBusy={actions.loadBusy}
          onCancel={() => setBooking(false)}
          onSubmit={async (input) => {
            await actions.bookCall(item, input)
            setBooking(false)
          }}
        />
      ) : null}
    </CardFrame>
  )
}
