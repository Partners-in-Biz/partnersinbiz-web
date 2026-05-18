// __tests__/lib/scoring/leadScore.test.ts

import { Timestamp } from 'firebase-admin/firestore'
import { computeLeadScore } from '@/lib/scoring/leadScore'
import type { Contact } from '@/lib/crm/types'
import type { LeadSignalsWeights } from '@/lib/scoring/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDb(overrides: {
  emails?: object[]
  inboundEmails?: object[]
  sequenceEnrollments?: object[]
  formSubmissions?: object[]
}) {
  function snap(docs: object[]) {
    return Promise.resolve({ docs: docs.map((d) => ({ data: () => d })), size: docs.length })
  }

  const emailsSnap = snap(overrides.emails ?? [])
  const inboundSnap = snap(overrides.inboundEmails ?? [])
  const seqSnap = snap(overrides.sequenceEnrollments ?? [])
  const formsSnap = snap(overrides.formSubmissions ?? [])

  // Mock chain: .collection().where().where().get() → we return the snap.
  // Chain-mock: every call to where() returns the same object so we can chain.
  function makeQuery(resolvedSnap: Promise<object>) {
    const q: Record<string, unknown> = {}
    q.where = () => q
    q.get = () => resolvedSnap
    return q
  }

  return {
    collection: (name: string) => {
      if (name === 'emails') return makeQuery(emailsSnap)
      if (name === 'inbound_emails') return makeQuery(inboundSnap)
      if (name === 'sequence_enrollments') return makeQuery(seqSnap)
      if (name === 'form_submissions') return makeQuery(formsSnap)
      return makeQuery(Promise.resolve({ docs: [], size: 0 }))
    },
  }
}

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'contact-1',
    orgId: 'org-1',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    tags: [],
    lastContactedAt: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  } as unknown as Contact
}

const DEFAULT_WEIGHTS: LeadSignalsWeights = {
  emailOpens: 2,
  emailClicks: 5,
  emailReplies: 15,
  sequenceCompleted: 10,
  recentContact: 10,
  formSubmission: 8,
}

const recentTs = Timestamp.fromMillis(Date.now() - 1000 * 60 * 60) // 1h ago

// ── Tests ────────────────────────────────────────────────────────────────────

describe('computeLeadScore', () => {
  it('returns score 0 and all-zero signals when no engagement', async () => {
    const db = makeDb({})
    const result = await computeLeadScore(makeContact(), DEFAULT_WEIGHTS, { adminDb: db as any })
    expect(result.score).toBe(0)
    expect(result.signals.opens).toBe(0)
    expect(result.signals.clicks).toBe(0)
    expect(result.signals.replies).toBe(0)
    expect(result.signals.sequenceCompleted).toBe(0)
    expect(result.signals.recentContact).toBe(0)
    expect(result.signals.formSubmissions).toBe(0)
  })

  it('applies emailOpens weight correctly', async () => {
    const db = makeDb({
      emails: [{ status: 'opened', openedAt: recentTs, sentAt: recentTs }],
    })
    const result = await computeLeadScore(makeContact(), { emailOpens: 4 }, { adminDb: db as any })
    expect(result.signals.opens).toBe(1)
    expect(result.score).toBe(4)
  })

  it('applies emailClicks weight correctly', async () => {
    const db = makeDb({
      emails: [{ status: 'clicked', clickedAt: recentTs, openedAt: recentTs, sentAt: recentTs }],
    })
    const result = await computeLeadScore(makeContact(), { emailClicks: 7 }, { adminDb: db as any })
    expect(result.signals.clicks).toBe(1)
    // Also counts as opened
    expect(result.signals.opens).toBe(1)
    expect(result.score).toBe(7 + (DEFAULT_WEIGHTS.emailOpens ?? 2)) // click + open using defaults for opens
  })

  it('applies emailReplies weight from inbound_emails collection', async () => {
    const db = makeDb({ inboundEmails: [{ intent: 'reply', receivedAt: recentTs }] })
    const result = await computeLeadScore(makeContact(), { emailReplies: 20 }, { adminDb: db as any })
    expect(result.signals.replies).toBe(1)
    expect(result.score).toBe(20)
  })

  it('applies sequenceCompleted weight', async () => {
    const db = makeDb({ sequenceEnrollments: [{ status: 'completed', completedAt: recentTs }] })
    const result = await computeLeadScore(makeContact(), { sequenceCompleted: 10 }, { adminDb: db as any })
    expect(result.signals.sequenceCompleted).toBe(1)
    expect(result.score).toBe(10)
  })

  it('applies formSubmission weight', async () => {
    const db = makeDb({ formSubmissions: [{ submittedAt: recentTs }, { submittedAt: recentTs }] })
    const result = await computeLeadScore(makeContact(), { formSubmission: 8 }, { adminDb: db as any })
    expect(result.signals.formSubmissions).toBe(2)
    expect(result.score).toBe(16)
  })

  it('awards recentContact when lastContactedAt is within 7d', async () => {
    const sevenDaysAgoMs = Date.now() - 6 * 24 * 60 * 60 * 1000
    const lastContactedAt = Timestamp.fromMillis(sevenDaysAgoMs)
    const db = makeDb({})
    const result = await computeLeadScore(
      makeContact({ lastContactedAt }),
      { recentContact: 10 },
      { adminDb: db as any },
    )
    expect(result.signals.recentContact).toBe(10)
    expect(result.score).toBe(10)
  })

  it('does NOT award recentContact when lastContactedAt is older than 7d', async () => {
    const eightDaysAgoMs = Date.now() - 8 * 24 * 60 * 60 * 1000
    const lastContactedAt = Timestamp.fromMillis(eightDaysAgoMs)
    const db = makeDb({})
    const result = await computeLeadScore(
      makeContact({ lastContactedAt }),
      { recentContact: 10 },
      { adminDb: db as any },
    )
    expect(result.signals.recentContact).toBe(0)
  })

  it('caps score at 100', async () => {
    // 10 opens × 20 pts each = 200 → capped at 100
    const db = makeDb({
      emails: Array.from({ length: 10 }, () => ({ status: 'opened', openedAt: recentTs, sentAt: recentTs })),
    })
    const result = await computeLeadScore(makeContact(), { emailOpens: 20 }, { adminDb: db as any })
    expect(result.score).toBe(100)
  })

  it('floors score at 0', async () => {
    const db = makeDb({})
    const result = await computeLeadScore(makeContact(), { emailOpens: -99 }, { adminDb: db as any })
    expect(result.score).toBe(0)
  })

  it('returns 0-signals and score 0 if Firestore queries throw', async () => {
    const failDb = {
      collection: () => ({
        where: () => ({ where: () => ({ where: () => ({ get: () => Promise.reject(new Error('Firestore down')) }) }) }),
        get: () => Promise.reject(new Error('Firestore down')),
      }),
    }
    const result = await computeLeadScore(makeContact(), DEFAULT_WEIGHTS, { adminDb: failDb as any })
    expect(result.score).toBe(0)
    expect(result.signals.opens).toBe(0)
    expect(result.signals.clicks).toBe(0)
  })
})
