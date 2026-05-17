// __tests__/lib/companies/migration.test.ts
// Pure unit tests for normalizeCompanyKey, groupContactsByCompanyKey, and applyMigration

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn(),
    batch: jest.fn(),
  },
}))

import { normalizeCompanyKey, groupContactsByCompanyKey, applyMigration } from '@/lib/companies/migration'
import { adminDb } from '@/lib/firebase/admin'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

const testActor: MemberRef = { uid: 'uid_actor_1', displayName: 'Test Actor', kind: 'human' }

beforeEach(() => jest.clearAllMocks())

// ─── normalizeCompanyKey ───────────────────────────────────────────────────

describe('normalizeCompanyKey', () => {
  it('lowercases + trims + collapses internal whitespace', () => {
    expect(normalizeCompanyKey('  ACME   Corp  ')).toBe('acme corp')
  })

  it('NFC normalizes unicode — decomposed café becomes café', () => {
    // 'Café' with combining acute accent (decomposed NFD form)
    const decomposed = 'Café'
    expect(normalizeCompanyKey(decomposed)).toBe('café')
  })

  it('returns empty string for empty input', () => {
    expect(normalizeCompanyKey('')).toBe('')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeCompanyKey('   ')).toBe('')
  })

  it('returns empty string for null', () => {
    expect(normalizeCompanyKey(null as unknown as string)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(normalizeCompanyKey(undefined as unknown as string)).toBe('')
  })

  it('preserves inner words after collapse', () => {
    expect(normalizeCompanyKey('Globex   Corporation')).toBe('globex corporation')
  })
})

// ─── groupContactsByCompanyKey ─────────────────────────────────────────────

describe('groupContactsByCompanyKey', () => {
  it('groups contacts by normalized key, picks most common raw value as suggestion', () => {
    const contacts = [
      { id: 'c1', company: 'ACME Corp', companyId: undefined },
      { id: 'c2', company: 'Acme Corp', companyId: undefined },
      { id: 'c3', company: 'ACME Corp', companyId: undefined }, // most common
      { id: 'c4', company: 'Globex', companyId: undefined },
      { id: 'c5', company: '', companyId: undefined },           // empty → skipped
    ]
    const groups = groupContactsByCompanyKey(contacts as never)
    expect(groups).toHaveLength(2)  // acme corp + globex; empty skipped
    const acme = groups.find(g => g.normalizedKey === 'acme corp')!
    expect(acme).toBeDefined()
    expect(acme.contactIds).toEqual(['c1', 'c2', 'c3'])
    expect(acme.suggestedCompanyName).toBe('ACME Corp')  // 2 occurrences vs 1
    const globex = groups.find(g => g.normalizedKey === 'globex')!
    expect(globex.contactIds).toEqual(['c4'])
    expect(globex.suggestedCompanyName).toBe('Globex')
  })

  it('skips contacts that already have companyId set', () => {
    const contacts = [
      { id: 'c1', company: 'ACME', companyId: 'co-existing' }, // already linked → skip
      { id: 'c2', company: 'ACME', companyId: undefined },
    ]
    const groups = groupContactsByCompanyKey(contacts as never)
    expect(groups).toHaveLength(1)
    expect(groups[0].contactIds).toEqual(['c2'])
  })

  it('skips contacts with whitespace-only company string', () => {
    const contacts = [
      { id: 'c1', company: '   ', companyId: undefined },
      { id: 'c2', company: 'Nexus', companyId: undefined },
    ]
    const groups = groupContactsByCompanyKey(contacts as never)
    expect(groups).toHaveLength(1)
    expect(groups[0].normalizedKey).toBe('nexus')
  })

  it('rawValues contains unique raw strings seen', () => {
    const contacts = [
      { id: 'c1', company: 'ACME', companyId: undefined },
      { id: 'c2', company: 'ACME', companyId: undefined },
      { id: 'c3', company: 'Acme', companyId: undefined },
    ]
    const groups = groupContactsByCompanyKey(contacts as never)
    const acme = groups[0]
    // rawValues should contain ACME and Acme (distinct), but not ACME twice
    expect(acme.rawValues).toContain('ACME')
    expect(acme.rawValues).toContain('Acme')
    expect(new Set(acme.rawValues).size).toBe(acme.rawValues.length) // no duplicates
  })

  it('existingCompanyId is null by default (resolved by API)', () => {
    const contacts = [{ id: 'c1', company: 'SomeCo', companyId: undefined }]
    const groups = groupContactsByCompanyKey(contacts as never)
    expect(groups[0].existingCompanyId).toBeNull()
  })

  it('returns empty array when all contacts are already linked', () => {
    const contacts = [
      { id: 'c1', company: 'ACME', companyId: 'co-1' },
      { id: 'c2', company: 'ACME', companyId: 'co-1' },
    ]
    expect(groupContactsByCompanyKey(contacts as never)).toHaveLength(0)
  })
})

