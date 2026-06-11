import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { getFreeBusy } from '@/lib/google/calendar'
import { enforcePublicRateLimit, publicRequestIp } from '@/lib/api/public-rate-limit'

const SLOT_INTERVAL = 30
const BUSINESS_START = 9
const BUSINESS_END = 17
const DURATION_MINS = 20

function generateSlots(): string[] {
  const slots: string[] = []
  for (let totalMins = BUSINESS_START * 60; totalMins + DURATION_MINS <= BUSINESS_END * 60; totalMins += SLOT_INTERVAL) {
    const h = Math.floor(totalMins / 60)
    const m = totalMins % 60
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }
  return slots
}

function slotInterval(date: string, time: string): { start: Date; end: Date } {
  const [h, m] = time.split(':').map(Number)
  const start = new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+02:00`)
  const end = new Date(start.getTime() + DURATION_MINS * 60_000)
  return { start, end }
}

function overlaps(slot: { start: Date; end: Date }, busy: { start: string; end: string }[]) {
  return busy.some(b => slot.start < new Date(b.end) && slot.end > new Date(b.start))
}

export async function GET(request: NextRequest) {
  // PUBLIC: website booking availability lookup.
  const date = request.nextUrl.searchParams.get('date')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date is required (YYYY-MM-DD)' }, { status: 400 })
  }
  const limited = await enforcePublicRateLimit(request, {
    key: `booking_slots:${date}:${publicRequestIp(request)}`,
    limit: 60,
    windowMs: 15 * 60 * 1000,
  })
  if (limited) return limited

  // Reject weekends
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay()
  if (dow === 0 || dow === 6) {
    return NextResponse.json({ slots: [] })
  }

  // Existing confirmed bookings for this date
  const snap = await adminDb.collection('bookings')
    .where('date', '==', date)
    .where('status', '==', 'confirmed')
    .get()
  const bookedTimes = new Set(snap.docs.map(d => d.data().time as string))

  // Google Calendar free/busy — degrade gracefully if not configured
  let busy: { start: string; end: string }[] = []
  try {
    busy = await getFreeBusy(date)
  } catch (err) {
    console.warn('[slots] Google Calendar unavailable, falling back to Firestore only:', err)
  }

  const nowPlusBuffer = Date.now() + 60 * 60_000 // 1h buffer

  const slots = generateSlots().filter(time => {
    if (bookedTimes.has(time)) return false
    const interval = slotInterval(date, time)
    if (interval.start.getTime() < nowPlusBuffer) return false
    if (overlaps(interval, busy)) return false
    return true
  })

  return NextResponse.json({ slots })
}
