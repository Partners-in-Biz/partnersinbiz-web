// __tests__/lib/scoring/aiLeadScore.test.ts
//
// Tests for lib/scoring/aiLeadScore.ts — mocks Firebase admin + ai SDK.

// ---------------------------------------------------------------------------
// Mock setup (must precede imports)
// ---------------------------------------------------------------------------

const mockGet = jest.fn()
const mockSet = jest.fn()
const mockDoc = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
  },
}))

const mockGenerateText = jest.fn()
jest.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { computeAiLeadScore } from '@/lib/scoring/aiLeadScore'
import type { AiScoreContext } from '@/lib/scoring/aiLeadScore'
import type { Contact } from '@/lib/crm/types'
import type { ScoringConfig } from '@/lib/scoring/types'
import { Timestamp } from 'firebase-admin/firestore'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<ScoringConfig> = {}): ScoringConfig {
  return {
    orgId: 'org-test',
    aiEnabled: true,
    aiCacheHours: 24,
    aiModel: 'anthropic/claude-haiku-4.5',
    icp: { industries: ['SaaS'], sizes: ['11-50'], tiers: [] },
    leadWeights: {
      emailOpens: 2,
      emailClicks: 5,
      emailReplies: 15,
      sequenceCompleted: 10,
      recentContact: 10,
      formSubmission: 8,
    },
    updatedAt: null,
    createdAt: null,
    ...overrides,
  }
}

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'contact-1',
    orgId: 'org-test',
    capturedFromId: '',
    name: 'Jane Doe',
    email: 'jane@acme.com',
    phone: '',
    company: 'Acme',
    website: '',
    source: 'manual',
    type: 'lead',
    stage: 'new',
    tags: [],
    notes: '',
    assignedTo: '',
    subscribedAt: null,
    unsubscribedAt: null,
    bouncedAt: null,
    createdAt: null,
    updatedAt: null,
    lastContactedAt: null,
    ...overrides,
  }
}

function makeFreshTimestamp(): Timestamp {
  // 1 minute ago — well within cache window
  return { toMillis: () => Date.now() - 60_000 } as Timestamp
}

function makeStaleTimestamp(): Timestamp {
  // 25 hours ago — past the 24 h cache window
  return { toMillis: () => Date.now() - 25 * 3_600_000 } as Timestamp
}

function makeDocRef(exists: boolean, data?: object) {
  return {
    get: mockGet.mockResolvedValue({ exists, data: () => data }),
    set: mockSet.mockResolvedValue(undefined),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks()
  const docRef = { get: mockGet, set: mockSet }
  mockDoc.mockReturnValue(docRef)
  mockCollection.mockReturnValue({ doc: mockDoc })
  mockSet.mockResolvedValue(undefined)
})

