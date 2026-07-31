import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import type { CalendarAttendee, CalendarEvent } from '@/lib/calendar/types'

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizedEmail(value: unknown): string {
  return clean(value).toLowerCase()
}

function actorUidMatches(value: unknown, uid: string): boolean {
  const candidate = clean(value)
  return candidate === uid || candidate === `user:${uid}`
}

export async function loadCalendarActorEmails(user: ApiUser): Promise<Set<string>> {
  const emails = new Set<string>()
  if (user.role !== 'client' || !user.uid) return emails
  const snap = await adminDb.collection('users').doc(user.uid).get()
  if (!snap.exists) return emails
  const data = snap.data() ?? {}
  for (const value of [
    data.email,
    data.emailAddress,
    data.primaryEmail,
    (data.google as Record<string, unknown> | undefined)?.email,
  ]) {
    const email = normalizedEmail(value)
    if (email) emails.add(email)
  }
  return emails
}

export function calendarAttendeeForActor(
  event: Pick<CalendarEvent, 'attendees'>,
  user: ApiUser,
  actorEmails: Set<string>,
): CalendarAttendee | null {
  const attendees = Array.isArray(event.attendees) ? event.attendees : []
  return attendees.find((attendee) => (
    actorUidMatches(attendee?.userId, user.uid)
    || Boolean(normalizedEmail(attendee?.email) && actorEmails.has(normalizedEmail(attendee.email)))
  )) ?? null
}

export function calendarEventVisibleToActor(
  event: Pick<CalendarEvent, 'orgId' | 'createdBy' | 'assignedTo' | 'attendees'>,
  user: ApiUser,
  actorEmails: Set<string>,
): boolean {
  if (!canAccessOrg(user, event.orgId)) return false
  if (user.role === 'admin' || user.role === 'ai') return true
  if (actorUidMatches(event.createdBy, user.uid)) return true
  if (event.assignedTo?.type === 'user' && actorUidMatches(event.assignedTo.id, user.uid)) return true
  return Boolean(calendarAttendeeForActor(event, user, actorEmails))
}

export function calendarAttendeeBelongsToActor(
  attendee: CalendarAttendee,
  user: ApiUser,
  actorEmails: Set<string>,
): boolean {
  if (user.role === 'admin' || user.role === 'ai') return true
  return actorUidMatches(attendee.userId, user.uid)
    || Boolean(normalizedEmail(attendee.email) && actorEmails.has(normalizedEmail(attendee.email)))
}
