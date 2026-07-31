const mockUserGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({ get: mockUserGet }),
    }),
  },
}))

import {
  calendarAttendeeBelongsToActor,
  calendarAttendeeForActor,
  calendarEventVisibleToActor,
  loadCalendarActorEmails,
} from '@/lib/calendar/access'

const client = { uid: 'member-1', role: 'client' as const, orgId: 'org-1', orgIds: ['org-1'] }

describe('calendar actor access', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({ email: 'member@example.test' }),
    })
  })

  it('matches attendees by immutable user id or authenticated account email', async () => {
    const emails = await loadCalendarActorEmails(client)
    const event = {
      attendees: [
        { name: 'Member', email: 'alias@example.test', userId: 'member-1', status: 'pending' as const },
        { name: 'Email Member', email: 'member@example.test', status: 'accepted' as const },
      ],
    }

    expect(calendarAttendeeForActor(event, client, emails)).toEqual(event.attendees[0])
    expect(calendarAttendeeBelongsToActor(event.attendees[1], client, emails)).toBe(true)
  })

  it('limits member visibility to events they created, own, or attend', () => {
    const base = {
      orgId: 'org-1',
      createdBy: 'member-2',
      assignedTo: null,
      attendees: [{ name: 'Other', email: 'other@example.test', userId: 'member-2', status: 'pending' as const }],
    }
    expect(calendarEventVisibleToActor(base, client, new Set(['member@example.test']))).toBe(false)
    expect(calendarEventVisibleToActor({
      ...base,
      assignedTo: { type: 'user' as const, id: 'member-1' },
    }, client, new Set())).toBe(true)
    expect(calendarEventVisibleToActor({
      ...base,
      orgId: 'org-2',
      createdBy: 'member-1',
    }, client, new Set())).toBe(false)
  })
})
