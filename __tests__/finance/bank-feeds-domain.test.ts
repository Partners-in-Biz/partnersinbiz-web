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
  BankFeedCredentialVaultError,
  createEmptyBankFeedCredentialVault,
  looksLikeInlineSecret,
} from '@/lib/finance/bank-feeds/credential-vault-stub'
import { ZaAggregatorStubBankFeedProvider } from '@/lib/finance/bank-feeds/providers/za-aggregator-stub'
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

  test('registry resolves mock and za_aggregator_stub', () => {
    const reg = createBankFeedAdapterRegistry()
    expect(reg.mock().providerId).toBe('mock')
    expect(reg.za_aggregator_stub().providerId).toBe('za_aggregator_stub')
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

  test('mock connection rejects secretRefId; non-mock requires secretRefId and feature flag', async () => {
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

    // Default org settings: non-mock disabled
    await expect(
      svc.createConnection(admin, {
        id: 'live1',
        orgId: 'org_pib',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        providerId: 'live_stub',
        label: 'live',
        bankAccountId: 'bank_main',
        secretRefId: 'sec_bf_live_1',
        requestId: 'r2',
        idempotencyKey: 'i2',
      }),
    ).rejects.toThrow(/not enabled|Non-mock/i)

    await svc.updateProviderSettings(admin, {
      orgId: 'org_pib',
      allowNonMockProviders: true,
      enabledProviderIds: ['mock', 'live_stub'],
      requestId: 'r3',
      idempotencyKey: 'settings-live',
    })

    await expect(
      svc.createConnection(admin, {
        id: 'live2',
        orgId: 'org_pib',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        providerId: 'live_stub',
        label: 'live',
        bankAccountId: 'bank_main',
        requestId: 'r4',
        idempotencyKey: 'i3',
      }),
    ).rejects.toThrow(/secretRefId is required/)

    const liveConn = await svc.createConnection(admin, {
      id: 'live3',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      providerId: 'live_stub',
      label: 'live',
      bankAccountId: 'bank_main',
      secretRefId: 'sec_bf_live_ok',
      requestId: 'r5',
      idempotencyKey: 'i4',
    })
    expect(liveConn.providerId).toBe('live_stub')
    expect(liveConn.secretRefId).toBe('sec_bf_live_ok')
    expect(liveConn.noEgress).toBe(true)
  })
})

