import {
  buildDailyCheckIn,
  buildWeeklyReview,
  summarizeReflectionInsights,
} from '@/lib/self-improvement/reflections'

describe('self-improvement reflection engine', () => {
  it('builds daily check-ins with coach and dashboard-ready signals', () => {
    const checkIn = buildDailyCheckIn({
      orgId: 'org-1',
      ownerId: 'user-1',
      localDate: '2026-06-15',
      wins: ['Protected a deep-work block'],
      misses: ['Skipped the walk'],
      lessons: ['Late meetings drain the evening plan'],
      energy: 2,
      mood: 3,
      blockers: ['too many meetings'],
      priorities: ['ship the review flow'],
      nextExperiments: ['move walking to the morning'],
    }, '2026-06-15T08:00:00.000Z')

    expect(checkIn).toMatchObject({
      orgId: 'org-1',
      ownerId: 'user-1',
      localDate: '2026-06-15',
      type: 'daily',
      energy: 2,
      mood: 3,
      coachContext: expect.objectContaining({
        emotionalTone: 'low-energy',
        blockerThemes: ['too many meetings'],
        nextCoachPrompt: expect.stringContaining('ship the review flow'),
      }),
      dashboardSignals: expect.objectContaining({
        winCount: 1,
        missCount: 1,
        lessonCount: 1,
        blockerCount: 1,
        experimentCount: 1,
        energyMoodAverage: 2.5,
      }),
    })
  })

  it('builds weekly reviews that turn evidence into next experiments', () => {
    const review = buildWeeklyReview({
      orgId: 'org-1',
      ownerId: 'user-1',
      weekStart: '2026-06-15',
      weekEnd: '2026-06-21',
      wins: ['Three protected maker blocks'],
      misses: ['Two recovery workouts missed'],
      lessons: ['Morning actions survive schedule changes'],
      energy: 4,
      mood: 4,
      blockers: ['evening fatigue'],
      priorities: ['keep maker mornings', 'recover workouts'],
      nextExperiments: ['ten-minute morning workout'],
    }, '2026-06-21T17:00:00.000Z')

    expect(review).toMatchObject({
      periodType: 'weekly',
      periodStart: '2026-06-15',
      periodEnd: '2026-06-21',
      summary: expect.stringContaining('Three protected maker blocks'),
      coachContext: expect.objectContaining({
        nextCoachPrompt: expect.stringContaining('ten-minute morning workout'),
      }),
      dashboardSignals: expect.objectContaining({
        priorityCount: 2,
        experimentCount: 1,
        energyMoodAverage: 4,
      }),
    })
  })

  it('summarizes reflection records for the insights dashboard', () => {
    const daily = buildDailyCheckIn({
      orgId: 'org-1', ownerId: 'user-1', localDate: '2026-06-15', wins: ['won'], misses: [], lessons: ['learned'], energy: 5, mood: 4, blockers: [], priorities: ['focus'], nextExperiments: [],
    })
    const weekly = buildWeeklyReview({
      orgId: 'org-1', ownerId: 'user-1', weekStart: '2026-06-15', weekEnd: '2026-06-21', wins: [], misses: ['missed'], lessons: [], energy: 3, mood: 2, blockers: ['blocked'], priorities: [], nextExperiments: ['try smaller'],
    })

    expect(summarizeReflectionInsights([daily], [weekly])).toMatchObject({
      totalWins: 1,
      totalMisses: 1,
      totalLessons: 1,
      totalBlockers: 1,
      averageEnergy: 4,
      averageMood: 3,
      activeExperiments: ['try smaller'],
      coachBrief: expect.stringContaining('1 wins'),
    })
  })
})
