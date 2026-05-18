// __tests__/lib/scoring/compute.test.ts
//
// Tests for lib/scoring/compute.ts — the scoring orchestrator.
// All external dependencies are mocked.

// ---------------------------------------------------------------------------
// Mock setup (must precede imports)
// ---------------------------------------------------------------------------

const mockContactGet = jest.fn()
const mockContactUpdate = jest.fn()
const mockContactDocFn = jest.fn()
const mockCompanyGet = jest.fn()
const mockCompanyDocFn = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: jest.fn(() => ({ seconds: 1_700_000_000, nanoseconds: 0 })),
  },
  FieldValue: {
    delete: jest.fn(() => '__DELETE__'),
  },
}))

const mockComputeLeadScore = jest.fn()
jest.mock('@/lib/scoring/leadScore', () => ({
  computeLeadScore: (...args: unknown[]) => mockComputeLeadScore(...args),
}))

const mockComputeIcpScore = jest.fn()
jest.mock('@/lib/scoring/icpScore', () => ({
  computeIcpScore: (...args: unknown[]) => mockComputeIcpScore(...args),
}))

const mockComputeAiLeadScore = jest.fn()
jest.mock('@/lib/scoring/aiLeadScore', () => ({
  computeAiLeadScore: (...args: unknown[]) => mockComputeAiLeadScore(...args),
}))

