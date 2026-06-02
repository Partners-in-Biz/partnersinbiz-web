const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

import { getSequenceStats } from '@/lib/email-analytics/aggregate'

function ts(ms: number) {
  return { toMillis: () => ms }
}

function doc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data }
}

function query(docs: Array<{ id: string; data: () => Record<string, unknown> }>) {
  return {
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs }),
  }
}

describe('getSequenceStats', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    mockCollection.mockImplementation((name: string) => {
      if (name === 'sequences') {
        return {
          doc: (id: string) => ({
            get: jest.fn().mockResolvedValue({
              exists: id === 'seq-1',
              id,
              data: () => ({
                orgId: 'org-1',
                name: 'Website welcome sequence',
                description: 'Turns new website leads into booked calls.',
                status: 'active',
                deleted: false,
                steps: [
                  { stepNumber: 1, subject: 'Welcome to the growth engine' },
                  { stepNumber: 2, subject: 'Book your growth review' },
                ],
              }),
            }),
          }),
        }
      }
      if (name === 'sequence_enrollments') {
        return query([
          doc('enr-1', {
            orgId: 'org-1',
            sequenceId: 'seq-1',
            status: 'completed',
            enrolledAt: ts(Date.UTC(2026, 4, 1)),
            completedAt: ts(Date.UTC(2026, 4, 7)),
          }),
          doc('enr-2', { orgId: 'org-1', sequenceId: 'seq-1', status: 'active' }),
          doc('enr-3', { orgId: 'org-1', sequenceId: 'seq-1', status: 'active' }),
          doc('enr-4', { orgId: 'org-1', sequenceId: 'seq-1', status: 'active' }),
        ])
      }
      if (name === 'emails') {
        return query([
          doc('email-1', { sequenceId: 'seq-1', sequenceStep: 0, status: 'clicked', clickedAt: ts(1), openedAt: ts(1) }),
          doc('email-2', { sequenceId: 'seq-1', sequenceStep: 0, status: 'opened', openedAt: ts(1) }),
          doc('email-3', { sequenceId: 'seq-1', sequenceStep: 0, status: 'sent' }),
          doc('email-4', { sequenceId: 'seq-1', sequenceStep: 0, status: 'sent' }),
          doc('email-5', { sequenceId: 'seq-1', sequenceStep: 1, status: 'opened', openedAt: ts(1) }),
        ])
      }
      return { doc: jest.fn(), where: jest.fn().mockReturnThis(), get: jest.fn() }
    })
  })

  it('returns sequence identity and agent-ready next actions with the funnel metrics', async () => {
    const stats = await getSequenceStats('org-1', 'seq-1')

    expect(stats.sequence).toEqual({
      id: 'seq-1',
      name: 'Website welcome sequence',
      description: 'Turns new website leads into booked calls.',
      status: 'active',
      stepsCount: 2,
    })
    expect(stats.insights).toEqual(expect.objectContaining({
      completionRate: 0.25,
      openRate: 0.6,
      clickRate: 0.2,
      weakestStepNumber: 2,
    }))
    expect(stats.insights.nextActions).toEqual(expect.arrayContaining([
      expect.stringMatching(/Step 2/i),
    ]))
  })
})
