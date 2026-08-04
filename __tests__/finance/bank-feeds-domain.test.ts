import type { FinanceActorContext } from '@/lib/finance/types'
import { FinanceAuthorizationError } from '@/lib/finance/policy'
import {
  BankFeedAdapterEgressError,
  bankFeedSourceFingerprint,
  createBankFeedAdapterRegistry,
  LiveStubBankFeedProvider,
  mapProviderTransactionsToBankLines,
} from '@/lib/finance/bank-feeds/adapter'
import {
  MockBankFeedProvider,
  MOCK_BANK_FEED_ACCOUNT,
  MOCK_BANK_FEED_SAVINGS_ACCOUNT,
} from '@/lib/finance/bank-feeds/mock-provider'
import {
  agingBucketForDays,
  buildReconCentre,
  computeConnectionHealth,
  isSafeBulkAcceptSuggestion,
} from '@/lib/finance/bank-feeds/productization'
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

function serviceWith(storeRef: { current: BankFeedStore }, now = '2026-08-03T10:00:00.000Z') {
  return new BankFeedFinanceService(
    async () => storeRef.current,
    async (_b, after) => {
      storeRef.current = after
    },
    () => now,
  )
}

describe('bank feed adapter interface', () => {
  test('mock lists multi-account SA catalogue without egress', async () => {
    const mock = new MockBankFeedProvider()
    const accounts = await mock.listAccounts({
      orgId: 'org_a',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      connectionId: 'c1',
      nowIso: '2026-08-03T10:00:00.000Z',
      noEgress: true,
    })
    expect(accounts.length).toBeGreaterThanOrEqual(2)
    expect(accounts[0].externalAccountId).toBe(MOCK_BANK_FEED_ACCOUNT.externalAccountId)
    expect(accounts.some((a) => a.externalAccountId === MOCK_BANK_FEED_SAVINGS_ACCOUNT.externalAccountId)).toBe(true)
    expect(accounts.every((a) => a.currency === 'ZAR')).toBe(true)
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
    expect((conn.linkedAccounts || []).length).toBeGreaterThanOrEqual(2)

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
    expect(lines.every((l) => l.reconMaterializedAt)).toBe(true)
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
    expect(bundle.connections[0].health.status).toBe('healthy')
    expect(bundle.connections[0].accounts.length).toBeGreaterThanOrEqual(2)
    expect(bundle.reconCentre.unreconciledCount).toBeGreaterThan(0)
    expect(bundle.reconCentre.fileImportFallbackPath).toBe('/portal/finance/statements')
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

  test('mock connection rejects secretRefId; live_stub requires secretRefId after org enables non-mock', async () => {
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
        id: 'live0',
        orgId: 'org_pib',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        providerId: 'live_stub',
        label: 'live-blocked',
        bankAccountId: 'bank_main',
        secretRefId: 'sec_ref_opaque_1',
        requestId: 'r2a',
        idempotencyKey: 'i2a',
      }),
    ).rejects.toThrow(/not enabled|default selection is mock/i)

    await svc.updateProviderSettings(admin, {
      orgId: 'org_pib',
      allowNonMockProviders: true,
      enabledProviderIds: ['mock', 'live_stub'],
      requestId: 'r-settings',
      idempotencyKey: 'i-settings',
    })

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

describe('phase 6 bank feed productization', () => {
  test('connection health: error needs reconnect; stale after 48h', () => {
    const healthy = computeConnectionHealth(
      {
        status: 'connected',
        lastSyncAt: '2026-08-03T09:00:00.000Z',
        linkedAccounts: [
          {
            externalAccountId: 'a',
            name: 'A',
            currency: 'ZAR',
            bankAccountId: 'b',
            status: 'active',
            lastSyncAt: '2026-08-03T09:00:00.000Z',
          },
        ],
        externalAccountId: 'a',
      },
      '2026-08-03T10:00:00.000Z',
    )
    expect(healthy.status).toBe('healthy')

    const errored = computeConnectionHealth(
      {
        status: 'error',
        lastError: 'provider timeout',
        lastSyncAt: '2026-08-01T00:00:00.000Z',
        externalAccountId: 'a',
      },
      '2026-08-03T10:00:00.000Z',
    )
    expect(errored.status).toBe('error')
    expect(errored.needsReconnect).toBe(true)

    const stale = computeConnectionHealth(
      {
        status: 'connected',
        lastSyncAt: '2026-07-30T10:00:00.000Z',
        externalAccountId: 'a',
      },
      '2026-08-03T10:00:00.000Z',
    )
    expect(stale.status).toBe('stale')
  })

  test('aging buckets + safe bulk accept gates', () => {
    expect(agingBucketForDays(3)).toBe('0-7')
    expect(agingBucketForDays(12)).toBe('8-30')
    expect(agingBucketForDays(45)).toBe('31-60')
    expect(agingBucketForDays(90)).toBe('61+')

    expect(
      isSafeBulkAcceptSuggestion({
        status: 'pending',
        kind: 'suggest_expense_account',
        confidence: 0.88,
        reason: 'rent',
      }),
    ).toBe(true)
    expect(
      isSafeBulkAcceptSuggestion({
        status: 'pending',
        kind: 'flag_review',
        confidence: 0.99,
        reason: 'review',
      }),
    ).toBe(false)
    expect(
      isSafeBulkAcceptSuggestion({
        status: 'pending',
        kind: 'suggest_expense_account',
        confidence: 0.95,
        reason: 'SARS PAYE review only',
      }),
    ).toBe(false)
  })

  test('multi-account sync + recon centre + reconnect + safe bulk accept never auto-posts', async () => {
    const storeRef = { current: createEmptyBankFeedStore() }
    const svc = serviceWith(storeRef, '2026-08-10T12:00:00.000Z')
    const admin = actor('u1', 'org_pib')

    const conn = await svc.createConnection(admin, {
      id: 'conn_multi',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      providerId: 'mock',
      label: 'Multi',
      bankAccountId: 'bank_main',
      requestId: 'r1',
      idempotencyKey: 'idem-m1',
    })
    expect((conn.linkedAccounts || []).map((a) => a.externalAccountId).sort()).toEqual(
      [MOCK_BANK_FEED_ACCOUNT.externalAccountId, MOCK_BANK_FEED_SAVINGS_ACCOUNT.externalAccountId].sort(),
    )

    await svc.syncNow(admin, {
      id: 'run_m',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      connectionId: 'conn_multi',
      noEgress: true,
      requestId: 'r2',
      idempotencyKey: 'idem-m2',
    })

    const centre = await svc.getReconCentre(admin, 'org_pib', 'le_1', 'book_1')
    expect(centre.hardGates.autoPosted).toBe(false)
    expect(centre.hardGates.externalPaymentInitiated).toBe(false)
    expect(centre.unreconciledCount).toBeGreaterThan(0)
    expect(centre.aging.reduce((n, b) => n + b.count, 0)).toBe(centre.unreconciledCount)
    expect(centre.items.some((i) => i.externalAccountId === MOCK_BANK_FEED_SAVINGS_ACCOUNT.externalAccountId)).toBe(
      true,
    )
    expect(centre.safeBulkAcceptIds.length).toBeGreaterThan(0)

    const bulk = await svc.bulkResolveSuggestions(admin, {
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      resolution: 'accept',
      requestId: 'r3',
      idempotencyKey: 'idem-bulk',
    })
    expect(bulk.autoPosted).toBe(false)
    expect(bulk.externalPaymentInitiated).toBe(false)
    expect(bulk.resolved.length).toBe(centre.safeBulkAcceptIds.length)
    expect(bulk.resolved.every((s) => s.autoPosted === false)).toBe(true)
    expect(bulk.resolved.every((s) => s.status === 'accepted')).toBe(true)

    // SARS / flag_review must remain pending (not safe bulk).
    const after = await svc.getReconCentre(admin, 'org_pib', 'le_1', 'book_1')
    const remainingPending = after.items.filter((i) => i.suggestionStatus === 'pending')
    expect(remainingPending.some((i) => /sars|flag_review|review/i.test(`${i.suggestionKind} ${i.description}`))).toBe(
      true,
    )

    // Force error then reconnect
    storeRef.current.connections.set('conn_multi', {
      ...storeRef.current.connections.get('conn_multi')!,
      status: 'error',
      lastError: 'simulated',
    })
    const re = await svc.reconnectConnection(admin, {
      id: 'conn_multi',
      orgId: 'org_pib',
      requestId: 'r4',
      idempotencyKey: 'idem-re',
    })
    expect(re.status).toBe('connected')
    expect(re.lastError).toBeUndefined()
    expect(computeConnectionHealth(re, '2026-08-10T12:00:00.000Z').needsReconnect).toBe(false)

    const built = buildReconCentre({
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      asOfIso: '2026-08-10T12:00:00.000Z',
      lines: [...storeRef.current.lines.values()],
      suggestions: [...storeRef.current.suggestions.values()],
      connections: [...storeRef.current.connections.values()],
    })
    expect(built.fileImportFallbackPath).toBe('/portal/finance/statements')
  })
})
