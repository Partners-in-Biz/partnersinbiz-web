'use client'

import { useMemo, useState } from 'react'
import {
  archivePlanningItem,
  buildGoalBreakdown,
  markDailyActionMissed,
  reorderPlanningItems,
  updatePlanningItemTitle,
  type GoalBreakdownPlan,
} from '@/lib/self-improvement/planning'
import {
  buildDailyCheckIn,
  buildWeeklyReview,
  summarizeReflectionInsights,
} from '@/lib/self-improvement/reflections'

const starterPlan = {
  id: 'vision-founder-life-os',
  title: 'Become a stronger, healthier, more focused founder',
  horizon: '3 years',
  domains: ['Health', 'Work', 'Learning', 'Relationships'],
  quarterlyOutcomes: [
    {
      id: 'quarter-operating-rhythm',
      title: 'Build an evidence-led weekly operating rhythm',
      targetMetric: '10 high-quality review weeks completed this quarter',
      weeklyCommitments: [
        {
          id: 'week-maker-rhythm',
          title: 'Protect maker mornings and weekly review',
          cadence: 'weekly',
          dailyActions: [
            {
              id: 'action-deep-work',
              title: 'Protect 90 minutes for deep work',
              date: '2026-06-15',
              status: 'done' as const,
            },
            {
              id: 'action-review-blockers',
              title: 'Review blocked decisions before noon',
              date: '2026-06-16',
              status: 'done' as const,
            },
            {
              id: 'action-close-loop',
              title: 'Close one open loop and record evidence',
              date: '2026-06-17',
              status: 'planned' as const,
            },
          ],
        },
      ],
    },
  ],
}

