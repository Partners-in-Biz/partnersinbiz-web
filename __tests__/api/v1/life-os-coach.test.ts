import { NextRequest } from 'next/server'

const mockUser = { uid: 'user-1', role: 'client' as const, orgId: 'org-1' }
type MockAuthHandler = (req: NextRequest, user: typeof mockUser, ctx?: unknown) => unknown

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string | string[], handler: MockAuthHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

describe('Life OS AI coach API route', () => {
  it('creates an internal guarded coach workflow from provided plan and reflection context', async () => {
    const { POST } = await import('@/app/api/v1/life-os/coach/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/life-os/coach', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        userMessage: 'I missed my walk because meetings started too early. What should I do?',
        plan: {
          orgId: 'org-1',
          ownerId: 'user-1',
          vision: { id: 'vision-1', title: 'Become a calmer founder', horizon: '12 months', domains: ['Health'], state: 'active' },
          activeQuarterlyOutcomes: [{ id: 'outcome-1', title: 'Protect health', order: 0, state: 'active' }],
          activeWeeklyCommitments: [{ id: 'commitment-1', quarterlyOutcomeId: 'outcome-1', title: 'Morning recovery', cadence: 'weekday', order: 0, state: 'active' }],
          activeDailyActions: [
            { id: 'action-1', quarterlyOutcomeId: 'outcome-1', weeklyCommitmentId: 'commitment-1', title: 'Walk before calls', date: '2026-06-15', status: 'missed', order: 0, state: 'active' },
          ],
          reviewProgress: { totalActions: 1, completedActions: 0, missedActions: 1, completionRate: 0, recoveryQueue: [], nextReviewPrompt: 'Review recovery.' },
          quarterlyOutcomes: [],
          weeklyCommitments: [],
          dailyActions: [],
        },
        dailyCheckIns: [{
          id: 'daily-1', type: 'daily', orgId: 'org-1', ownerId: 'user-1', localDate: '2026-06-15', wins: ['Focused'], misses: ['Missed walk'], lessons: ['Do it before meetings'], energy: 2, mood: 3, blockers: ['meetings started too early'], priorities: ['recover energy'], nextExperiments: ['walk before opening Slack'], coachContext: { emotionalTone: 'low-energy', blockerThemes: [], priorityThemes: [], experimentThemes: [], nextCoachPrompt: '' }, dashboardSignals: { winCount: 1, missCount: 1, lessonCount: 1, blockerCount: 1, priorityCount: 1, experimentCount: 1, energyMoodAverage: 2.5 }, createdAt: '2026-06-15T08:00:00.000Z', updatedAt: '2026-06-15T08:00:00.000Z',
        }],
      }),
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({
      ownerId: 'user-1',
      workflow: expect.objectContaining({
        safetyBoundary: expect.objectContaining({ level: 'none' }),
        boundaryCopy: expect.objectContaining({
          role: expect.stringContaining('not therapy, medical care, crisis support, legal advice, or financial advice'),
          emergency: expect.stringContaining('contact local emergency services or a trusted person now'),
        }),
        obstacleDiagnosis: expect.objectContaining({ primaryObstacle: 'meetings started too early' }),
        promptGuardrails: expect.objectContaining({ mustNot: expect.arrayContaining(['diagnose medical or mental-health conditions']) }),
      }),
    })
  })

  it('fails closed when a portal user requests another owner subject', async () => {
    const { POST } = await import('@/app/api/v1/life-os/coach/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/life-os/coach', {
      method: 'POST',
      body: JSON.stringify({ orgId: 'org-1', ownerId: 'other-user', userMessage: 'Help me plan' }),
    }))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toContain('ownerId must match the authenticated user')
  })

  it('fails closed when submitted plan scope does not match the coaching subject', async () => {
    const { POST } = await import('@/app/api/v1/life-os/coach/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/life-os/coach', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        userMessage: 'Help me plan',
        plan: {
          orgId: 'org-1',
          ownerId: 'other-user',
          vision: { id: 'vision-1', title: 'Other person plan', horizon: '12 months', domains: [], state: 'active' },
          activeQuarterlyOutcomes: [],
          activeWeeklyCommitments: [],
          activeDailyActions: [],
          reviewProgress: { totalActions: 0, completedActions: 0, missedActions: 0, completionRate: 0, recoveryQueue: [], nextReviewPrompt: 'Review.' },
          quarterlyOutcomes: [],
          weeklyCommitments: [],
          dailyActions: [],
        },
      }),
    }))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toContain('plan orgId and ownerId must match')
  })

  it('returns crisis safety mode instead of normal productivity coaching', async () => {
    const { POST } = await import('@/app/api/v1/life-os/coach/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/life-os/coach', {
      method: 'POST',
      body: JSON.stringify({ orgId: 'org-1', userMessage: 'I might hurt myself tonight' }),
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.workflow.safetyBoundary).toMatchObject({
      level: 'crisis',
      escalate: true,
      responseMode: 'crisis-support',
    })
    expect(body.data.workflow.planSuggestions).toHaveLength(0)
    expect(body.data.workflow.experimentRecommendations).toHaveLength(0)
  })
})
