import {
  assembleCoachContext,
  buildAiCoachWorkflow,
  detectSafetyBoundary,
} from '@/lib/self-improvement/coach'
import { buildDailyCheckIn, buildWeeklyReview } from '@/lib/self-improvement/reflections'
import { buildGoalBreakdown } from '@/lib/self-improvement/planning'

describe('self-improvement AI coach workflow', () => {
  const plan = buildGoalBreakdown({
    id: 'vision-1',
    title: 'Become a calmer, healthier founder',
    horizon: '12 months',
    domains: ['Health', 'Work'],
    quarterlyOutcomes: [
      {
        id: 'outcome-1',
        title: 'Protect health while shipping',
        targetMetric: '4 recovery sessions per week',
        weeklyCommitments: [
          {
            id: 'commitment-1',
            title: 'Morning recovery routine',
            cadence: 'weekdays',
            dailyActions: [
              { id: 'action-1', title: '10-minute walk before first meeting', date: '2026-06-15', status: 'missed' },
              { id: 'action-2', title: '90-minute maker block', date: '2026-06-16', status: 'done' },
            ],
          },
        ],
      },
    ],
  })

  const daily = buildDailyCheckIn({
    orgId: 'org-1',
    ownerId: 'user-1',
    localDate: '2026-06-15',
    wins: ['Protected maker block'],
    misses: ['Skipped walk'],
    lessons: ['Morning actions survive interruptions'],
    energy: 2,
    mood: 3,
    blockers: ['meetings start too early', 'late-day fatigue'],
    priorities: ['restart recovery routine'],
    nextExperiments: ['walk before opening Slack'],
  }, '2026-06-15T08:00:00.000Z')

  const weekly = buildWeeklyReview({
    orgId: 'org-1',
    ownerId: 'user-1',
    weekStart: '2026-06-08',
    weekEnd: '2026-06-14',
    wins: ['Two maker blocks'],
    misses: ['Three walks missed'],
    lessons: ['Late-day recovery fails when meetings overrun'],
    energy: 3,
    mood: 3,
    blockers: ['calendar overload'],
    priorities: ['protect sleep'],
    nextExperiments: ['put recovery before calls'],
  }, '2026-06-14T17:00:00.000Z')

  it('assembles plan, reflection, obstacle, and experiment context for the coach', () => {
    const context = assembleCoachContext({ orgId: 'org-1', ownerId: 'user-1', plan, dailyCheckIns: [daily], weeklyReviews: [weekly] })

    expect(context).toMatchObject({
      orgId: 'org-1',
      ownerId: 'user-1',
      identityDirection: expect.stringContaining('calmer, healthier founder'),
      planSnapshot: expect.objectContaining({
        activeOutcomes: ['Protect health while shipping'],
        activeCommitments: ['Morning recovery routine'],
        missedActions: ['10-minute walk before first meeting'],
      }),
      reflectionSummary: expect.objectContaining({
        wins: ['Protected maker block', 'Two maker blocks'],
        lessons: ['Morning actions survive interruptions', 'Late-day recovery fails when meetings overrun'],
        energyTrend: 'low',
      }),
      obstacleDiagnosis: expect.objectContaining({
        primaryObstacle: 'meetings start too early',
        likelyPattern: 'Schedule friction is making the intended action too late or too exposed to interruptions.',
      }),
      experimentBacklog: expect.arrayContaining([expect.objectContaining({ title: expect.stringContaining('recovery') })]),
    })
  })

  it('builds guarded prompt instructions, plan suggestions, reflection summary, and experiments', () => {
    const workflow = buildAiCoachWorkflow({ orgId: 'org-1', ownerId: 'user-1', plan, dailyCheckIns: [daily], weeklyReviews: [weekly] })

    expect(workflow.safetyBoundary.escalate).toBe(false)
    expect(workflow.promptGuardrails.system).toContain('not a medical, mental-health, legal, or crisis professional')
    expect(workflow.promptGuardrails.mustNot).toEqual(expect.arrayContaining([
      'diagnose medical or mental-health conditions',
      'recommend medication, supplements, dosage, or treatment plans',
      'encourage overwork, shame, punishment, or all-or-nothing commitments',
    ]))
    expect(workflow.planSuggestions[0]).toMatchObject({
      type: 'shrink',
      reason: expect.stringContaining('low energy'),
    })
    expect(workflow.reflectionSummary).toContain('Wins: Protected maker block; Two maker blocks')
    expect(workflow.obstacleDiagnosis.primaryObstacle).toBe('meetings start too early')
    expect(workflow.experimentRecommendations[0]).toMatchObject({
      hypothesis: expect.stringContaining('If'),
      successMetric: expect.any(String),
      reviewAfterDays: 7,
    })
  })

  it('switches to crisis-safe boundaries instead of normal coaching for self-harm language', () => {
    const safety = detectSafetyBoundary('I might hurt myself and I do not feel safe tonight')

    expect(safety).toMatchObject({
      level: 'crisis',
      escalate: true,
      responseMode: 'crisis-support',
    })
    expect(safety.message).toContain('emergency services')
    expect(safety.allowedCoachActions).toEqual([
      'acknowledge distress',
      'encourage immediate local emergency/support contact',
      'pause productivity coaching',
      'suggest staying with or contacting a trusted person',
    ])
  })

  it('scans reflection context for crisis language and pauses all productivity outputs', () => {
    const crisisDaily = {
      ...daily,
      blockers: ['I might hurt myself tonight'],
    }
    const workflow = buildAiCoachWorkflow({
      orgId: 'org-1',
      ownerId: 'user-1',
      plan,
      dailyCheckIns: [crisisDaily],
      weeklyReviews: [weekly],
      userMessage: 'What should I do next?',
    })

    expect(workflow.safetyBoundary).toMatchObject({ level: 'crisis', responseMode: 'crisis-support' })
    expect(workflow.planSuggestions).toEqual([])
    expect(workflow.experimentRecommendations).toEqual([])
    expect(workflow.context.experimentBacklog).toEqual([])
    expect(workflow.context.identityDirection).toBe('Safety support takes priority over productivity coaching.')
    expect(workflow.promptGuardrails.outputShape).toEqual(['crisis safety note', 'immediate support option', 'trusted-person reminder'])
  })

  it('sets medical and mental-health safety boundaries without diagnosing or prescribing', () => {
    expect(detectSafetyBoundary('Should I change my antidepressant dose?')).toMatchObject({
      level: 'medical',
      escalate: true,
      responseMode: 'refer-to-professional',
    })
    expect(detectSafetyBoundary('I feel depressed and I think I have ADHD')).toMatchObject({
      level: 'mental-health',
      escalate: true,
      responseMode: 'support-with-referral',
    })

    const medicalWorkflow = buildAiCoachWorkflow({
      orgId: 'org-1',
      ownerId: 'user-1',
      plan,
      dailyCheckIns: [daily],
      weeklyReviews: [weekly],
      userMessage: 'Should I change my antidepressant dose?',
    })

    expect(medicalWorkflow.planSuggestions).toEqual([])
    expect(medicalWorkflow.experimentRecommendations).toEqual([])
    expect(medicalWorkflow.promptGuardrails.outputShape).toEqual([
      'safety note',
      'professional-support referral',
      'one non-clinical supportive next step',
    ])
  })
})
