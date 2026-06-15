import {
  buildLifeExperiment,
  completeLifeExperiment,
  summarizeExperimentLoop,
} from '@/lib/self-improvement/experiments'

describe('self-improvement experiment engine', () => {
  it('builds structured experiments with hypothesis, duration, actions, and evidence requirements', () => {
    const experiment = buildLifeExperiment({
      orgId: 'org-1',
      ownerId: 'user-1',
      title: 'Morning recovery cue',
      hypothesis: 'If I move recovery to the first meeting cue, workouts will become easier to keep.',
      startDate: '2026-06-15',
      endDate: '2026-06-21',
      linkedGoalId: 'quarter-health',
      linkedActionIds: ['action-walk'],
      actions: ['Put shoes by desk', 'Ten-minute walk before first meeting'],
      evidence: ['Walk completed on 4 days', 'Energy average improved'],
      successCriteria: ['4 recovery walks', 'average energy at least 4'],
    }, '2026-06-15T08:00:00.000Z')

    expect(experiment).toMatchObject({
      orgId: 'org-1',
      ownerId: 'user-1',
      status: 'planned',
      title: 'Morning recovery cue',
      hypothesis: expect.stringContaining('first meeting cue'),
      durationDays: 7,
      actions: ['Put shoes by desk', 'Ten-minute walk before first meeting'],
      evidencePlan: ['Walk completed on 4 days', 'Energy average improved'],
      result: null,
      decision: null,
      adaptationSuggestions: expect.arrayContaining([
        expect.objectContaining({ type: 'schedule-change', rationale: expect.stringContaining('2026-06-15') }),
      ]),
    })
  })

  it('turns experiment results and decisions into automatic plan adaptation suggestions', () => {
    const experiment = buildLifeExperiment({
      orgId: 'org-1',
      ownerId: 'user-1',
      title: 'Shorter writing block',
      hypothesis: 'If writing starts with a shorter block, consistency will improve.',
      startDate: '2026-06-15',
      endDate: '2026-06-21',
      actions: ['Write for 25 minutes after coffee'],
      evidence: ['5 writing starts logged'],
      successCriteria: ['5 starts'],
    })

    const completed = completeLifeExperiment(experiment, {
      result: {
        summary: 'Started 5 times and produced two publishable drafts.',
        evidence: ['5/5 starts', '2 drafts completed'],
        metricDeltas: [{ metric: 'writing_starts', baseline: 2, latest: 5, direction: 'up' }],
      },
      decision: 'adopt',
      decidedAt: '2026-06-21T17:00:00.000Z',
    })

    expect(completed).toMatchObject({
      status: 'completed',
      result: expect.objectContaining({ summary: expect.stringContaining('Started 5 times') }),
      decision: 'adopt',
      adaptationSuggestions: expect.arrayContaining([
        expect.objectContaining({ type: 'promote-to-routine', priority: 'high' }),
        expect.objectContaining({ type: 'goal-adjustment', suggestedChange: expect.stringContaining('5 starts') }),
      ]),
    })
  })

  it('summarizes active and completed experiments for coach/dashboard surfaces', () => {
    const active = buildLifeExperiment({
      orgId: 'org-1', ownerId: 'user-1', title: 'Morning walk', hypothesis: 'Morning cue improves recovery', startDate: '2026-06-15', endDate: '2026-06-21', actions: ['walk'], evidence: ['steps'], successCriteria: ['4 walks'],
    })
    const completed = completeLifeExperiment(active, {
      result: { summary: 'Evenings failed, mornings worked.', evidence: ['4 walks'], metricDeltas: [] },
      decision: 'iterate',
    })

    expect(summarizeExperimentLoop([active, completed])).toMatchObject({
      totalExperiments: 2,
      activeExperiments: 1,
      completedExperiments: 1,
      decisions: { adopt: 0, iterate: 1, abandon: 0 },
      nextAdaptationPrompt: expect.stringContaining('Morning walk'),
    })
  })
})