const mockGetOrBootstrapConfig = jest.fn()
jest.mock('@/lib/scoring/store', () => ({
  getOrBootstrapConfig: (...args: unknown[]) => mockGetOrBootstrapConfig(...args),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { computeScoresForContact } from '@/lib/scoring/compute'
import type { ScoringConfig } from '@/lib/scoring/types'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTOR: MemberRef = { uid: 'user-1', displayName: 'Admin', kind: 'human' }

function makeConfig(overrides: Partial<ScoringConfig> = {}): ScoringConfig {
  return {
    orgId: 'org-a',
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

function makeContactData(overrides = {}) {
  return {
    orgId: 'org-a',
    capturedFromId: '',
    name: 'Alice',
    email: 'alice@example.com',
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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks()

  // Default Firestore collection routing
  mockCollection.mockImplementation((coll: string) => {
    if (coll === 'contacts') return { doc: mockContactDocFn }
    if (coll === 'companies') return { doc: mockCompanyDocFn }
    return { doc: jest.fn() }
  })

  // Default contact doc
  mockContactDocFn.mockReturnValue({
    get: mockContactGet,
    update: mockContactUpdate,
  })
  mockContactUpdate.mockResolvedValue(undefined)

  // Default company doc
  mockCompanyDocFn.mockReturnValue({ get: mockCompanyGet })

  // Default scorer mocks
  mockComputeLeadScore.mockResolvedValue({ score: 60, signals: { emailOpens: 10 } })
  mockComputeIcpScore.mockReturnValue({ score: 75, signals: { industry: 25, size: 25 } })
  mockComputeAiLeadScore.mockResolvedValue({ score: 80, rationale: 'Good prospect.' })
  mockGetOrBootstrapConfig.mockResolvedValue(makeConfig())
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeScoresForContact', () => {
  describe('happy path — persists all 3 scores', () => {
    it('returns ScoreUpdate with all scores and writes to contact', async () => {
      mockContactGet.mockResolvedValue({
        exists: true,
        id: 'contact-1',
        data: () => makeContactData(),
      })
      mockCompanyGet.mockResolvedValue({ exists: false })

      const result = await computeScoresForContact('org-a', 'contact-1', {
        includeAi: true,
        actor: ACTOR,
      })

      expect(result).not.toBeNull()
      expect(result!.leadScore).toBe(60)
      expect(result!.icpScore).toBe(75)
      expect(result!.aiLeadScore).toBe(80)
      expect(result!.aiRationale).toBe('Good prospect.')
      expect(result!.scoreSignals).toMatchObject({
        lead_emailOpens: 10,
        icp_industry: 25,
      })

      expect(mockContactUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          leadScore: 60,
          icpScore: 75,
          aiLeadScore: 80,
          updatedBy: 'user-1',
          updatedByRef: ACTOR,
        }),
      )
    })
  })

  describe('contact missing — returns null', () => {
    it('returns null when contact does not exist', async () => {
      mockContactGet.mockResolvedValue({ exists: false })

      const result = await computeScoresForContact('org-a', 'ghost-contact', {
        includeAi: false,
        actor: ACTOR,
      })

      expect(result).toBeNull()
      expect(mockContactUpdate).not.toHaveBeenCalled()
    })
  })

  describe('cross-tenant — returns null', () => {
    it('returns null when contact.orgId does not match requested orgId', async () => {
      mockContactGet.mockResolvedValue({
        exists: true,
        id: 'contact-x',
        data: () => makeContactData({ orgId: 'org-other' }),
      })

      const result = await computeScoresForContact('org-a', 'contact-x', {
        includeAi: false,
        actor: ACTOR,
      })

      expect(result).toBeNull()
    })
  })

  describe('AI disabled — writes 2 scores only', () => {
    it('does not call aiLeadScore when config.aiEnabled is false', async () => {
      mockGetOrBootstrapConfig.mockResolvedValue(makeConfig({ aiEnabled: false }))
      mockContactGet.mockResolvedValue({
        exists: true,
        id: 'contact-1',
        data: () => makeContactData(),
      })

      const result = await computeScoresForContact('org-a', 'contact-1', {
        includeAi: true,
        actor: ACTOR,
      })

      expect(result).not.toBeNull()
      expect(result!.aiLeadScore).toBeUndefined()
      expect(mockComputeAiLeadScore).not.toHaveBeenCalled()
      expect(mockContactUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ leadScore: 60, icpScore: 75 }),
      )
    })
  })

  describe('AI failure — clears stale aiLeadScore via FieldValue.delete', () => {
    it('writes FieldValue.delete() for aiLeadScore when AI was requested but failed', async () => {
      mockContactGet.mockResolvedValue({
        exists: true,
        id: 'contact-1',
        data: () => makeContactData(),
      })
      mockComputeAiLeadScore.mockResolvedValue(null) // AI returned null

      const result = await computeScoresForContact('org-a', 'contact-1', {
        includeAi: true,
        actor: ACTOR,
      })

      expect(result).not.toBeNull()
      expect(result!.aiLeadScore).toBeUndefined()
      expect(mockContactUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ aiLeadScore: '__DELETE__' }),
      )
    })
  })

  describe('signals merged with prefix', () => {
    it('prefixes lead_ and icp_ on signals to avoid collisions', async () => {
      mockContactGet.mockResolvedValue({
        exists: true,
        id: 'contact-1',
        data: () => makeContactData(),
      })
      mockComputeLeadScore.mockResolvedValue({
        score: 40,
        signals: { recentContact: 10, emailClicks: 5 },
      })
      mockComputeIcpScore.mockReturnValue({
        score: 50,
        signals: { industry: 25, size: 0 },
      })

      const result = await computeScoresForContact('org-a', 'contact-1', {
        includeAi: false,
        actor: ACTOR,
      })

      expect(result!.scoreSignals).toEqual({
        lead_recentContact: 10,
        lead_emailClicks: 5,
        icp_industry: 25,
        icp_size: 0,
      })
    })
  })

  describe('formula failures do not block AI', () => {
    it('uses score 0 for lead if formula throws, still calls AI', async () => {
      mockContactGet.mockResolvedValue({
        exists: true,
        id: 'contact-1',
        data: () => makeContactData(),
      })
      mockComputeLeadScore.mockRejectedValue(new Error('Email query failed'))

      const result = await computeScoresForContact('org-a', 'contact-1', {
        includeAi: true,
        actor: ACTOR,
      })

      expect(result).not.toBeNull()
      expect(result!.leadScore).toBe(0)
      expect(mockComputeAiLeadScore).toHaveBeenCalled()
      expect(result!.aiLeadScore).toBe(80)
    })
  })

  describe('actor attribution', () => {
    it('writes updatedBy + updatedByRef from opts.actor', async () => {
      mockContactGet.mockResolvedValue({
        exists: true,
        id: 'contact-1',
        data: () => makeContactData(),
      })
      const agentActor: MemberRef = { uid: 'pip-agent', displayName: 'Pip', kind: 'agent' }

      await computeScoresForContact('org-a', 'contact-1', {
        includeAi: false,
        actor: agentActor,
      })

      expect(mockContactUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          updatedBy: 'pip-agent',
          updatedByRef: agentActor,
        }),
      )
    })
  })

  describe('company lookup — linked company enriches AI context', () => {
    it('loads company when contact.companyId is set and passes it to AI', async () => {
      mockContactGet.mockResolvedValue({
        exists: true,
        id: 'contact-1',
        data: () => makeContactData({ companyId: 'co-1' }),
      })
      mockCompanyGet.mockResolvedValue({
        exists: true,
        id: 'co-1',
        data: () => ({ orgId: 'org-a', name: 'ACME Corp', industry: 'SaaS', size: 'smb', tier: 'gold', tags: [], notes: '' }),
      })

      await computeScoresForContact('org-a', 'contact-1', { includeAi: true, actor: ACTOR })

      const aiCall = mockComputeAiLeadScore.mock.calls[0][0]
      expect(aiCall.company).toMatchObject({ name: 'ACME Corp', industry: 'SaaS' })
    })
  })

  describe('company cross-tenant — ignored', () => {
    it('treats company as null when company.orgId differs', async () => {
      mockContactGet.mockResolvedValue({
        exists: true,
        id: 'contact-1',
        data: () => makeContactData({ companyId: 'co-x' }),
      })
      mockCompanyGet.mockResolvedValue({
        exists: true,
        data: () => ({ orgId: 'org-other', name: 'Evil Corp' }),
      })

      const result = await computeScoresForContact('org-a', 'contact-1', {
        includeAi: false,
        actor: ACTOR,
      })

      // Should still succeed — company is just null
      expect(result).not.toBeNull()
      const icpCall = mockComputeIcpScore.mock.calls[0]
      expect(icpCall[1]).toBeNull() // company arg is null
    })
  })

  describe('includeAi false — AI not called even when config.aiEnabled true', () => {
    it('skips AI call when opts.includeAi is false', async () => {
      mockContactGet.mockResolvedValue({
        exists: true,
        id: 'contact-1',
        data: () => makeContactData(),
      })

      await computeScoresForContact('org-a', 'contact-1', { includeAi: false, actor: ACTOR })

      expect(mockComputeAiLeadScore).not.toHaveBeenCalled()
    })
  })
})
