import type { FinanceActorContext } from '@/lib/finance/types'
import { FinanceAuthorizationError } from '@/lib/finance/policy'
import {
  BankFeedAdapterEgressError,
  bankFeedSourceFingerprint,
  createBankFeedAdapterRegistry,
  LiveStubBankFeedProvider,
  mapProviderTransactionsToBankLines,
} from '@/lib/finance/bank-feeds/adapter'
import { MockBankFeedProvider, MOCK_BANK_FEED_ACCOUNT } from '@/lib/finance/bank-feeds/mock-provider'
import {
  BankFeedFinanceService,
  createEmptyBankFeedStore,
  type BankFeedStore,
} from '@/lib/finance/bank-feeds/service'

function actor(uid: string, orgId: string, role: FinanceActorContext['membershipRole'] = 'admin'): FinanceActorContext {
  return {
    uid,
    orgId,
    membershipRole: role,
    membershipActive: true,
    financeModuleEnabled: true,
    assignments:
      role === 'owner' || role === 'admin'
        ? [{ id: 'asg1', orgId, userId: uid, legalEntityId: 'le_1', scopeMode: 'entity', role: 'finance_admin', status: 'active' }]
        : [],
  }
}

function serviceWith(storeRef: { current: BankFeedStore }) {
  return new BankFeedFinanceService(
    async () => storeRef.current,
    async (_b, after) => {
      storeRef.current = after
    },
    () => '2026-08-03T10:00:00.000Z',
  )
}

describe('bank feed adapter interface', () => {
  test('mock lists SA cheque account without egress', async () => {
    const mock = new MockBankFeedProvider()
    const accounts = await mock.listAccounts({
      orgId: 'org_a',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      connectionId: 'c1',
      nowIso: '2026-08-03T10:00:00.000Z',
      noEgress: true,
    })
    expect(accounts[0].externalAccountId).toBe(MOCK_BANK_FEED_ACCOUNT.externalAccountId)
    expect(accounts[0].currency).toBe('ZAR')
  })

  test('mock fetch returns deterministic SA lines after cursor', async () => {
    const mock = new MockBankFeedProvider()
    const res = await mock.fetchTransactions(
      {
        orgId: 'org_a',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        connectionId: 'c1',
        nowIso: '2026-08-03T10:00:00.000Z',
        noEgress: true,
      },
      MOCK_BANK_FEED_ACCOUNT.externalAccountId,
      { value: '1970-01-01' },
    )
    expect(res.transactions.length).toBeGreaterThanOrEqual(6)
    expect(res.transactions.every((t) => t.currency === 'ZAR')).toBe(true)
    expect(res.transactions.some((t) => /rent/i.test(t.description))).toBe(true)
    expect(res.transactions.some((t) => /sars/i.test(t.description))).toBe(true)
  })

  test('mapToBankLines stamps hard gates and fingerprints', () => {
    const lines = mapProviderTransactionsToBankLines('mock', {
      orgId: 'org_a',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      connectionId: 'c1',
      syncRunId: 'run1',
      bankAccountId: 'bank_main',
      actorId: 'u1',
      nowIso: '2026-08-03T10:00:00.000Z',
      transactions: [
        {
          externalAccountId: 'acc',
          externalTransactionId: 'tx1',
          bookedAt: '2026-08-01',
          valueDate: '2026-08-01',
          amountMinor: -100,
          currency: 'zar',
          description: 'TEST',
        },
      ],
    })
    expect(lines).toHaveLength(1)
    expect(lines[0].autoPosted).toBe(false)
    expect(lines[0].externalPaymentInitiated).toBe(false)
    expect(lines[0].externalEgressAllowed).toBe(false)
    expect(lines[0].sourceFingerprint).toContain('bf_')
    expect(
      bankFeedSourceFingerprint({
        providerId: 'mock',
        externalAccountId: 'acc',
        externalTransactionId: 'tx1',
        amountMinor: -100,
        valueDate: '2026-08-01',
      }),
    ).toBe(lines[0].sourceFingerprint)
  })

  test('live_stub refuses when noEgress', async () => {
    const live = new LiveStubBankFeedProvider()
    await expect(
      live.listAccounts({
        orgId: 'org_a',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        connectionId: 'c1',
        nowIso: '2026-08-03T10:00:00.000Z',
        noEgress: true,
      }),
    ).rejects.toBeInstanceOf(BankFeedAdapterEgressError)
  })

  test('registry resolves mock by default', () => {
    const reg = createBankFeedAdapterRegistry()
    expect(reg.mock().providerId).toBe('mock')
  })
})

