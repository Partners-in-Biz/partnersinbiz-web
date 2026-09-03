'use client'

import { useState, useEffect } from 'react'
import {
  Button,
  Choice,
  ChoiceGrid,
  Field,
  Input,
  Notice,
  Panel,
  Row,
  Stack,
  Steps,
  Textarea,
  Title,
} from '@/components/studio'

type Step = 'date' | 'time' | 'details' | 'confirmed'

interface Booking {
  date: string
  time: string
  name: string
  email: string
  company: string
  brief: string
}

const STEPS = ['Date', 'Time', 'Your details'] as const
const STEP_INDEX: Record<Exclude<Step, 'confirmed'>, number> = { date: 0, time: 1, details: 2 }

function getWorkingDays(count: number): string[] {
  const days: string[] = []
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + 1)
  while (days.length < count) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) {
      days.push(d.toISOString().split('T')[0])
    }
    d.setDate(d.getDate() + 1)
  }
  return days
}

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-ZA', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function formatShortDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-ZA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export default function BookingWidget() {
  const [step, setStep] = useState<Step>('date')
  const [booking, setBooking] = useState<Partial<Booking>>({})
  const [slots, setSlots] = useState<string[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [bookingId, setBookingId] = useState('')

  const workingDays = getWorkingDays(14)

  useEffect(() => {
    if (!booking.date) return
    setLoadingSlots(true)
    setSlots([])
    fetch(`/api/bookings/slots?date=${booking.date}`)
      .then((r) => r.json())
      .then((d) => setSlots(d.slots ?? []))
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false))
  }, [booking.date])

  function selectDate(date: string) {
    setBooking((b) => ({ ...b, date, time: undefined }))
    setStep('time')
  }

  function selectTime(time: string) {
    setBooking((b) => ({ ...b, time }))
    setStep('details')
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(booking),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 409) {
          setError(data.error)
          setStep('time')
          return
        }
        throw new Error(data.error ?? 'Booking failed')
      }
      setBookingId(data.id)
      setStep('confirmed')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (step === 'confirmed') {
    return (
      <Panel>
        <Stack>
          <p className="sc-tiny">Booked</p>
          <Title>
            {formatDate(booking.date!)} at {booking.time} SAST.
          </Title>
          <p className="sc-body">
            Confirmation sent to <strong>{booking.email}</strong>. Peet will follow up with a Google Meet link shortly.
          </p>
          <p className="sc-tiny">Ref {bookingId}</p>
        </Stack>
      </Panel>
    )
  }

  return (
    <Panel>
      <Steps steps={STEPS} current={STEP_INDEX[step]} />

      {step === 'date' && (
        <Stack>
          <Title>Pick a date.</Title>
          <ChoiceGrid cols={3}>
            {workingDays.map((date) => (
              <Choice key={date} onClick={() => selectDate(date)}>
                {formatShortDate(date)}
              </Choice>
            ))}
          </ChoiceGrid>
        </Stack>
      )}

      {step === 'time' && (
        <Stack>
          <Row>
            <Title>{formatDate(booking.date!)}</Title>
            <Button variant="ghost" size="sm" onClick={() => setStep('date')}>
              Change date
            </Button>
          </Row>
          {error && <Notice tone="danger">{error}</Notice>}
          {loadingSlots ? (
            <p className="sc-body">Loading slots.</p>
          ) : slots.length === 0 ? (
            <Stack>
              <p className="sc-body">No slots available on this day.</p>
              <Button variant="secondary" onClick={() => setStep('date')}>
                Choose another day
              </Button>
            </Stack>
          ) : (
            <ChoiceGrid cols={4}>
              {slots.map((time) => (
                <Choice key={time} center mono onClick={() => selectTime(time)}>
                  {time}
                </Choice>
              ))}
            </ChoiceGrid>
          )}
          <p className="sc-tiny">All times in SAST (UTC+2)</p>
        </Stack>
      )}

      {step === 'details' && (
        <form onSubmit={submit} className="st-stack">
          <Row>
            <div>
              <Title>Your details.</Title>
              <p className="st-help">
                {formatDate(booking.date!)} at {booking.time} SAST
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setStep('time')}>
              Change time
            </Button>
          </Row>

          <Field id="booking-name" label="Name">
            <Input
              id="booking-name"
              type="text"
              required
              autoComplete="name"
              value={booking.name ?? ''}
              onChange={(e) => setBooking((b) => ({ ...b, name: e.target.value }))}
              placeholder="Your name"
            />
          </Field>
          <Field id="booking-email" label="Email">
            <Input
              id="booking-email"
              type="email"
              required
              autoComplete="email"
              value={booking.email ?? ''}
              onChange={(e) => setBooking((b) => ({ ...b, email: e.target.value }))}
              placeholder="you@company.com"
            />
          </Field>
          <Field id="booking-company" label="Company" hint="Optional">
            <Input
              id="booking-company"
              type="text"
              autoComplete="organization"
              value={booking.company ?? ''}
              onChange={(e) => setBooking((b) => ({ ...b, company: e.target.value }))}
              placeholder="Your company name"
            />
          </Field>
          <Field id="booking-brief" label="What is the project about?" hint="Optional">
            <Textarea
              id="booking-brief"
              value={booking.brief ?? ''}
              onChange={(e) => setBooking((b) => ({ ...b, brief: e.target.value }))}
              placeholder="Two or three sentences on what you are building and what help you need"
              rows={3}
            />
          </Field>

          {error && <Notice tone="danger">{error}</Notice>}

          <Button type="submit" block loading={submitting}>
            {submitting ? 'Confirming' : 'Confirm booking'}
          </Button>
        </form>
      )}
    </Panel>
  )
}