// ─── applyMigration ────────────────────────────────────────────────────────

describe('applyMigration', () => {
  function buildFirestoreMocks(opts: {
    newCompanyId?: string
    batchCommitFn?: jest.Mock
  } = {}) {
    const batchCommit = opts.batchCommitFn ?? jest.fn().mockResolvedValue(undefined)
    const batchUpdate = jest.fn()
    const mockBatch = { commit: batchCommit, update: batchUpdate }
    const companyRef = { id: opts.newCompanyId ?? 'new-co-id', set: jest.fn().mockResolvedValue(undefined) }
    const companyDocFn = jest.fn().mockReturnValue(companyRef)
    const contactDocFn = jest.fn().mockImplementation((id: string) => ({
      id,
      update: jest.fn().mockResolvedValue(undefined),
    }))
    ;(adminDb.batch as jest.Mock).mockReturnValue(mockBatch)
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'companies') return { doc: companyDocFn }
      if (name === 'contacts') return { doc: contactDocFn }
      return { doc: jest.fn() }
    })
    return { batchCommit, batchUpdate, companyRef, companyDocFn, contactDocFn }
  }

  it('creates a new company and batch-updates contacts when no existingCompanyId', async () => {
    const { batchCommit, batchUpdate, companyRef } = buildFirestoreMocks({ newCompanyId: 'co-new-1' })
    const results = await applyMigration('org-a', [
      {
        normalizedKey: 'acme corp',
        companyName: 'ACME Corp',
        applyToContactIds: ['c1', 'c2'],
        useExistingCompanyId: undefined,
      },
    ], testActor)

    expect(results).toHaveLength(1)
    expect(results[0].outcome).toBe('created')
    expect(results[0].companyId).toBe('co-new-1')
    expect(results[0].contactsUpdated).toBe(2)
    expect(companyRef.set).toHaveBeenCalledTimes(1)
    // 2 contacts → 1 batch commit
    expect(batchCommit).toHaveBeenCalledTimes(1)
    expect(batchUpdate).toHaveBeenCalledTimes(2)
  })

  it('returns outcome linked when useExistingCompanyId is provided (no new company created)', async () => {
    const { batchCommit, batchUpdate, companyRef } = buildFirestoreMocks()
    const results = await applyMigration('org-a', [
      {
        normalizedKey: 'globex',
        companyName: 'Globex',
        applyToContactIds: ['c4'],
        useExistingCompanyId: 'co-existing-99',
      },
    ], testActor)

    expect(results[0].outcome).toBe('linked')
    expect(results[0].companyId).toBe('co-existing-99')
    expect(results[0].contactsUpdated).toBe(1)
    // No new company should be created
    expect(companyRef.set).not.toHaveBeenCalled()
    expect(batchCommit).toHaveBeenCalledTimes(1)
    expect(batchUpdate).toHaveBeenCalledTimes(1)
  })

  it('chunks contact updates at 30 — 35 contacts produces 2 batch commits', async () => {
    const { batchCommit } = buildFirestoreMocks()
    const contactIds = Array.from({ length: 35 }, (_, i) => `c${i}`)
    const results = await applyMigration('org-a', [
      {
        normalizedKey: 'bigco',
        companyName: 'BigCo',
        applyToContactIds: contactIds,
        useExistingCompanyId: 'co-big',
      },
    ], testActor)

    expect(results[0].contactsUpdated).toBe(35)
    // 35 contacts → ceil(35/30) = 2 batches
    expect(batchCommit).toHaveBeenCalledTimes(2)
  })

  it('returns failed outcome when Firestore throws', async () => {
    ;(adminDb.batch as jest.Mock).mockReturnValue({
      commit: jest.fn().mockRejectedValue(new Error('Firestore down')),
      update: jest.fn(),
    })
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'companies') return { doc: jest.fn().mockReturnValue({ id: 'co-err', set: jest.fn().mockResolvedValue(undefined) }) }
      if (name === 'contacts') return { doc: jest.fn().mockReturnValue({ id: 'cx' }) }
      return { doc: jest.fn() }
    })

    const results = await applyMigration('org-a', [
      {
        normalizedKey: 'failco',
        companyName: 'FailCo',
        applyToContactIds: ['cx1'],
        useExistingCompanyId: undefined,
      },
    ], testActor)

    expect(results[0].outcome).toBe('failed')
    expect(results[0].error).toContain('Firestore down')
    expect(results[0].contactsUpdated).toBe(0)
  })
})