export function LifeOsPlanningWorkbench() {
  const [plan, setPlan] = useState<GoalBreakdownPlan>(() => buildGoalBreakdown(starterPlan))
  const [isEditingQuarter, setIsEditingQuarter] = useState(false)
  const [quarterTitle, setQuarterTitle] = useState(starterPlan.quarterlyOutcomes[0].title)

  const quarter = plan.quarterlyOutcomes[0]
  const progressLabel = useMemo(
    () => `${Math.round(plan.reviewProgress.completionRate * 100)}% complete`,
    [plan.reviewProgress.completionRate],
  )
  const dailyCheckIn = useMemo(() => buildDailyCheckIn({
    orgId: 'pib-platform-owner',
    ownerId: 'demo-user',
    localDate: '2026-06-17',
    wins: ['Protected a deep-work block', 'Closed one open loop with evidence'],
    misses: ['Evening walk slipped'],
    lessons: ['Reviewing blockers before noon protects the day'],
    energy: 3,
    mood: 4,
    blockers: ['context switching'],
    priorities: ['finish the review flow'],
    nextExperiments: ['move the walk to a morning cue'],
  }, '2026-06-17T08:00:00.000Z'), [])
  const weeklyReview = useMemo(() => buildWeeklyReview({
    orgId: 'pib-platform-owner',
    ownerId: 'demo-user',
    weekStart: '2026-06-15',
    weekEnd: '2026-06-21',
    wins: ['Two protected maker blocks'],
    misses: ['Recovery habit was too late in the day'],
    lessons: ['Morning cues survive client escalations better than evening plans'],
    energy: 4,
    mood: 4,
    blockers: ['late-day fatigue'],
    priorities: ['keep maker mornings', 'restart recovery habit'],
    nextExperiments: ['ten-minute recovery habit before the first meeting'],
  }, '2026-06-21T17:00:00.000Z'), [])
  const insightSummary = useMemo(() => summarizeReflectionInsights([dailyCheckIn], [weeklyReview]), [dailyCheckIn, weeklyReview])

  function saveQuarterTitle() {
    setPlan((current) => updatePlanningItemTitle(current, 'quarterlyOutcome', quarter.id, quarterTitle))
    setIsEditingQuarter(false)
  }

  function archiveQuarter() {
    setPlan((current) => archivePlanningItem(current, 'quarterlyOutcome', quarter.id))
  }

  function moveFirstActionDown() {
    const orderedIds = plan.dailyActions.map((action) => action.id)
    if (orderedIds.length < 2) return

    const nextOrder = [orderedIds[1], orderedIds[0], ...orderedIds.slice(2)]
    setPlan((current) => reorderPlanningItems(current, 'dailyAction', nextOrder))
  }

  function markMissed() {
    setPlan((current) =>
      markDailyActionMissed(current, 'action-close-loop', {
        reason: 'The day changed; choose recovery without guilt.',
        recoveryDate: '2026-06-18',
      }),
    )
  }

  return (
    <section className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Life OS</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Life OS planning engine</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Break long-term direction into quarterly outcomes, weekly commitments, daily actions, and reviewable evidence without turning missed days into shame.
          </p>
        </div>
        <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Reviewable progress</p>
          <p className="text-2xl font-semibold text-emerald-950">{progressLabel}</p>
          <p className="text-xs text-emerald-800">
            {plan.reviewProgress.completedActions}/{plan.reviewProgress.totalActions} daily actions complete
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Long-term vision</p>
          <h2 className="mt-2 text-lg font-semibold text-slate-950">{plan.vision.title}</h2>
          <p className="mt-2 text-sm text-slate-600">Horizon: {plan.vision.horizon}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {plan.vision.domains.map((domain) => (
              <span key={domain} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                {domain}
              </span>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quarterly outcomes</p>
            <StatePill state={quarter.state} />
          </div>
          {isEditingQuarter ? (
            <div className="mt-3 space-y-3">
              <label className="block text-sm font-medium text-slate-700" htmlFor="quarter-title">
                Quarterly outcome title
              </label>
              <input
                id="quarter-title"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                value={quarterTitle}
                onChange={(event) => setQuarterTitle(event.target.value)}
              />
              <button className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white" onClick={saveQuarterTitle}>
                Save quarterly outcome
              </button>
            </div>
          ) : (
            <>
              <h2 className="mt-2 text-lg font-semibold text-slate-950">{quarter.title}</h2>
              <p className="mt-2 text-sm text-slate-600">{quarter.targetMetric}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="rounded-full border border-slate-300 px-3 py-1.5 text-sm" onClick={() => setIsEditingQuarter(true)}>
                  Edit quarterly outcome
                </button>
                <button className="rounded-full border border-rose-200 px-3 py-1.5 text-sm text-rose-700" onClick={archiveQuarter}>
                  Archive quarterly outcome
                </button>
              </div>
            </>
          )}
        </article>

        <article className="rounded-2xl border border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Weekly commitments</p>
          {plan.weeklyCommitments.map((commitment) => (
            <div key={commitment.id} className="mt-3 rounded-xl bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold text-slate-950">{commitment.title}</h2>
                <StatePill state={commitment.state} />
              </div>
              <p className="mt-1 text-sm text-slate-600">Cadence: {commitment.cadence}</p>
            </div>
          ))}
        </article>

        <article className="rounded-2xl border border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Daily actions</p>
            <button className="rounded-full border border-slate-300 px-3 py-1 text-xs" onClick={moveFirstActionDown}>
              Move action down
            </button>
          </div>
          <ul className="mt-3 space-y-3" data-testid="daily-actions">
            {plan.dailyActions.map((action) => (
              <li key={action.id} className="rounded-xl bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-slate-950">{action.title}</span>
                  <StatePill state={action.state} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {action.date} · {action.status}
                </p>
                {action.recovery ? (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                    <p className="font-semibold">Recovery options</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {action.recovery.options.map((option) => (
                        <span key={option.action} className="rounded-lg bg-white px-2 py-1">
                          {option.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <button className="mt-4 rounded-full bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-950" onClick={markMissed}>
            Missed action recovery
          </button>
        </article>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ReflectionCard
          title="Daily check-in"
          eyebrow="Today capture"
          items={[
            `Wins: ${dailyCheckIn.wins.join('; ')}`,
            `Misses: ${dailyCheckIn.misses.join('; ')}`,
            `Lessons: ${dailyCheckIn.lessons.join('; ')}`,
            `Energy ${dailyCheckIn.energy}/5 · Mood ${dailyCheckIn.mood}/5`,
            `Blockers: ${dailyCheckIn.blockers.join('; ')}`,
            `Priorities: ${dailyCheckIn.priorities.join('; ')}`,
            `Next experiments: ${dailyCheckIn.nextExperiments.join('; ')}`,
          ]}
        />
        <ReflectionCard
          title="Weekly review"
          eyebrow="Review ritual"
          items={[
            weeklyReview.summary,
            `Wins: ${weeklyReview.wins.join('; ')}`,
            `Misses: ${weeklyReview.misses.join('; ')}`,
            `Lessons: ${weeklyReview.lessons.join('; ')}`,
            `Blockers: ${weeklyReview.blockers.join('; ')}`,
            `Next experiments: ${weeklyReview.nextExperiments.join('; ')}`,
          ]}
        />
        <article className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">AI coach context</p>
          <h2 className="mt-2 text-lg font-semibold text-indigo-950">{dailyCheckIn.coachContext.emotionalTone}</h2>
          <p className="mt-2 text-sm leading-6 text-indigo-950">{dailyCheckIn.coachContext.nextCoachPrompt}</p>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-indigo-700">Insights dashboard signals</p>
          <p className="mt-2 text-sm text-indigo-950">
            {insightSummary.totalWins} wins · {insightSummary.totalMisses} misses · {insightSummary.totalLessons} lessons · {insightSummary.totalBlockers} blockers · energy {insightSummary.averageEnergy}/5 · mood {insightSummary.averageMood}/5
          </p>
          <p className="mt-2 text-sm text-indigo-950">Active experiments: {insightSummary.activeExperiments.join('; ')}</p>
        </article>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Reviewable progress</p>
        <p className="mt-2 text-sm leading-6 text-slate-200">{plan.reviewProgress.nextReviewPrompt}</p>
        {plan.reviewProgress.recoveryQueue.length > 0 ? (
          <p className="mt-2 text-sm text-amber-200">Recovery queue: {plan.reviewProgress.recoveryQueue.join(', ')}</p>
        ) : null}
      </div>
    </section>
  )
}

function ReflectionCard({ title, eyebrow, items }: { title: string; eyebrow: string; items: string[] }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{eyebrow}</p>
      <h2 className="mt-2 text-lg font-semibold text-slate-950">{title}</h2>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  )
}

function StatePill({ state }: { state: string }) {
  const label = state.charAt(0).toUpperCase() + state.slice(1)

  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
      {label}
    </span>
  )
}
