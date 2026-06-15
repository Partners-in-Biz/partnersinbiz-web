import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { fulfillConfirmedBooking } from '@/lib/bookings/fulfillment'

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? '__session'

type Params = { params: Promise<{ id: string }> }

function authorizedByBearer(request: NextRequest): boolean {
  const header = request.headers.get('authorization') ?? ''
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  const expected = process.env.PIB_AGENT_API_KEY || process.env.AI_API_KEY
  return Boolean(token && expected && token === expected)
}

async function authorizedBySession(request: NextRequest): Promise<boolean> {
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value
  if (!sessionCookie) return false
  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true)
    const userDoc = await adminDb.collection('users').doc(decoded.uid).get()
    return userDoc.exists && userDoc.data()?.role === 'admin'
  } catch {
    return false
  }
}

async function isAuthorized(request: NextRequest): Promise<boolean> {
  if (authorizedByBearer(request)) return true
  return authorizedBySession(request)
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function POST(request: NextRequest, { params }: Params) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const bookingRef = adminDb.collection('bookings').doc(id)
  const snap = await bookingRef.get()
  if (!snap.exists) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  const booking = snap.data() ?? {}
  if (clean(booking.status) !== 'confirmed') {
    return NextResponse.json({ error: 'Only confirmed bookings can be repaired' }, { status: 409 })
  }

  const result = await fulfillConfirmedBooking({
    id,
    name: clean(booking.name),
    email: clean(booking.email).toLowerCase(),
    company: clean(booking.company),
    brief: clean(booking.brief),
    date: clean(booking.date),
    time: clean(booking.time),
    durationMins: typeof booking.durationMins === 'number' ? booking.durationMins : 20,
    timezone: clean(booking.timezone) || 'Africa/Johannesburg',
    googleEventId: clean(booking.googleEventId),
    meetLink: clean(booking.meetLink),
    crmContactId: clean(booking.crmContactId),
    calendarEventId: clean(booking.calendarEventId),
  }, { sendGoogleUpdates: 'none' })

  return NextResponse.json({ id, repaired: result.errors.length === 0, ...result })
}
