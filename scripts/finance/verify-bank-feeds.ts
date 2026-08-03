/**
 * Development verification for bank feed connector framework (mock-first).
 * No paid vendor, no real bank egress, no auto-post, no payment initiate, no SARS, no prod deploy.
 */
import assert from 'assert'
import { MockBankFeedProvider, MOCK_BANK_FEED_ACCOUNT } from '../../lib/finance/bank-feeds/mock-provider'
import { LiveStubBankFeedProvider, BankFeedAdapterEgressError } from '../../lib/finance/bank-feeds/adapter'
import {
  BankFeedFinanceService,
  createEmptyBankFeedStore,
  type BankFeedStore,
} from '../../lib/finance/bank-feeds/service'
import type { FinanceActorContext } from '../../lib/finance/types'

function actor(uid: string, orgId: string): FinanceActorContext {
  return {
    uid,
    orgId,
    membershipRole: 'admin',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: [
      {
        id: 'asg1',
        orgId,
        userId: uid,
        legalEntityId: 'le_1',
        scopeMode: 'entity',
        role: 'finance_admin',
        status: 'active',
      },
    ],
  }
}

async function main() {
  const mock = new MockBankFeedProvider()
  const accounts = await mock.listAccounts({
    orgId: 'org_verify_bf',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    connectionId: 'c',
    nowIso: '2026-08-03T12:00:00.000Z',
    noEgress: true,
  })
  assert.strictEqual(accounts[0].externalAccountId, MOCK_BANK_FEED_ACCOUNT.externalAccountId)

  const live = new LiveStubBankFeedProvider()
  let blocked = false
  try {
    await live.fetchTransactions(
      {
        orgId: 'org_verify_bf',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        connectionId: 'c',
        nowIso: '2026-08-03T12:00:00.000Z',
        noEgress: true,
      },
      'x',
      {},
    )
  } catch (e) {
    blocked = e instanceof BankFeedAdapterEgressError
  }
  assert.strictEqual(blocked, true, 'live_stub must refuse noEgress fetch')

  const storeRef: { current: BankFeedStore } = { current: createEmptyBankFeedStore() }
  const svc = new BankFeedFinanceService(
    async () => storeRef.current,
    async (_b, a) => {
      storeRef.current = a
    },
    () => '2026-08-03T12:00:00.000Z',
  )
  const admin = actor('verify', 'org_verify_bf')
  await svc.createConnection(admin, {
    id: 'conn',
    orgId: 'org_verify_bf',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    providerId: 'mock',
    label: 'Mock',
    bankAccountId: 'bank_main',
    requestId: '1',
    idempotencyKey: 'c',
  })
  const { run, lines, suggestions } = await svc.syncNow(admin, {
    id: 'run',
    orgId: 'org_verify_bf',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    connectionId: 'conn',
    noEgress: true,
    requestId: '2',
    idempotencyKey: 's',
  })
  assert.strictEqual(run.noEgress, true)
  assert.strictEqual(run.autoPosted, false)
  assert.strictEqual(run.externalPaymentInitiated, false)
  assert.ok(lines.length > 0)
  assert.ok(suggestions.length > 0)
  const accepted = await svc.acceptSuggestion(admin, {
    id: suggestions[0].id,
    orgId: 'org_verify_bf',
    requestId: '3',
    idempotencyKey: 'a',
  })
  assert.strictEqual(accepted.autoPosted, false)
  assert.strictEqual(accepted.externalPaymentInitiated, false)
  const bundle = await svc.getBundle(admin, 'org_verify_bf', 'le_1', 'book_1')
  assert.deepStrictEqual(bundle.hardGates, {
    noEgress: true,
    autoPosted: false,
    externalPaymentInitiated: false,
    externalEgressAllowed: false,
    sarsSubmissionInitiated: false,
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        fetched: run.fetchedCount,
        imported: run.importedCount,
        suggestions: suggestions.length,
        noEgress: true,
        autoPosted: false,
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
        liveStubBlocked: true,
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