describe('ZA aggregator adapter boundary (no paid vendor)', () => {
  test('vault rejects inline secrets and missing refs', () => {
    const vault = createEmptyBankFeedCredentialVault()
    // Heuristic guards (no vendor-shaped live key strings — push protection).
    expect(looksLikeInlineSecret('not-a-ref-because-it-has spaces')).toBe(true)
    expect(looksLikeInlineSecret('x'.repeat(140))).toBe(true)
    expect(looksLikeInlineSecret('-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----')).toBe(true)
    expect(looksLikeInlineSecret('sec_bf_org_abc')).toBe(false)
    expect(() =>
      vault.resolveMetadata('org_pib', 'sec_missing'),
    ).toThrow(/not found|fail closed/i)
  })

  test('za_aggregator_stub fails closed without credentials and with noEgress', async () => {
    const vault = createEmptyBankFeedCredentialVault()
    const za = new ZaAggregatorStubBankFeedProvider(vault)

    await expect(
      za.fetchTransactions(
        {
          orgId: 'org_pib',
          legalEntityId: 'le_1',
          bookId: 'book_1',
          connectionId: 'c1',
          nowIso: '2026-08-03T10:00:00.000Z',
          noEgress: true,
        },
        'acc',
        {},
      ),
    ).rejects.toBeInstanceOf(BankFeedCredentialVaultError)

    vault.registerMetadataOnly({
      secretRefId: 'sec_bf_za_1',
      orgId: 'org_pib',
      providerId: 'za_aggregator_stub',
      nowIso: '2026-08-03T10:00:00.000Z',
      label: 'metadata only',
    })

    await expect(
      za.listAccounts({
        orgId: 'org_pib',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        connectionId: 'c1',
        secretRefId: 'sec_bf_za_1',
        nowIso: '2026-08-03T10:00:00.000Z',
        noEgress: true,
      }),
    ).rejects.toBeInstanceOf(BankFeedAdapterEgressError)

    // Even if egress flag were false, skeleton still refuses live calls (no vendor bind).
    await expect(
      za.fetchTransactions(
        {
          orgId: 'org_pib',
          legalEntityId: 'le_1',
          bookId: 'book_1',
          connectionId: 'c1',
          secretRefId: 'sec_bf_za_1',
          nowIso: '2026-08-03T10:00:00.000Z',
          noEgress: false,
        },
        'acc',
        {},
      ),
    ).rejects.toBeInstanceOf(BankFeedAdapterEgressError)
  })

  test('org provider settings default to mock; live egress cannot be enabled', async () => {
    const storeRef = { current: createEmptyBankFeedStore() }
    const svc = serviceWith(storeRef)
    const admin = actor('u1', 'org_pib')

    const defaults = await svc.getProviderSettings(admin, 'org_pib')
    expect(defaults.defaultProviderId).toBe('mock')
    expect(defaults.allowNonMockProviders).toBe(false)
    expect(defaults.allowLiveEgress).toBe(false)
    expect(defaults.enabledProviderIds).toEqual(['mock'])

    await expect(
      svc.updateProviderSettings(admin, {
        orgId: 'org_pib',
        allowLiveEgress: true,
        allowNonMockProviders: true,
        enabledProviderIds: ['mock', 'za_aggregator_stub'],
        requestId: 'r-live',
        idempotencyKey: 'settings-egress',
      }),
    ).rejects.toThrow(/MASTER_SWITCH|allowLiveEgress/i)

    const enabled = await svc.updateProviderSettings(admin, {
      orgId: 'org_pib',
      allowNonMockProviders: true,
      enabledProviderIds: ['mock', 'za_aggregator_stub'],
      defaultProviderId: 'mock',
      requestId: 'r-za',
      idempotencyKey: 'settings-za',
    })
    expect(enabled.allowNonMockProviders).toBe(true)
    expect(enabled.defaultProviderId).toBe('mock')
    expect(enabled.enabledProviderIds).toContain('za_aggregator_stub')
    expect(enabled.allowLiveEgress).toBe(false)

    // Connection without vault metadata fails closed
    await expect(
      svc.createConnection(admin, {
        id: 'za-bad',
        orgId: 'org_pib',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        providerId: 'za_aggregator_stub',
        label: 'ZA stub',
        bankAccountId: 'bank_main',
        secretRefId: 'sec_bf_za_missing',
        requestId: 'r1',
        idempotencyKey: 'za1',
      }),
    ).rejects.toThrow(/not found|fail closed/i)

    svc.getCredentialVault().registerMetadataOnly({
      secretRefId: 'sec_bf_za_ok',
      orgId: 'org_pib',
      providerId: 'za_aggregator_stub',
      nowIso: '2026-08-03T10:00:00.000Z',
    })

    const conn = await svc.createConnection(admin, {
      id: 'za-ok',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      providerId: 'za_aggregator_stub',
      label: 'ZA stub',
      bankAccountId: 'bank_main',
      externalAccountId: 'ext_za_1',
      secretRefId: 'sec_bf_za_ok',
      requestId: 'r2',
      idempotencyKey: 'za2',
    })
    expect(conn.providerId).toBe('za_aggregator_stub')
    expect(conn.noEgress).toBe(true)

    await expect(
      svc.syncNow(admin, {
        id: 'run-za',
        orgId: 'org_pib',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        connectionId: 'za-ok',
        noEgress: true,
        requestId: 'r3',
        idempotencyKey: 'sync-za',
      }),
    ).rejects.toThrow(/noEgress|not configured|refuses live|gated on Peet/i)

    const bundle = await svc.getBundle(admin, 'org_pib', 'le_1', 'book_1')
    expect(bundle.providerSelection.defaultProviderId).toBe('mock')
    expect(bundle.providerSelection.liveEgressMasterSwitch).toBe(false)
    expect(bundle.providerSelection.effectiveLiveEgressAllowed).toBe(false)
    expect(bundle.hardGates.noEgress).toBe(true)
    expect(bundle.hardGates.externalPaymentInitiated).toBe(false)
  })

  test('default connection provider is mock when omitted', async () => {
    const storeRef = { current: createEmptyBankFeedStore() }
    const svc = serviceWith(storeRef)
    const admin = actor('u1', 'org_pib')
    const conn = await svc.createConnection(admin, {
      id: 'def1',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      label: 'Default mock',
      bankAccountId: 'bank_main',
      requestId: 'r',
      idempotencyKey: 'def',
    })
    expect(conn.providerId).toBe('mock')
  })
})