describe('bank feed sync lifecycle', () => {
  test('create mock connection + sync stages lines and pending suggestions; accept never auto-posts', async () => {
    const storeRef = { current: createEmptyBankFeedStore() }
    const svc = serviceWith(storeRef)
    const admin = actor('u1', 'org_pib')

    const conn = await svc.createConnection(admin, {
      id: 'conn1',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      providerId: 'mock',
      label: 'Mock FNB',
      bankAccountId: 'bank_main',
      requestId: 'r1',
      idempotencyKey: 'idem-conn',
    })
    expect(conn.status).toBe('connected')
    expect(conn.noEgress).toBe(true)
    expect(conn.externalPaymentInitiated).toBe(false)
    expect(conn.externalAccountId).toBe(MOCK_BANK_FEED_ACCOUNT.externalAccountId)
    expect(conn.secretRefId).toBeUndefined()

    const { run, lines, suggestions } = await svc.syncNow(admin, {
      id: 'run1',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      connectionId: 'conn1',
      noEgress: true,
      requestId: 'r2',
      idempotencyKey: 'idem-sync',
    })
    expect(run.status).toBe('succeeded')
    expect(run.noEgress).toBe(true)
    expect(run.autoPosted).toBe(false)
    expect(run.externalPaymentInitiated).toBe(false)
    expect(run.externalEgressAllowed).toBe(false)
    expect(lines.length).toBeGreaterThan(0)
    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions.every((s) => s.status === 'pending')).toBe(true)
    expect(suggestions.every((s) => s.autoPosted === false)).toBe(true)
    expect(suggestions.every((s) => s.externalPaymentInitiated === false)).toBe(true)

    // Second sync is idempotent (cursor advanced → no new seed lines past cursor)
    const second = await svc.syncNow(admin, {
      id: 'run2',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      connectionId: 'conn1',
      noEgress: true,
      requestId: 'r3',
      idempotencyKey: 'idem-sync-2',
    })
    expect(second.lines.length).toBe(0)

    const accepted = await svc.acceptSuggestion(admin, {
      id: suggestions[0].id,
      orgId: 'org_pib',
      requestId: 'r4',
      idempotencyKey: 'idem-acc',
      resolutionNote: 'ok',
    })
    expect(accepted.status).toBe('accepted')
    expect(accepted.autoPosted).toBe(false)
    expect(accepted.externalPaymentInitiated).toBe(false)

    const dismissed = await svc.dismissSuggestion(admin, {
      id: suggestions[1].id,
      orgId: 'org_pib',
      requestId: 'r5',
      idempotencyKey: 'idem-dis',
    })
    expect(dismissed.status).toBe('dismissed')
    expect(dismissed.autoPosted).toBe(false)

    const bundle = await svc.getBundle(admin, 'org_pib', 'le_1', 'book_1')
    expect(bundle.hardGates).toEqual({
      noEgress: true,
      autoPosted: false,
      externalPaymentInitiated: false,
      externalEgressAllowed: false,
      sarsSubmissionInitiated: false,
    })
    expect(bundle.auditEvents.length).toBeGreaterThanOrEqual(3)
    expect(bundle.connections).toHaveLength(1)
  })

  test('tenant isolation: other org cannot read connection', async () => {
    const storeRef = { current: createEmptyBankFeedStore() }
    const svc = serviceWith(storeRef)
    const adminA = actor('u1', 'org_a')
    await svc.createConnection(adminA, {
      id: 'connA',
      orgId: 'org_a',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      providerId: 'mock',
      label: 'A',
      bankAccountId: 'bank_main',
      requestId: 'r1',
      idempotencyKey: 'idem-a',
    })
    const adminB = actor('u2', 'org_b')
    const bundleB = await svc.getBundle(adminB, 'org_b', 'le_1', 'book_1')
    expect(bundleB.connections).toHaveLength(0)

    await expect(
      svc.syncNow(adminB, {
        id: 'runX',
        orgId: 'org_b',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        connectionId: 'connA',
        requestId: 'rx',
        idempotencyKey: 'idem-x',
      }),
    ).rejects.toThrow(/not found/i)
  })

  test('viewer cannot configure connections', async () => {
    const storeRef = { current: createEmptyBankFeedStore() }
    const svc = serviceWith(storeRef)
    const viewer: FinanceActorContext = {
      uid: 'v1',
      orgId: 'org_pib',
      membershipRole: 'member',
      membershipActive: true,
      financeModuleEnabled: true,
      assignments: [
        {
          id: 'a',
          orgId: 'org_pib',
          userId: 'v1',
          legalEntityId: 'le_1',
          scopeMode: 'entity',
          role: 'finance_viewer',
          status: 'active',
        },
      ],
    }
    await expect(
      svc.createConnection(viewer, {
        id: 'connx',
        orgId: 'org_pib',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        label: 'x',
        bankAccountId: 'bank_main',
        requestId: 'r',
        idempotencyKey: 'i',
      }),
    ).rejects.toBeInstanceOf(FinanceAuthorizationError)
  })

  test('mock connection rejects secretRefId; live_stub requires secretRefId', async () => {
    const storeRef = { current: createEmptyBankFeedStore() }
    const svc = serviceWith(storeRef)
    const admin = actor('u1', 'org_pib')
    await expect(
      svc.createConnection(admin, {
        id: 'bad',
        orgId: 'org_pib',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        providerId: 'mock',
        label: 'bad',
        bankAccountId: 'bank_main',
        secretRefId: 'sec_x',
        requestId: 'r',
        idempotencyKey: 'i1',
      }),
    ).rejects.toThrow(/must not carry secretRefId/)

    await expect(
      svc.createConnection(admin, {
        id: 'live1',
        orgId: 'org_pib',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        providerId: 'live_stub',
        label: 'live',
        bankAccountId: 'bank_main',
        requestId: 'r2',
        idempotencyKey: 'i2',
      }),
    ).rejects.toThrow(/secretRefId is required/)
  })
})
