const mockEventGet = jest.fn()
const mockUserGet = jest.fn()
const mockResolveContextReferences = jest.fn()

jest.mock('@/lib/chat-context/adapters/generic', () => ({
  genericChatContextAdapter: {
    resolve: jest.fn(async () => ({
      ok: true,
      model: {
        context: {
          kind: 'calendar_event',
          id: 'event-1',
          orgId: 'org-1',
          label: 'Launch review',
          icon: 'calendar_month',
          href: '/portal/projects/project-1?event=event-1&orgId=org-1',
        },
        pulse: { label: 'calendar', metrics: [] },
        groups: [],
        artifacts: [],
        attention: [],
        activity: [],
        capabilities: ['open'],
        asOf: '2026-07-31T09:00:00.000Z',
      },
    })),
  },
}))

jest.mock('@/lib/context-references/registry', () => ({
  resolveContextReferences: (...args: unknown[]) => mockResolveContextReferences(...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: () => ({
        get: name === 'calendar_events' ? mockEventGet : mockUserGet,
      }),
    }),
  },
}))

describe('calendar event chat context adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEventGet.mockResolvedValue({
      exists: true,
      id: 'event-1',
      data: () => ({
        orgId: 'org-1',
        title: 'Launch review',
        description: 'Review the final launch package.',
        startAt: '2026-08-01T08:00:00.000Z',
        endAt: '2026-08-01T09:00:00.000Z',
        allDay: false,
        timezone: 'Africa/Johannesburg',
        location: 'Google Meet',
        meetingUrl: 'https://meet.google.com/example',
        attendees: [
          { name: 'Jane Member', email: 'jane@example.test', userId: 'member-1', status: 'pending' },
          { name: 'Peet', email: 'peet@example.test', userId: 'admin-1', status: 'accepted' },
        ],
        relatedTo: { type: 'project', id: 'project-1' },
        assignedTo: { type: 'user', id: 'member-1' },
        reminderMinutesBefore: [60],
        recurrence: null,
        createdBy: 'admin-1',
        createdByType: 'user',
        createdAt: '2026-07-30T08:00:00.000Z',
        updatedAt: '2026-07-31T08:00:00.000Z',
        deleted: false,
      }),
    })
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({ email: 'jane@example.test' }),
    })
    mockResolveContextReferences.mockResolvedValue([{
      type: 'project',
      id: 'project-1',
      orgId: 'org-1',
      label: 'Launch project',
      href: '/portal/projects/project-1',
    }])
  })

  it('projects live timing, attendees, RSVP attention, activity, and related context', async () => {
    const { calendarEventChatContextAdapter } = await import('@/lib/chat-context/adapters/calendarEvent')
    const result = await calendarEventChatContextAdapter.resolve({
      kind: 'calendar_event',
      id: 'event-1',
      user: { uid: 'member-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'] },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.pulse.metrics).toEqual(expect.arrayContaining([
      { id: 'attendees', label: 'Attendees', value: 2 },
      { id: 'accepted', label: 'Accepted', value: 1 },
      { id: 'pending', label: 'Pending', value: 1 },
      { id: 'your-rsvp', label: 'Your RSVP', value: 'Pending' },
    ]))
    expect(result.model.attention[0]).toEqual(expect.objectContaining({
      id: 'calendar-rsvp',
      actions: expect.arrayContaining([
        expect.objectContaining({ id: 'rsvp-calendar-event:event-1:accepted' }),
      ]),
    }))
    expect(result.model.relationships).toEqual([
      expect.objectContaining({ kind: 'project', id: 'project-1', relation: 'Related record' }),
    ])
    expect(result.model.activity.map((item) => item.id)).toEqual([
      'calendar-event-updated',
      'calendar-event-created',
    ])
    expect(result.model.capabilities).toContain('inline-actions')
  })

  it('fails closed for an unrelated same-organisation member', async () => {
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({ email: 'other@example.test' }),
    })
    const { calendarEventChatContextAdapter } = await import('@/lib/chat-context/adapters/calendarEvent')
    const result = await calendarEventChatContextAdapter.resolve({
      kind: 'calendar_event',
      id: 'event-1',
      user: { uid: 'member-2', role: 'client', orgId: 'org-1', orgIds: ['org-1'] },
    })

    expect(result).toMatchObject({ ok: false, reason: 'not_found', status: 404 })
    expect(mockResolveContextReferences).not.toHaveBeenCalled()
  })
})
