import {
  buildReminderPreferences,
  buildReminderSchedule,
  evaluateReminderDue,
  type ReminderCandidate,
} from '@/lib/self-improvement/reminders'

describe('Life OS reminder infrastructure', () => {
  const candidate: ReminderCandidate = {
    orgId: 'org-1',
    ownerId: 'user-1',
    kind: 'daily-check-in',
    title: 'Daily check-in',
    body: 'Capture wins, misses, and tomorrow\'s one honest action.',
    localDate: '2026-06-15',
    preferredTime: '07:30',
    timezone: 'Africa/Johannesburg',
    target: { type: 'life-os-check-in', id: '2026-06-15' },
  }

  it('defaults reminders to opt-out until the user explicitly consents', () => {
    const preferences = buildReminderPreferences({
      orgId: 'org-1',
      ownerId: 'user-1',
    }, '2026-06-15T05:00:00.000Z')

    expect(preferences.optedIn).toBe(false)
    expect(preferences.channels).toEqual({ inApp: true, push: false, email: false })
    expect(preferences.quietHours).toEqual({ start: '21:00', end: '07:00', timezone: 'Africa/Johannesburg' })
    expect(preferences.enabledKinds).toEqual(expect.arrayContaining(['daily-check-in', 'habit-prompt', 'weekly-review', 'recovery-nudge']))
  })

  it('suppresses due reminders without consent, when kind is disabled, and during quiet hours', () => {
    const optedOut = buildReminderPreferences({ orgId: 'org-1', ownerId: 'user-1' })
    expect(evaluateReminderDue(candidate, optedOut, '2026-06-15T05:30:00.000Z')).toMatchObject({
      due: false,
      reason: 'consent-required',
    })

    const disabledKind = buildReminderPreferences({
      orgId: 'org-1',
      ownerId: 'user-1',
      optedIn: true,
      enabledKinds: ['weekly-review'],
    })
    expect(evaluateReminderDue(candidate, disabledKind, '2026-06-15T05:30:00.000Z')).toMatchObject({
      due: false,
      reason: 'kind-disabled',
    })

    const quietHours = buildReminderPreferences({ orgId: 'org-1', ownerId: 'user-1', optedIn: true })
    expect(evaluateReminderDue(candidate, quietHours, '2026-06-15T04:30:00.000Z')).toMatchObject({
      due: false,
      reason: 'quiet-hours',
      nextEligibleAt: '2026-06-15T07:00:00.000+02:00',
    })
  })

  it('creates scheduled records for daily check-ins, habit prompts, weekly reviews, and recovery nudges', () => {
    const preferences = buildReminderPreferences({
      orgId: 'org-1',
      ownerId: 'user-1',
      optedIn: true,
      channels: { inApp: true, push: true, email: false },
    }, '2026-06-15T05:00:00.000Z')

    const reminders = buildReminderSchedule([
      candidate,
      { ...candidate, kind: 'habit-prompt', title: 'Walk after lunch', target: { type: 'habit', id: 'habit-1' } },
      { ...candidate, kind: 'weekly-review', title: 'Weekly review', localDate: '2026-06-21', preferredTime: '16:00', target: { type: 'life-os-review', id: 'week-25' } },
      { ...candidate, kind: 'recovery-nudge', title: 'Recovery nudge', preferredTime: '09:00', target: { type: 'daily-action', id: 'action-1' } },
    ], preferences, '2026-06-15T05:45:00.000Z')

    expect(reminders).toHaveLength(4)
    expect(reminders.map((reminder) => reminder.kind)).toEqual(['daily-check-in', 'habit-prompt', 'weekly-review', 'recovery-nudge'])
    expect(reminders[0]).toMatchObject({
      orgId: 'org-1',
      ownerId: 'user-1',
      status: 'scheduled',
      channels: { inApp: true, push: true, email: false },
      scheduledFor: '2026-06-15T07:30:00.000+02:00',
      consentSnapshot: { optedIn: true },
    })
  })
})
