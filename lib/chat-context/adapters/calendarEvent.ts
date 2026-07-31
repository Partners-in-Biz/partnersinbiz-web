import type { ChatContextAdapter } from '@/lib/chat-context/access'
import { genericChatContextAdapter } from '@/lib/chat-context/adapters/generic'
import type {
  ChatContextAction,
  ChatContextReadModel,
  ChatContextRelationship,
  ContextActivitySummary,
  ContextAttentionSummary,
  ContextDisplayState,
} from '@/lib/chat-context/types'
import {
  calendarAttendeeForActor,
  calendarEventVisibleToActor,
  loadCalendarActorEmails,
} from '@/lib/calendar/access'
import type {
  CalendarAttendee,
  CalendarAttendeeStatus,
  CalendarEvent,
} from '@/lib/calendar/types'
import { resolveContextReferences } from '@/lib/context-references/registry'
import { adminDb } from '@/lib/firebase/admin'

function clean(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function dateString(value: unknown): string | undefined {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (value && typeof value === 'object') {
    const raw = value as { toDate?: () => Date; toMillis?: () => number; seconds?: number; _seconds?: number }
    try {
      const converted = raw.toDate?.()
      if (converted && !Number.isNaN(converted.getTime())) return converted.toISOString()
      const millis = raw.toMillis?.()
      if (typeof millis === 'number' && Number.isFinite(millis)) return new Date(millis).toISOString()
      const seconds = raw.seconds ?? raw._seconds
      if (typeof seconds === 'number' && Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString()
    } catch {
      return undefined
    }
  }
  return undefined
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function attendeeLabel(attendee: CalendarAttendee): string {
  return clean(attendee.name, 120) || clean(attendee.email, 160) || 'Attendee'
}

export function calendarEventChatActions(input: {
  eventId: string
  attendee: CalendarAttendee | null
}): ChatContextAction[] {
  if (!input.eventId || !input.attendee?.email) return []
  const current = input.attendee.status
  const statuses: Array<{ status: CalendarAttendeeStatus; label: string; destructive?: true }> = [
    { status: 'accepted', label: 'Accept invitation' },
    { status: 'tentative', label: 'Mark tentative' },
    { status: 'declined', label: 'Decline invitation', destructive: true },
  ]
  return statuses.filter((item) => item.status !== current).map((item) => ({
    id: `rsvp-calendar-event:${input.eventId}:${item.status}`,
    label: item.label,
    href: `/api/v1/calendar/events/${encodeURIComponent(input.eventId)}/rsvp`,
    method: 'POST' as const,
    ...(item.destructive ? { destructive: true } : {}),
    requiresApproval: true,
    body: { email: input.attendee!.email, status: item.status },
  }))
}

function stateFor(event: CalendarEvent, attendee: CalendarAttendee | null, now: number): ContextDisplayState {
  if (attendee?.status === 'declined') return 'archived'
  const start = Date.parse(event.startAt)
  const end = Date.parse(event.endAt)
  if (Number.isFinite(end) && end < now) return 'complete'
  if (Number.isFinite(start) && start <= now && (!Number.isFinite(end) || end >= now)) return 'running'
  if (attendee?.status === 'pending') return 'needs_input'
  return 'waiting'
}

function activityFor(event: CalendarEvent): ContextActivitySummary[] {
  const updatedAt = dateString(event.updatedAt)
  const createdAt = dateString(event.createdAt)
  return [
    ...(updatedAt ? [{
      id: 'calendar-event-updated',
      type: 'running' as const,
      label: 'Event updated',
      occurredAt: updatedAt,
      ...(clean((event as unknown as Record<string, unknown>).updatedBy, 120)
        ? { actorLabel: clean((event as unknown as Record<string, unknown>).updatedBy, 120) }
        : {}),
    }] : []),
    ...(createdAt ? [{
      id: 'calendar-event-created',
      type: 'pickup' as const,
      label: 'Event created',
      occurredAt: createdAt,
      ...(clean(event.createdBy, 120) ? { actorLabel: clean(event.createdBy, 120) } : {}),
    }] : []),
  ]
}

async function relatedContext(
  event: CalendarEvent,
  input: Parameters<ChatContextAdapter['resolve']>[0],
): Promise<ChatContextRelationship[]> {
  const type = event.relatedTo?.type
  const kind = type === 'contact' || type === 'deal' || type === 'project' ? type : null
  if (!kind || !event.relatedTo?.id) return []
  const [ref] = await resolveContextReferences([
    { type: kind, id: event.relatedTo.id, orgId: event.orgId, origin: 'manual' },
  ], input.user, event.orgId)
  return ref ? [{
    kind: ref.type,
    id: ref.id,
    label: ref.label,
    relation: 'Related record',
    ...(ref.href ? { href: ref.href } : {}),
  }] : []
}

export const calendarEventChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    if (input.kind !== 'calendar_event') {
      return { ok: false, reason: 'unsupported', status: 400, error: 'Unsupported calendar context' }
    }
    const base = await genericChatContextAdapter.resolve(input)
    if (!base.ok) return base
    const snap = await adminDb.collection('calendar_events').doc(input.id).get()
    if (!snap.exists) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const event = { id: snap.id, ...(snap.data() ?? {}) } as CalendarEvent
    if (event.deleted === true || event.orgId !== base.model.context.orgId) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }
    const actorEmails = await loadCalendarActorEmails(input.user)
    if (!calendarEventVisibleToActor(event, input.user, actorEmails)) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }

    const attendee = calendarAttendeeForActor(event, input.user, actorEmails)
    const actions = calendarEventChatActions({ eventId: snap.id, attendee })
    const relationships = await relatedContext(event, input)
    const href = base.model.context.href
    const attendees = Array.isArray(event.attendees) ? event.attendees : []
    const pendingCount = attendees.filter((item) => item.status === 'pending').length
    const acceptedCount = attendees.filter((item) => item.status === 'accepted').length
    const timing = [
      dateString(event.startAt)?.replace('.000Z', 'Z') || clean(event.startAt),
      dateString(event.endAt)?.replace('.000Z', 'Z') || clean(event.endAt),
      clean(event.timezone, 80),
    ].filter(Boolean).join(' → ')
    const attention: ContextAttentionSummary[] = attendee?.status === 'pending'
      ? [{
          id: 'calendar-rsvp',
          label: 'Your RSVP is required',
          state: 'needs_input',
          detail: timing,
          href,
          ...(actions.length > 0 ? { actions } : {}),
        }]
      : []
    const metrics: ChatContextReadModel['pulse']['metrics'] = [
      { id: 'start', label: 'Starts', value: dateString(event.startAt)?.slice(0, 16).replace('T', ' ') || clean(event.startAt) },
      { id: 'attendees', label: 'Attendees', value: attendees.length },
      { id: 'accepted', label: 'Accepted', value: acceptedCount },
      { id: 'pending', label: 'Pending', value: pendingCount },
      ...(attendee ? [{ id: 'your-rsvp', label: 'Your RSVP', value: titleCase(attendee.status) }] : []),
    ]

    return {
      ok: true,
      model: {
        context: { ...base.model.context, label: clean(event.title, 180) || base.model.context.label, href },
        pulse: {
          label: 'Calendar event',
          metrics,
          headline: clean(event.description) || timing,
          ...(attention[0] ? {
            next: {
              id: attention[0].id,
              label: attention[0].label,
              state: attention[0].state,
              detail: attention[0].detail,
              href,
            },
          } : {}),
        },
        groups: [
          {
            id: 'event',
            label: 'Event',
            items: [{
              id: snap.id,
              label: clean(event.title, 180) || 'Calendar event',
              state: stateFor(event, attendee, Date.now()),
              detail: [
                timing,
                clean(event.location) ? `Location: ${clean(event.location)}` : '',
                event.allDay ? 'All day' : '',
              ].filter(Boolean).join(' · '),
              href,
              ...(dateString(event.updatedAt) ? { updatedAt: dateString(event.updatedAt) } : {}),
            }],
          },
          ...(attendees.length > 0 ? [{
            id: 'attendees',
            label: 'Attendees',
            items: attendees.slice(0, 20).map((item, index) => ({
              id: `${index}:${clean(item.email, 160)}`,
              label: attendeeLabel(item),
              state: item.status === 'accepted'
                ? 'complete' as const
                : item.status === 'declined'
                  ? 'archived' as const
                  : item.status === 'pending'
                    ? 'needs_input' as const
                    : 'waiting' as const,
              detail: titleCase(item.status),
              href,
            })),
          }] : []),
        ],
        artifacts: [],
        attention,
        activity: activityFor(event),
        preview: {
          kind: 'summary',
          text: `${clean(event.title, 180) || 'Calendar event'} · ${timing}`,
          status: attendee?.status || stateFor(event, attendee, Date.now()),
          ...(dateString(event.updatedAt) ? { version: dateString(event.updatedAt) } : {}),
        },
        ...(relationships.length > 0 ? { relationships } : {}),
        capabilities: ['open', 'preview', 'attendees', ...(actions.length > 0 ? ['inline-actions'] : [])],
        asOf: new Date().toISOString(),
      },
    }
  },
}