describe('computeAiLeadScore', () => {
  describe('cache hit — returns cached result without calling AI', () => {
    it('returns cached score when fresh', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          score: 72,
          rationale: 'Cached rationale.',
          computedAt: makeFreshTimestamp(),
        }),
      })

      const ctx: AiScoreContext = {
        contact: makeContact(),
        config: makeConfig(),
      }

      const result = await computeAiLeadScore(ctx)

      expect(result).toEqual({ score: 72, rationale: 'Cached rationale.' })
      expect(mockGenerateText).not.toHaveBeenCalled()
    })
  })

  describe('cache stale — recomputes and writes new result', () => {
    it('calls AI Gateway when cache is expired', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          score: 50,
          rationale: 'Old rationale.',
          computedAt: makeStaleTimestamp(),
        }),
      })
      mockGenerateText.mockResolvedValue({
        text: '{"score": 85, "rationale": "Fresh rationale."}',
      })

      const ctx: AiScoreContext = {
        contact: makeContact(),
        config: makeConfig(),
      }

      const result = await computeAiLeadScore(ctx)

      expect(result).toEqual({ score: 85, rationale: 'Fresh rationale.' })
      expect(mockGenerateText).toHaveBeenCalledTimes(1)
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ score: 85, rationale: 'Fresh rationale.' }),
      )
    })
  })

  describe('aiEnabled false — returns null immediately', () => {
    it('short-circuits without any Firestore or AI calls', async () => {
      const ctx: AiScoreContext = {
        contact: makeContact(),
        config: makeConfig({ aiEnabled: false }),
      }

      const result = await computeAiLeadScore(ctx)

      expect(result).toBeNull()
      expect(mockCollection).not.toHaveBeenCalled()
      expect(mockGenerateText).not.toHaveBeenCalled()
    })
  })

  describe('prompt construction smoke test', () => {
    it('includes contact info + ICP target in the prompt sent to AI', async () => {
      mockGet.mockResolvedValue({ exists: false })
      mockGenerateText.mockResolvedValue({
        text: '{"score": 60, "rationale": "Decent match."}',
      })

      const ctx: AiScoreContext = {
        contact: makeContact({ name: 'Bob Smith', email: 'bob@startup.io', notes: 'Interested in enterprise plan' }),
        config: makeConfig(),
        formulaLeadScore: 45,
        formulaIcpScore: 70,
        recentActivitySummary: 'Opened 3 emails this week',
      }

      await computeAiLeadScore(ctx)

      const callArg = mockGenerateText.mock.calls[0][0]
      expect(callArg.prompt).toContain('Bob Smith')
      expect(callArg.prompt).toContain('bob@startup.io')
      expect(callArg.prompt).toContain('ICP target')
      expect(callArg.prompt).toContain('Engagement score (formula): 45/100')
      expect(callArg.prompt).toContain('Opened 3 emails this week')
    })
  })

  describe('AI 4xx / network failure — returns null', () => {
    it('returns null when generateText throws', async () => {
      mockGet.mockResolvedValue({ exists: false })
      mockGenerateText.mockRejectedValue(new Error('503 Gateway Error'))

      const ctx: AiScoreContext = {
        contact: makeContact(),
        config: makeConfig(),
      }

      const result = await computeAiLeadScore(ctx)

      expect(result).toBeNull()
    })
  })

  describe('parses valid JSON in model response', () => {
    it('extracts score and rationale from JSON response', async () => {
      mockGet.mockResolvedValue({ exists: false })
      mockGenerateText.mockResolvedValue({
        text: '{"score": 55, "rationale": "Moderate lead."}',
      })

      const result = await computeAiLeadScore({
        contact: makeContact(),
        config: makeConfig(),
      })

      expect(result).toEqual({ score: 55, rationale: 'Moderate lead.' })
    })
  })

  describe('score clamping', () => {
    it('clamps score above 100 to 100', async () => {
      mockGet.mockResolvedValue({ exists: false })
      mockGenerateText.mockResolvedValue({ text: '{"score": 150, "rationale": "Too high."}' })

      const result = await computeAiLeadScore({ contact: makeContact(), config: makeConfig() })
      expect(result!.score).toBe(100)
    })

    it('clamps score below 0 to 0', async () => {
      mockGet.mockResolvedValue({ exists: false })
      mockGenerateText.mockResolvedValue({ text: '{"score": -20, "rationale": "Too low."}' })

      const result = await computeAiLeadScore({ contact: makeContact(), config: makeConfig() })
      expect(result!.score).toBe(0)
    })
  })

  describe('writes cache after fresh AI call', () => {
    it('persists score + rationale + computedAt to scoringCache', async () => {
      mockGet.mockResolvedValue({ exists: false })
      mockGenerateText.mockResolvedValue({ text: '{"score": 77, "rationale": "Good lead."}' })

      await computeAiLeadScore({ contact: makeContact(), config: makeConfig() })

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-test',
          contactId: 'contact-1',
          score: 77,
          rationale: 'Good lead.',
        }),
      )
    })
  })
})
