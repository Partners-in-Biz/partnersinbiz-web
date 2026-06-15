import {
  archivePlanningItem,
  buildGoalBreakdown,
  markDailyActionMissed,
  reorderPlanningItems,
  updatePlanningItemTitle,
} from '@/lib/self-improvement/planning'

describe('self-improvement planning engine', () => {
  it('breaks a long-term vision into quarterly outcomes, weekly commitments, daily actions, and review progress', () => {
    const plan = buildGoalBreakdown({
      id: 'vision-1',
      title: 'Become a stronger founder',
      horizon: '3 years',
      domains: ['Health', 'Work'],
      quarterlyOutcomes: [
        {
          id: 'quarter-1',
          title: 'Ship a consistent operating rhythm',
          targetMetric: '10 focused execution weeks',
          weeklyCommitments: [
            {
              id: 'week-1',
              title: 'Protect maker mornings',
              cadence: 'weekly',
              dailyActions: [
                { id: 'day-1', title: '90-minute deep work block', date: '2026-06-15', status: 'done' },
                { id: 'day-2', title: 'Review blocked decisions', date: '2026-06-16', status: 'planned' },
              ],
            },
          ],
        },
      ],
    })

    expect(plan.vision.title).toBe('Become a stronger founder')
    expect(plan.quarterlyOutcomes).toHaveLength(1)
    expect(plan.weeklyCommitments).toHaveLength(1)
    expect(plan.dailyActions).toHaveLength(2)
    expect(plan.reviewProgress.completedActions).toBe(1)
    expect(plan.reviewProgress.totalActions).toBe(2)
    expect(plan.reviewProgress.completionRate).toBe(0.5)
    expect(plan.reviewProgress.nextReviewPrompt).toContain('Protect maker mornings')
  })

  it('supports edit, archive, and reorder states without losing parent-child relationships', () => {
    const plan = buildGoalBreakdown({
      id: 'vision-1',
      title: 'Become a stronger founder',
      horizon: '3 years',
      quarterlyOutcomes: [
        { id: 'q1', title: 'Quarter A', weeklyCommitments: [] },
        { id: 'q2', title: 'Quarter B', weeklyCommitments: [] },
      ],
    })

    const edited = updatePlanningItemTitle(plan, 'quarterlyOutcome', 'q1', 'Quarter A refined')
    expect(edited.quarterlyOutcomes[0]).toMatchObject({ id: 'q1', title: 'Quarter A refined', state: 'edited' })

    const archived = archivePlanningItem(edited, 'quarterlyOutcome', 'q1')
    expect(archived.quarterlyOutcomes[0].state).toBe('archived')
    expect(archived.activeQuarterlyOutcomes.map((item) => item.id)).toEqual(['q2'])

    const reordered = reorderPlanningItems(archived, 'quarterlyOutcome', ['q2', 'q1'])
    expect(reordered.quarterlyOutcomes.map((item) => item.id)).toEqual(['q2', 'q1'])
    expect(reordered.quarterlyOutcomes.map((item) => item.order)).toEqual([0, 1])
    expect(reordered.quarterlyOutcomes.find((item) => item.id === 'q1')?.state).toBe('archived')
  })

  it('creates missed-action recovery states with recommit, reschedule, shrink, and archive options', () => {
    const plan = buildGoalBreakdown({
      id: 'vision-1',
      title: 'Become a stronger founder',
      horizon: '3 years',
      quarterlyOutcomes: [
        {
          id: 'quarter-1',
          title: 'Ship a consistent operating rhythm',
          weeklyCommitments: [
            {
              id: 'week-1',
              title: 'Protect maker mornings',
              dailyActions: [
                { id: 'day-1', title: '90-minute deep work block', date: '2026-06-15', status: 'planned' },
              ],
            },
          ],
        },
      ],
    })

    const recovered = markDailyActionMissed(plan, 'day-1', {
      reason: 'Client escalation took over the morning',
      recoveryDate: '2026-06-16',
    })

    expect(recovered.dailyActions[0]).toMatchObject({
      id: 'day-1',
      status: 'missed',
      state: 'recovery',
      recovery: {
        reason: 'Client escalation took over the morning',
        recoveryDate: '2026-06-16',
      },
    })
    expect(recovered.dailyActions[0].recovery?.options.map((option) => option.action)).toEqual([
      'recommit',
      'reschedule',
      'shrink',
      'archive',
    ])
    expect(recovered.reviewProgress.missedActions).toBe(1)
    expect(recovered.reviewProgress.recoveryQueue).toEqual(['day-1'])
  })
})
