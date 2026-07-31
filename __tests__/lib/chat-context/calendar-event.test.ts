import { calendarEventChatActions } from '@/lib/chat-context/adapters/calendarEvent'

describe('calendar event chat actions', () => {
  it('offers only authenticated-attendee RSVP transitions', () => {
    expect(calendarEventChatActions({
      eventId: 'event-1',
      attendee: {
        name: 'Jane',
        email: 'jane@example.test',
        userId: 'member-1',
        status: 'pending',
      },
    })).toEqual([
      {
        id: 'rsvp-calendar-event:event-1:accepted',
        label: 'Accept invitation',
        href: '/api/v1/calendar/events/event-1/rsvp',
        method: 'POST',
        requiresApproval: true,
        body: { email: 'jane@example.test', status: 'accepted' },
      },
      {
        id: 'rsvp-calendar-event:event-1:tentative',
        label: 'Mark tentative',
        href: '/api/v1/calendar/events/event-1/rsvp',
        method: 'POST',
        requiresApproval: true,
        body: { email: 'jane@example.test', status: 'tentative' },
      },
      {
        id: 'rsvp-calendar-event:event-1:declined',
        label: 'Decline invitation',
        href: '/api/v1/calendar/events/event-1/rsvp',
        method: 'POST',
        destructive: true,
        requiresApproval: true,
        body: { email: 'jane@example.test', status: 'declined' },
      },
    ])
    expect(calendarEventChatActions({ eventId: 'event-1', attendee: null })).toEqual([])
  })
})
