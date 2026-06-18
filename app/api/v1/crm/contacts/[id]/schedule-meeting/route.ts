/**
 * POST /api/v1/crm/contacts/:id/schedule-meeting
 *
 * Create a calendar event for a contact and log it on the CRM timeline.
 * Auth: member+
 */
import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { CalendarAssignee } from '@/lib/calendar/types'
import { getFreshGoogleAccessToken, googleAccountHasScopes } from '@/lib/google/userToken'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

type CreatedGoogleCalendarEvent = {
  id?: string
  htmlLink?: string
  hangoutLink?: string
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>
  }
}

const GOOGLE_CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function parseReminderMinutes(value: unknown): number[] {
  if (!Array.isArray(value)) return [60, 10]
  const minutes = value
    .map((item) => (typeof item === 'number' && Number.isFinite(item) ? Math.round(item) : null))
    .filter((item): item is number => item !== null && item >= 0 && item <= 10080)
  return Array.from(new Set(minutes)).slice(0, 8)
}

function parseAssignee(value: unknown): CalendarAssignee | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const type = input.type
  const id = cleanString(input.id)
  if ((type !== 'user' && type !== 'agent') || !id) return null
  return { type, id }
}

function googleMeetUrl(event: CreatedGoogleCalendarEvent): string {
  return (
    cleanString(event.hangoutLink) ||
    cleanString(event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri)
  )
}

async function createGoogleCalendarEvent(input: {
  orgId: string
  uid: string
  title: string
  description: string
  start: Date
  end: Date
  timezone: string
  contactName: string
  contactEmail: string
  reminderMinutesBefore: number[]
}): Promise<
  | { ok: true; googleEvent: CreatedGoogleCalendarEvent; accountId: string; accountEmail: string }
  | { ok: false; status: number; error: string }
