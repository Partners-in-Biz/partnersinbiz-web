import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { createCalendarEvent } from '@/lib/google/calendar'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

type BookingFulfillmentInput = {
  id: string
  name: string
  email: string
  date: string
  time: string
  company?: string | null
  brief?: string | null
  durationMins?: number | null
  timezone?: string | null
  googleEventId?: string | null
  meetLink?: string | null
  crmContactId?: string | null
  calendarEventId?: string | null
}

type BookingFulfillmentOptions = {
  sendGoogleUpdates?: 'all' | 'none'
  recoverGoogleEvent?: boolean
}

type BookingFulfillmentResult = {
  crmContactId: string | null
  calendarEventId: string | null
  googleEventId: string | null
  meetLink: string | null
  errors: string[]
}

const DEFAULT_DURATION_MINS = 20
const DEFAULT_TIMEZONE = 'Africa/Johannesburg'

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalEmail(value: unknown): string {
  return clean(value).toLowerCase()
}

function bookingStart(date: string, time: string): Date {
  const [hour, minute] = time.split(':').map(Number)
  return new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+02:00`)
}

function eventWindow(date: string, time: string, durationMins?: number | null) {
  const start = bookingStart(date, time)
  const end = new Date(start.getTime() + (durationMins || DEFAULT_DURATION_MINS) * 60_000)
  return { startAt: start.toISOString(), endAt: end.toISOString() }
}

function uniqueTags(existing: unknown): string[] {
  const tags = Array.isArray(existing) ? existing.filter((tag): tag is string => typeof tag === 'string') : []
  for (const tag of ['public-booking', 'booking']) {
    if (!tags.includes(tag)) tags.push(tag)
  }
  return tags
}

async function findContactByEmail(email: string) {
  const snap = await adminDb
    .collection('contacts')
    .where('orgId', '==', PIB_PLATFORM_ORG_ID)
    .where('email', '==', email)
    .limit(1)
    .get()

  return snap.docs.find((doc) => (doc.data() ?? {}).deleted !== true) ?? null
}

async function upsertBookingContact(booking: BookingFulfillmentInput): Promise<string> {
  const email = normalEmail(booking.email)
  const name = clean(booking.name) || email
  const company = clean(booking.company)
  const brief = clean(booking.brief)
  const existing = await findContactByEmail(email)

  if (existing) {
    const data = existing.data() ?? {}
    await existing.ref.update({
      name: clean(data.name) || name,
      company: clean(data.company) || company,
      source: clean(data.source) || 'form',
      type: clean(data.type) || 'lead',
      stage: clean(data.stage) || 'new',
      tags: uniqueTags(data.tags),
      notes: brief && !clean(data.notes).includes(brief)
        ? [clean(data.notes), `Public booking ${booking.id}: ${brief}`].filter(Boolean).join('\n\n')
        : clean(data.notes),
      publicBookingIds: FieldValue.arrayUnion(booking.id),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'system:public-booking',
      updatedByType: 'system',
    })
    return existing.id
  }

  const ref = adminDb.collection('contacts').doc()
  await ref.set({
    orgId: PIB_PLATFORM_ORG_ID,
    name,
    email,
    phone: '',
    company,
    website: '',
    source: 'form',
    type: 'lead',
    stage: 'new',
    tags: ['public-booking', 'booking'],
    notes: brief ? `Public booking ${booking.id}: ${brief}` : `Public booking ${booking.id}`,
    publicBookingIds: [booking.id],
    deleted: false,
    subscribedAt: FieldValue.serverTimestamp(),
    unsubscribedAt: null,
    bouncedAt: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastContactedAt: null,
    createdBy: 'system:public-booking',
    createdByType: 'system',
    updatedBy: 'system:public-booking',
    updatedByType: 'system',
  })
  return ref.id
}

async function findBookingCalendarEvent(booking: BookingFulfillmentInput, contactId: string) {
  if (clean(booking.calendarEventId)) {
    const direct = await adminDb.collection('calendar_events').doc(clean(booking.calendarEventId)).get()
    if (direct.exists) return direct
  }

  const byBooking = await adminDb
    .collection('calendar_events')
    .where('orgId', '==', PIB_PLATFORM_ORG_ID)
    .where('sourceBookingId', '==', booking.id)
    .limit(1)
    .get()
  if (!byBooking.empty) return byBooking.docs[0]

  const { startAt } = eventWindow(booking.date, booking.time, booking.durationMins)
  const byContact = await adminDb
    .collection('calendar_events')
    .where('orgId', '==', PIB_PLATFORM_ORG_ID)
    .where('relatedTo.type', '==', 'contact')
    .where('relatedTo.id', '==', contactId)
    .where('startAt', '==', startAt)
    .limit(1)
    .get()
  return byContact.empty ? null : byContact.docs[0]
}

async function upsertBookingCalendarEvent(
  booking: BookingFulfillmentInput,
  contactId: string,
  meetingUrl: string,
): Promise<string> {
  const existing = await findBookingCalendarEvent(booking, contactId)
  const { startAt, endAt } = eventWindow(booking.date, booking.time, booking.durationMins)
  const name = clean(booking.name) || normalEmail(booking.email)
  const email = normalEmail(booking.email)
  const description = [
    '20-min intro call booked via partnersinbiz.online',
    `Booking ID: ${booking.id}`,
    clean(booking.company) ? `Company: ${clean(booking.company)}` : '',
    clean(booking.brief) ? `Brief: ${clean(booking.brief)}` : '',
  ].filter(Boolean).join('\n')

  const patch = {
    orgId: PIB_PLATFORM_ORG_ID,
    title: `Intro Call — ${name}`,
    description,
    startAt,
    endAt,
    allDay: false,
    timezone: clean(booking.timezone) || DEFAULT_TIMEZONE,
    location: meetingUrl ? 'Google Meet' : '',
    meetingUrl,
    attendees: [{ name, email, status: 'pending' }],
    relatedTo: { type: 'contact', id: contactId },
    assignedTo: null,
    reminderMinutesBefore: [60, 10],
    recurrence: null,
    sourceBookingId: booking.id,
    googleEventId: clean(booking.googleEventId),
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
  }

  if (existing) {
    await existing.ref.update(patch)
    return existing.id
  }

  const ref = adminDb.collection('calendar_events').doc()
  await ref.set({
    ...patch,
    createdBy: 'system:public-booking',
    createdByType: 'system',
    createdAt: FieldValue.serverTimestamp(),
  })
  return ref.id
}

export async function fulfillConfirmedBooking(
  booking: BookingFulfillmentInput,
  options: BookingFulfillmentOptions = {},
): Promise<BookingFulfillmentResult> {
  const errors: string[] = []
  let googleEventId = clean(booking.googleEventId) || null
  let meetLink = clean(booking.meetLink) || null
  let crmContactId = clean(booking.crmContactId) || null
  let calendarEventId = clean(booking.calendarEventId) || null

  try {
    crmContactId = await upsertBookingContact(booking)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    errors.push(`crm_contact: ${message}`)
    console.error('[bookings] CRM contact sync failed:', message)
  }

  const shouldRecoverGoogle = options.recoverGoogleEvent !== false && (!googleEventId || !meetLink)
  if (shouldRecoverGoogle) {
    try {
      const result = await createCalendarEvent({
        id: booking.id,
        name: clean(booking.name),
        email: normalEmail(booking.email),
        date: booking.date,
        time: booking.time,
        sendUpdates: options.sendGoogleUpdates ?? 'none',
      })
      googleEventId = result.eventId || googleEventId
      meetLink = result.meetLink || meetLink
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`google_calendar: ${message}`)
      console.error('[bookings] Google Calendar recovery failed:', message)
    }
  }

  if (crmContactId) {
    try {
      calendarEventId = await upsertBookingCalendarEvent(
        { ...booking, googleEventId, meetLink, crmContactId, calendarEventId },
        crmContactId,
        meetLink ?? '',
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`calendar_event: ${message}`)
      console.error('[bookings] internal calendar sync failed:', message)
    }
  }

  const bookingPatch: Record<string, unknown> = {
    crmContactId,
    calendarEventId,
    googleEventId: googleEventId ?? '',
    meetLink: meetLink ?? '',
    fulfillmentStatus: errors.length ? 'partial' : 'ok',
    fulfillmentErrors: errors,
    lastFulfillmentAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  await adminDb.collection('bookings').doc(booking.id).set(bookingPatch, { merge: true })

  return { crmContactId, calendarEventId, googleEventId, meetLink, errors }
}
