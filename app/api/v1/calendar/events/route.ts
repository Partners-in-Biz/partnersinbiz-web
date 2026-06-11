/**
 * GET  /api/v1/calendar/events — list events in a date window
 * POST /api/v1/calendar/events — create a new event (idempotent via Idempotency-Key)
 *
 * Collection: `calendar_events`
 *
 * Auth: admin (AI/admin)
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withIdempotency } from '@/lib/api/idempotency'
import { actorFrom } from '@/lib/api/actor'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  VALID_ATTENDEE_STATUSES,
  VALID_RELATED_TO_TYPES,
  VALID_ASSIGNEE_TYPES,
  type CalendarAssignee,
  type CalendarAttendee,
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarRelatedTo,
} from '@/lib/calendar/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req) => {
  const { searchParams } = new URL(req.url)

  const orgId = searchParams.get('orgId')
  if (!orgId) return apiError('orgId is required; pass it as a query param')

  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const relatedToType = searchParams.get('relatedToType')
  const relatedToId = searchParams.get('relatedToId')
  const assignedToRaw = searchParams.get('assignedTo') // "user:abc" | "agent:xyz"

  const limit = Math.min(
    Math.max(parseInt(searchParams.get('limit') ?? '200', 10), 1),
    500,
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = adminDb
    .collection('calendar_events')
    .where('orgId', '==', orgId)

  if (from) query = query.where('startAt', '>=', from)
  if (to) query = query.where('startAt', '<=', to)

  if (relatedToType) query = query.where('relatedTo.type', '==', relatedToType)
  if (relatedToId) query = query.where('relatedTo.id', '==', relatedToId)

  if (assignedToRaw) {
    const [type, ...rest] = assignedToRaw.split(':')
    const id = rest.join(':')
    if (
      VALID_ASSIGNEE_TYPES.includes(type as CalendarAssignee['type']) &&
      id
    ) {
      query = query
        .where('assignedTo.type', '==', type)
        .where('assignedTo.id', '==', id)
    }
  }

  query = query.orderBy('startAt', 'asc').limit(limit)

  const snapshot = await query.get()
  const events: CalendarEvent[] = snapshot.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((doc: any) => ({ id: doc.id, ...doc.data() }) as CalendarEvent)
    .filter((e: CalendarEvent) => e.deleted !== true)

  return apiSuccess(events)
})

function validateAttendees(
  attendees: unknown,
): { ok: true; value: CalendarAttendee[] } | { ok: false; error: string } {
  if (attendees === undefined) return { ok: true, value: [] }
  if (!Array.isArray(attendees)) {
    return { ok: false, error: 'attendees must be an array' }
  }
  const normalized: CalendarAttendee[] = []
  for (const raw of attendees) {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'Each attendee must be an object' }
    }
    const a = raw as Partial<CalendarAttendee>
    if (!a.email || typeof a.email !== 'string') {
      return { ok: false, error: 'Each attendee requires an email' }
    }
    const status = a.status ?? 'pending'
    if (!VALID_ATTENDEE_STATUSES.includes(status)) {
      return {
        ok: false,
        error:
          'Invalid attendee status; expected pending | accepted | declined | tentative',
      }
    }
    normalized.push({
      name: (a.name ?? '').toString(),
      email: a.email,
      status,
      ...(a.userId ? { userId: a.userId } : {}),
    })
  }
  return { ok: true, value: normalized }
}

function validateRelatedTo(
  relatedTo: unknown,
):
  | { ok: true; value: CalendarRelatedTo | null }
  | { ok: false; error: string } {
  if (relatedTo === undefined || relatedTo === null) {
    return { ok: true, value: null }
  }
  if (typeof relatedTo !== 'object') {
    return { ok: false, error: 'relatedTo must be an object' }
  }
  const r = relatedTo as Partial<CalendarRelatedTo>
  if (
    !r.type ||
    !VALID_RELATED_TO_TYPES.includes(r.type as CalendarRelatedTo['type']) ||
    !r.id
  ) {
    return {
      ok: false,
      error:
        "Invalid relatedTo; expected { type: 'contact'|'deal'|'project'|'client_org', id }",
    }
  }
  return { ok: true, value: { type: r.type, id: r.id } }
}

function validateAssignedTo(
  assignedTo: unknown,
):
  | { ok: true; value: CalendarAssignee | null }
  | { ok: false; error: string } {
  if (assignedTo === undefined || assignedTo === null) {
    return { ok: true, value: null }
  }
  if (typeof assignedTo !== 'object') {
    return { ok: false, error: 'assignedTo must be an object' }
  }
  const a = assignedTo as Partial<CalendarAssignee>
  if (
    !a.type ||
    !VALID_ASSIGNEE_TYPES.includes(a.type as CalendarAssignee['type']) ||
    !a.id
  ) {
    return {
      ok: false,
      error: "Invalid assignedTo; expected { type: 'user'|'agent', id }",
    }
  }
  return { ok: true, value: { type: a.type, id: a.id } }
}

export const POST = withAuth(
  'admin',
  withIdempotency(async (req, user) => {
    const body = (await req.json().catch(() => null)) as
      | (CalendarEventInput & { orgId?: string })
      | null
    if (!body) return apiError('Invalid JSON body')

    if (!body.orgId?.trim()) return apiError('orgId is required')
    if (!body.title?.trim()) return apiError('Title is required')
    if (!body.startAt) return apiError('startAt is required (ISO string)')
    if (!body.endAt) return apiError('endAt is required (ISO string)')
    if (body.startAt >= body.endAt) {
      return apiError('startAt must be earlier than endAt')
    }

    const attendeesCheck = validateAttendees(body.attendees)
    if (!attendeesCheck.ok) return apiError(attendeesCheck.error)

    const relatedToCheck = validateRelatedTo(body.relatedTo)
    if (!relatedToCheck.ok) return apiError(relatedToCheck.error)

    const assignedToCheck = validateAssignedTo(body.assignedTo)
    if (!assignedToCheck.ok) return apiError(assignedToCheck.error)

    const reminderMinutesBefore = Array.isArray(body.reminderMinutesBefore)
      ? body.reminderMinutesBefore.filter(
          (n): n is number => typeof n === 'number' && Number.isFinite(n),
        )
      : []

    const orgId = body.orgId.trim()
    const title = body.title.trim()
    const assignedTo = assignedToCheck.value

    const docRef = await adminDb.collection('calendar_events').add({
      orgId,
      title,
      description: body.description?.trim() ?? '',
      startAt: body.startAt,
      endAt: body.endAt,
      allDay: body.allDay ?? false,
      timezone: body.timezone ?? 'UTC',
      location: body.location ?? '',
      meetingUrl: body.meetingUrl ?? '',
      attendees: attendeesCheck.value,
      relatedTo: relatedToCheck.value,
      assignedTo,
      reminderMinutesBefore,
      recurrence: body.recurrence ?? null,
      ...actorFrom(user),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      deleted: false,
    })

    // Notify the assignee (if any).
    if (assignedTo) {
      await adminDb.collection('notifications').add({
        orgId,
        userId: assignedTo.type === 'user' ? assignedTo.id : null,
        agentId: assignedTo.type === 'agent' ? assignedTo.id : null,
        type: 'calendar.event.assigned',
        title: 'Calendar event assigned to you',
        body: `"${title}" — starts ${body.startAt}`,
        link: `/portal/dashboard`,
        status: 'unread',
        priority: 'normal',
        createdAt: FieldValue.serverTimestamp(),
      })
    }

    return apiSuccess({ id: docRef.id }, 201)
  }),
)