> {
  const token = await getFreshGoogleAccessToken({ orgId: input.orgId, uid: input.uid })
  if (!token.ok) {
    return {
      ok: false,
      status: 409,
      error: token.notConnected
        ? 'Google Calendar is not connected for this profile'
        : `Google Calendar needs reconnect: ${token.reason}`,
    }
  }
  if (!googleAccountHasScopes(token.scopes, [GOOGLE_CALENDAR_EVENTS_SCOPE])) {
    return {
      ok: false,
      status: 409,
      error: 'Google Calendar needs reconnect with calendar.events permission before CRM meetings can be scheduled',
    }
  }

  const googleBody = {
    summary: input.title,
    description: input.description || `CRM meeting with ${input.contactName}`,
    start: { dateTime: input.start.toISOString(), timeZone: input.timezone },
    end: { dateTime: input.end.toISOString(), timeZone: input.timezone },
    attendees: [{ displayName: input.contactName, email: input.contactEmail }],
    reminders: {
      useDefault: input.reminderMinutesBefore.length === 0,
      overrides: input.reminderMinutesBefore.map((minutes) => ({ method: 'popup', minutes })),
    },
    conferenceData: {
      createRequest: {
        requestId: `crm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
  }

  const params = new URLSearchParams({ conferenceDataVersion: '1', sendUpdates: 'all' })
  const googleRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(googleBody),
  })
  if (!googleRes.ok) {
    return { ok: false, status: 502, error: 'Google Calendar event creation failed' }
  }
  const googleEvent = (await googleRes.json()) as CreatedGoogleCalendarEvent
  return { ok: true, googleEvent, accountId: token.accountId, accountEmail: token.emailAddress }
}

export const POST = withCrmAuth<RouteCtx>(
  'member',
  async (req: NextRequest, ctx, routeCtx) => {
    const { id } = await routeCtx!.params

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return apiError('Invalid JSON body', 400)
    }

    const start = parseIsoDate(body.startAt)
    const end = parseIsoDate(body.endAt)
    if (!start) return apiError('startAt must be a valid ISO date', 400)
    if (!end) return apiError('endAt must be a valid ISO date', 400)
    if (end.getTime() <= start.getTime()) return apiError('endAt must be after startAt', 400)

    const contactRef = adminDb.collection('contacts').doc(id)
    const snap = await contactRef.get()
    if (!snap.exists) return apiError('Contact not found', 404)

    const contact = snap.data() ?? {}
    if (contact.orgId !== ctx.orgId) return apiError('Contact not found', 404)

    const contactEmail = cleanString(contact.email)
    if (!contactEmail) return apiError('Contact has no email address', 400)

    const contactName = cleanString(contact.name) || contactEmail
    const title = cleanString(body.title) || `Meeting with ${contactName}`
    const description = cleanString(body.description)
    const timezone = cleanString(body.timezone) || 'Africa/Johannesburg'
    let location = cleanString(body.location)
    let meetingUrl = cleanString(body.meetingUrl)
    let googleEventId = ''
    let googleHtmlLink = ''
    let googleAccountId = ''
    let googleAccountEmail = ''
    const reminderMinutesBefore = parseReminderMinutes(body.reminderMinutesBefore)
    const assignedTo =
      parseAssignee(body.assignedTo) ??
      (ctx.actor.uid ? { type: ctx.actor.kind === 'agent' ? 'agent' : 'user', id: ctx.actor.uid } : null)

    if (!meetingUrl && !ctx.isAgent && ctx.uid) {
      const googleCreate = await createGoogleCalendarEvent({
        orgId: ctx.orgId,
        uid: ctx.uid,
        title,
        description,
        start,
        end,
        timezone,
        contactName,
        contactEmail,
        reminderMinutesBefore,
      })
      if (!googleCreate.ok) return apiError(googleCreate.error, googleCreate.status)
      googleEventId = cleanString(googleCreate.googleEvent.id)
      googleHtmlLink = cleanString(googleCreate.googleEvent.htmlLink)
      googleAccountId = googleCreate.accountId
      googleAccountEmail = googleCreate.accountEmail
      meetingUrl = googleMeetUrl(googleCreate.googleEvent)
      if (!location && meetingUrl) location = 'Google Meet'
    }

    const eventRef = adminDb.collection('calendar_events').doc()
    const activityRef = adminDb.collection('activities').doc()
    const batch = adminDb.batch()

    const eventData = {
      orgId: ctx.orgId,
      title,
      description,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      allDay: false,
      timezone,
      location,
      meetingUrl,
      attendees: [{ name: contactName, email: contactEmail, status: 'pending' }],
      relatedTo: { type: 'contact', id },
      assignedTo,
      reminderMinutesBefore,
      recurrence: null,
      ...(googleEventId
        ? {
            googleEventId,
            googleCalendarId: 'primary',
            googleAccountId,
            googleAccountEmail,
            googleHtmlLink,
            googleSyncedAt: FieldValue.serverTimestamp(),
          }
        : {}),
      createdBy: ctx.actor.uid ?? 'system',
      createdByType: ctx.actor.kind === 'agent' ? 'agent' : 'user',
      createdByRef: ctx.actor,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      deleted: false,
    }

    const activityData = {
      orgId: ctx.orgId,
      contactId: id,
      type: 'note',
      summary: `Meeting scheduled: ${title}`,
      metadata: {
        calendarEventId: eventRef.id,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        timezone,
        location,
        meetingUrl,
        googleEventId: googleEventId || null,
        googleHtmlLink: googleHtmlLink || null,
        googleAccountEmail: googleAccountEmail || null,
      },
      createdBy: ctx.actor.uid,
      createdByRef: ctx.actor,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      deleted: false,
    }

    batch.set(eventRef, eventData)
    batch.set(activityRef, activityData)
    batch.update(contactRef, {
      lastContactedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    await batch.commit()

    return apiSuccess(
      {
        event: { id: eventRef.id, ...eventData },
        activity: { id: activityRef.id, ...activityData },
      },
      201,
    )
  },
)
