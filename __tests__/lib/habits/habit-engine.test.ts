import {
  buildHabitRecord,
  buildHabitCheckIn,
  summarizeHabitHealth,
  suggestHabitRecovery,
} from '@/lib/habits/engine'

describe('habit engine', () => {
  it('creates a shame-free scheduled habit with safe defaults', () => {
    const habit = buildHabitRecord({
      orgId: 'org-1',
      ownerId: 'user-1',
      title: 'Walk after lunch',
      schedule: { cadence: 'weekly', daysOfWeek: [1, 3, 5], timeOfDay: '13:00', timezone: 'Africa/Johannesburg' },
      anchor: 'After lunch',
      minimumViableAction: 'Put on shoes and walk for 5 minutes',
    }, '2026-06-01T08:00:00.000Z')

    expect(habit).toMatchObject({
      orgId: 'org-1',
      ownerId: 'user-1',
      title: 'Walk after lunch',
      status: 'active',
      schedule: { cadence: 'weekly', daysOfWeek: [1, 3, 5], timeOfDay: '13:00', timezone: 'Africa/Johannesburg' },
      anchor: 'After lunch',
      minimumViableAction: 'Put on shoes and walk for 5 minutes',
      shameFreeCopy: expect.stringContaining('consistency'),
    })
    expect(habit.createdAt).toBe('2026-06-01T08:00:00.000Z')
    expect(habit.updatedAt).toBe('2026-06-01T08:00:00.000Z')
  })

  it('records check-ins with friction reasons and a recovery suggestion instead of shame copy', () => {
    const habit = buildHabitRecord({
      orgId: 'org-1',
      ownerId: 'user-1',
      title: 'Plan tomorrow',
      schedule: { cadence: 'daily' },
      minimumViableAction: 'Write one priority',
    }, '2026-06-01T00:00:00.000Z')

    const checkIn = buildHabitCheckIn(habit, {
      localDate: '2026-06-02',
      completed: false,
      frictionReasons: ['too-tired', 'forgot'],
      note: 'Late meeting ran over',
    }, '2026-06-03T07:00:00.000Z')

    expect(checkIn).toMatchObject({
      orgId: 'org-1',
      habitId: habit.id,
      ownerId: 'user-1',
      localDate: '2026-06-02',
      completed: false,
      frictionReasons: ['too-tired', 'forgot'],
      recoverySuggestion: expect.stringContaining('Write one priority'),
    })
    expect(checkIn.recoverySuggestion.toLowerCase()).not.toContain('failed')
    expect(checkIn.recoverySuggestion.toLowerCase()).not.toContain('lazy')
  })

  it('calculates streaks, momentum, friction reasons, recovery suggestions, and weekly health', () => {
    const habit = buildHabitRecord({
      orgId: 'org-1',
      ownerId: 'user-1',
      title: 'Morning review',
      schedule: { cadence: 'daily' },
      minimumViableAction: 'Open the plan and read one line',
    }, '2026-06-01T00:00:00.000Z')

    const checkIns = [
      buildHabitCheckIn(habit, { localDate: '2026-06-08', completed: true }, '2026-06-08T08:00:00.000Z'),
      buildHabitCheckIn(habit, { localDate: '2026-06-09', completed: true }, '2026-06-09T08:00:00.000Z'),
      buildHabitCheckIn(habit, { localDate: '2026-06-10', completed: false, frictionReasons: ['too-busy'] }, '2026-06-10T08:00:00.000Z'),
      buildHabitCheckIn(habit, { localDate: '2026-06-11', completed: true }, '2026-06-11T08:00:00.000Z'),
      buildHabitCheckIn(habit, { localDate: '2026-06-12', completed: true }, '2026-06-12T08:00:00.000Z'),
      buildHabitCheckIn(habit, { localDate: '2026-06-13', completed: true }, '2026-06-13T08:00:00.000Z'),
    ]

    const summary = summarizeHabitHealth(habit, checkIns, {
      today: '2026-06-14',
      weekStart: '2026-06-08',
    })

    expect(summary.currentStreak).toBe(3)
    expect(summary.bestStreak).toBe(3)
    expect(summary.weekly.completed).toBe(5)
    expect(summary.weekly.scheduled).toBe(7)
    expect(summary.weekly.healthStatus).toBe('steady')
    expect(summary.momentumScore).toBe(71)
    expect(summary.frictionReasons).toEqual([{ reason: 'too-busy', count: 1 }])
    expect(summary.recoverySuggestion).toContain('Open the plan and read one line')
    expect(summary.weekly.summary).toContain('5 of 7')
    expect(summary.weekly.summary.toLowerCase()).not.toContain('failure')
  })

  it('suggests a smaller restart when friction repeats', () => {
    const suggestion = suggestHabitRecovery({
      habitTitle: 'Read',
      minimumViableAction: 'Read one paragraph',
      recentFrictionReasons: ['too-tired', 'too-tired', 'forgot'],
      missedScheduledDates: ['2026-06-10', '2026-06-11'],
    })

    expect(suggestion).toContain('Read one paragraph')
    expect(suggestion).toContain('energy')
    expect(suggestion.toLowerCase()).not.toContain('should have')
  })
})
