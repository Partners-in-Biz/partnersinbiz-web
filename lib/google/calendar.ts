import { google } from 'googleapis'

const TIMEZONE = 'Africa/Johannesburg'
const DURATION_MINS = 20

function getCalendarClient() {
  const auth = new google.auth.JWT({
    email: process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim(),
    key: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n').trim(),
    scopes: ['https://www.googleapis.com/auth/calendar'],
    // Impersonate the calendar owner so the service account can write to their calendar
    subject: process.env.GOOGLE_CALENDAR_ID,
  })
  return google.calendar({ version: 'v3', auth })
}

export async function getFreeBusy(date: string): Promise<{ start: string; end: string }[]> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID
  if (!calendarId) throw new Error('GOOGLE_CALENDAR_ID not set')

  const cal = getCalendarClient()
  const res = await cal.freebusy.query({
    requestBody: {
      timeMin: `${date}T00:00:00+02:00`,
      timeMax: `${date}T23:59:59+02:00`,
      timeZone: TIMEZONE,
      items: [{ id: calendarId }],
    },
  })
  return (res.data.calendars?.[calendarId]?.busy ?? [])
    .filter((b): b is { start: string; end: string } => !!b.start && !!b.end)
}

export interface CalendarEventResult {
  eventId: string
  meetLink: string
}

export async function createCalendarEvent(booking: {
  id?: string
  name: string
  email: string
  date: string
  time: string
  sendUpdates?: 'all' | 'none'
}): Promise<CalendarEventResult> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID
  if (!calendarId) throw new Error('GOOGLE_CALENDAR_ID not set')

  const cal = getCalendarClient()
  const [hour, minute] = booking.time.split(':').map(Number)
  const pad = (n: number) => String(n).padStart(2, '0')

  const startDt = `${booking.date}T${pad(hour)}:${pad(minute)}:00`
  const endTotalMins = hour * 60 + minute + DURATION_MINS
  const endDt = `${booking.date}T${pad(Math.floor(endTotalMins / 60))}:${pad(endTotalMins % 60)}:00`
  const requestId = (booking.id ? `pib-booking-${booking.id}` : `pib-${booking.date}-${booking.time}-${booking.email}`)
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 96)

  const event = await cal.events.insert({
    calendarId,
    sendUpdates: booking.sendUpdates ?? 'all',
    conferenceDataVersion: 1,
    requestBody: {
      summary: `Intro Call — ${booking.name}`,
      description: `20-min intro call booked via partnersinbiz.online\n\nClient: ${booking.name}\nEmail: ${booking.email}${booking.id ? `\nBooking ID: ${booking.id}` : ''}`,
      start: { dateTime: startDt, timeZone: TIMEZONE },
      end: { dateTime: endDt, timeZone: TIMEZONE },
      attendees: [{ email: booking.email, displayName: booking.name }],
      conferenceData: {
        createRequest: {
          requestId,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 60 },
          { method: 'popup', minutes: 15 },
        ],
      },
    },
  })

  const meetLink =
    event.data.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri ?? ''

  return { eventId: event.data.id ?? '', meetLink }
}
