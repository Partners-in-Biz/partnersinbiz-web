'use client'

import { useState, useEffect } from 'react'

type Step = 'date' | 'time' | 'details' | 'confirmed'

interface Booking {
  date: string
  time: string
  name: string
  email: string
  company: string
  brief: string
}

function getWorkingDays(count: number): string[] {
  const days: string[] = []
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  // Start from tomorrow
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
    weekday: 'long', month: 'long', day: 'numeric',
  })
}

function formatShortDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-ZA', {
    weekday: 'short', month: 'short', day: 'numeric',
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
      .then(r => r.json())
      .then(d => setSlots(d.slots ?? []))
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false))
  }, [booking.date])

  function selectDate(date: string) {
    setBooking(b => ({ ...b, date, time: undefined }))
    setStep('time')
  }

  function selectTime(time: string) {
    setBooking(b => ({ ...b, time }))
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
      <div className="bento-card p-8 text-center space-y-4">
        <div className="w-14 h-14 rounded-full bg-[var(--color-pib-accent)] flex items-center justify-center mx-auto">
          <span className="material-symbols-outlined text-2xl text-black">check</span>
        </div>
        <h2 className="text-2xl font-semibold">You&rsquo;re booked in!</h2>
        <p className="text-[var(--color-pib-text-muted)]">
          {formatDate(booking.date!)} at {booking.time} SAST
        </p>
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          Confirmation sent to <strong>{booking.email}</strong>.<br />
          Peet will follow up with a Google Meet link shortly.
        </p>
        <p className="text-xs text-[var(--color-pib-text-faint)] font-mono">Ref: {bookingId}</p>
      </div>
    )
  }

  return (
    <div className="bento-card p-6 md:p-8 space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-[var(--color-pib-text-faint)]">
        {(['date', 'time', 'details'] as const).map((s, i) => (
          <span key={s} className="flex items-center gap-2">
            {i > 0 && <span>→</span>}
            <span className={step === s ? 'text-[var(--color-pib-accent)] font-medium' : ''}>
              {s === 'date' ? '1. Date' : s === 'time' ? '2. Time' : '3. Your details'}
            </span>
          </span>
        ))}
      </div>

      {/* Step: Date */}
      {step === 'date' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Pick a date</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {workingDays.map(date => (
              <button
                key={date}
                onClick={() => selectDate(date)}
                className="p-3 rounded-lg border border-[var(--color-pib-line)] text-sm text-left hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-accent)] transition-colors"
              >
                {formatShortDate(date)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step: Time */}
      {step === 'time' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setStep('date')}
              className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
            >
              <span className="material-symbols-outlined text-base">arrow_back</span>
            </button>
            <h2 className="text-lg font-semibold">{formatDate(booking.date!)}</h2>
          </div>
          {loadingSlots ? (
            <p className="text-sm text-[var(--color-pib-text-muted)]">Loading slots…</p>
          ) : slots.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-pib-text-muted)]">No slots available on this day.</p>
              <button onClick={() => setStep('date')} className="btn-pib-secondary text-sm">
                Choose another day
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {slots.map(time => (
                <button
                  key={time}
                  onClick={() => selectTime(time)}
                  className="p-3 rounded-lg border border-[var(--color-pib-line)] text-sm font-mono text-center hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-accent)] transition-colors"
                >
                  {time}
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-[var(--color-pib-text-faint)]">All times in SAST (UTC+2)</p>
        </div>
      )}

      {/* Step: Details */}
      {step === 'details' && (
        <form onSubmit={submit} className="space-y-5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setStep('time')}
              className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
            >
              <span className="material-symbols-outlined text-base">arrow_back</span>
            </button>
            <div>
              <h2 className="text-lg font-semibold">Your details</h2>
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                {formatDate(booking.date!)} at {booking.time} SAST
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm mb-1.5">Name <span className="text-[var(--color-pib-accent)]">*</span></label>
              <input
                type="text"
                required
                value={booking.name ?? ''}
                onChange={e => setBooking(b => ({ ...b, name: e.target.value }))}
                placeholder="Your name"
                className="w-full bg-transparent border border-[var(--color-pib-line)] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[var(--color-pib-accent)] transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm mb-1.5">Email <span className="text-[var(--color-pib-accent)]">*</span></label>
              <input
                type="email"
                required
                value={booking.email ?? ''}
                onChange={e => setBooking(b => ({ ...b, email: e.target.value }))}
                placeholder="you@company.com"
                className="w-full bg-transparent border border-[var(--color-pib-line)] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[var(--color-pib-accent)] transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm mb-1.5">Company <span className="text-xs text-[var(--color-pib-text-faint)]">(optional)</span></label>
              <input
                type="text"
                value={booking.company ?? ''}
                onChange={e => setBooking(b => ({ ...b, company: e.target.value }))}
                placeholder="Your company name"
                className="w-full bg-transparent border border-[var(--color-pib-line)] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[var(--color-pib-accent)] transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm mb-1.5">What&rsquo;s the project about? <span className="text-xs text-[var(--color-pib-text-faint)]">(optional)</span></label>
              <textarea
                value={booking.brief ?? ''}
                onChange={e => setBooking(b => ({ ...b, brief: e.target.value }))}
                placeholder="2–3 sentences on what you're building and what help you need"
                rows={3}
                className="w-full bg-transparent border border-[var(--color-pib-line)] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[var(--color-pib-accent)] transition-colors resize-none"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button type="submit" disabled={submitting} className="btn-pib-accent w-full">
            {submitting ? (
              <>
                <span className="material-symbols-outlined text-base animate-spin">autorenew</span>
                Confirming…
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-base">event_available</span>
                Confirm booking
              </>
            )}
          </button>
        </form>
      )}
    </div>
  )
}
