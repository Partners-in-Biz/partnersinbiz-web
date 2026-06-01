/**
 * POST /api/v1/calendar/events/:id/rsvp — update an attendee's status
 *
 * Body: { email: string, status: 'pending'|'accepted'|'declined'|'tentative' }
 * Finds the matching attendee by email (case-insensitive) and updates
 * their status in place. Returns 404 if no matching attendee exists.
 *
 * Auth: admin (AI/admin)
 */
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { lastActorFrom } from '@/lib/api/actor'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  VALID_ATTENDEE_STATUSES,
  type CalendarAttendee,
  type CalendarAttendeeStatus,
  type CalendarEvent,
} from '@/lib/calendar/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function canAccessEventOrg(user: ApiUser, orgId: string): boolean {
  if (user.role === 'admin') return canAccessOrg(user, orgId)
  if (user.role === 'ai') return !user.orgId || user.orgId === orgId
  return user.orgId === orgId || (user.orgIds ?? []).includes(orgId)
}

export const POST = withAuth('client', async (req, user, context) => {
  const { id } = await (context as RouteContext).params

  const body = (await req.json().catch(() => null)) as {
    email?: string
    status?: CalendarAttendeeStatus
  } | null
  if (!body) return apiError('Invalid JSON body')

  const email = body.email?.trim()
  const status = body.status
  if (!email) return apiError('email is required')
  if (!status || !VALID_ATTENDEE_STATUSES.includes(status)) {
    return apiError(
      'Invalid status; expected accepted | declined | tentative | pending',
    )
  }

  const ref = adminDb.collection('calendar_events').doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Event not found', 404)
  const event = doc.data() as CalendarEvent | undefined
  if (!event || event.deleted === true) {
    return apiError('Event not found', 404)
  }
  if (!canAccessEventOrg(user, event.orgId)) return apiError('Event not found', 404)

  const lowerEmail = email.toLowerCase()
  const attendees = Array.isArray(event.attendees) ? event.attendees : []

  let matched = false
  const updatedAttendees: CalendarAttendee[] = attendees.map((a) => {
    if (
      !matched &&
      typeof a?.email === 'string' &&
      a.email.toLowerCase() === lowerEmail
    ) {
      matched = true
      return { ...a, status }
    }
    return a
  })

  if (!matched) {
    return apiError('Attendee not found on this event', 404)
  }

  await ref.update({
    attendees: updatedAttendees,
    ...lastActorFrom(user),
  })

  return apiSuccess({ id, attendees: updatedAttendees })
})
