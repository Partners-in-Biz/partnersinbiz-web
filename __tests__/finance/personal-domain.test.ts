import type { FinanceActorContext } from '@/lib/finance/types'
import {
  PersonalFinanceService,
  createEmptyPersonalStore,
  type PersonalFinanceStore,
} from '@/lib/finance/personal/service'
import { FinanceAuthorizationError } from '@/lib/finance/policy'

function actor(uid: string, role: FinanceActorContext['membershipRole'] = 'member'): FinanceActorContext {
  return {
    uid,
    orgId: 'org_1',
    membershipRole: role,
    membershipActive: true,
    financeModuleEnabled: true,
    assignments:
      role === 'owner' || role === 'admin'
        ? [
            {
              id: 'asg1',
              orgId: 'org_1',
              userId: uid,
              legalEntityId: 'le_1',
              scopeMode: 'entity',
              role: 'finance_admin',
              status: 'active',
            },
          ]
        : [],
  }
}

function serviceWith(storeRef: { current: PersonalFinanceStore }) {
  return new PersonalFinanceService(
    async () => storeRef.current,
    async (_before, after) => {
      storeRef.current = after
    },
    () => '2026-08-02T10:00:00.000Z',
  )
}

describe('personal finance domain', () => {
  test('owner can create book, accounts, balanced entries; other member cannot read', async () => {
    const storeRef = { current: createEmptyPersonalStore() }
    const svc = serviceWith(storeRef)
    const owner = actor('user_a')
    const other = actor('user_b')

    const book = await svc.createBook(owner, {
      id: 'pbook_1',
      orgId: 'org_1',
      name: 'Mine',
      currency: 'ZAR',
      requestId: 'r1',
      idempotencyKey: 'k1',
    })
    expect(book.visibility).toBe('owner')
    expect(book.ownerUid).toBe('user_a')

    const cash = await svc.createAccount(owner, {
      id: 'pacc_cash',
      orgId: 'org_1',
      bookId: book.id,
      code: '1000',
      name: 'Cash',
      accountType: 'asset',
      openingBalanceMinor: 10_000,
      requestId: 'r2',
      idempotencyKey: 'k2',
    })
    const income = await svc.createAccount(owner, {
      id: 'pacc_inc',
      orgId: 'org_1',
      bookId: book.id,
      code: '4000',
      name: 'Income',
      accountType: 'income',
      requestId: 'r3',
      idempotencyKey: 'k3',
    })
    const expense = await svc.createAccount(owner, {
      id: 'pacc_exp',
      orgId: 'org_1',
      bookId: book.id,
      code: '5000',
      name: 'Expense',
      accountType: 'expense',
      requestId: 'r4',
      idempotencyKey: 'k4',
    })

    await svc.postEntry(owner, {
      id: 'pe_1',
      orgId: 'org_1',
      bookId: book.id,
      entryDate: '2026-08-01',
      description: 'Coffee',
      lines: [
        { accountId: expense.id, debitMinor: 500, creditMinor: 0 },
        { accountId: cash.id, debitMinor: 0, creditMinor: 500 },
      ],
      requestId: 'r5',
      idempotencyKey: 'k5',
    })

    const mine = await svc.getOwnerBundle(owner, 'org_1')
    expect(mine.books).toHaveLength(1)
    expect(mine.entries).toHaveLength(1)
    expect(mine.accounts.find((a) => a.id === cash.id)?.balanceMinor).toBe(9500)
    expect(mine.externalPaymentInitiated).toBe(false)

    await expect(svc.getOwnerBundle(other, 'org_1')).resolves.toEqual({
      books: [],
      accounts: [],
      entries: [],
      transfers: [],
      externalPaymentInitiated: false,
    })

    // other member cannot post into owner's book
    await expect(
      svc.postEntry(other, {
        id: 'pe_x',
        orgId: 'org_1',
        bookId: book.id,
        entryDate: '2026-08-01',
        description: 'Hack',
        lines: [
          { accountId: expense.id, debitMinor: 100, creditMinor: 0 },
          { accountId: cash.id, debitMinor: 0, creditMinor: 100 },
        ],
        requestId: 'rx',
        idempotencyKey: 'kx',
      }),
    ).rejects.toBeInstanceOf(FinanceAuthorizationError)
  })

  test('org admin proposes transfer; member accepts into personal book without bank initiate', async () => {
    const storeRef = { current: createEmptyPersonalStore() }
    const svc = serviceWith(storeRef)
    const admin = actor('admin_1', 'admin')
    const member = actor('member_1')

    const book = await svc.createBook(member, {
      id: 'pbook_m',
      orgId: 'org_1',
      name: 'Member personal',
      requestId: 'r1',
      idempotencyKey: 'k1',
    })
    const cash = await svc.createAccount(member, {
      id: 'pacc_c',
      orgId: 'org_1',
      bookId: book.id,
      code: '1000',
      name: 'Cash',
      accountType: 'asset',
      requestId: 'r2',
      idempotencyKey: 'k2',
    })
    const income = await svc.createAccount(member, {
      id: 'pacc_i',
      orgId: 'org_1',
      bookId: book.id,
      code: '4000',
      name: 'Org payouts',
      accountType: 'income',
      requestId: 'r3',
      idempotencyKey: 'k3',
    })

    const transfer = await svc.proposeTransfer(admin, {
      id: 'pt_1',
      orgId: 'org_1',
      memberUid: 'member_1',
      amountMinor: 25_000,
      description: 'July reimbursement',
      sourcePaymentId: 'pay_obs_1',
      requestId: 'r4',
      idempotencyKey: 'k4',
    })
    expect(transfer.status).toBe('proposed')
    expect(transfer.externalPaymentInitiated).toBe(false)

    // stranger cannot accept
    await expect(
      svc.acceptTransfer(actor('stranger'), {
        id: 'pt_1',
        orgId: 'org_1',
        bookId: book.id,
        incomeAccountId: income.id,
        assetAccountId: cash.id,
        requestId: 'r5',
        idempotencyKey: 'k5',
      }),
    ).rejects.toBeInstanceOf(FinanceAuthorizationError)

    const accepted = await svc.acceptTransfer(member, {
      id: 'pt_1',
      orgId: 'org_1',
      bookId: book.id,
      incomeAccountId: income.id,
      assetAccountId: cash.id,
      requestId: 'r6',
      idempotencyKey: 'k6',
    })
    expect(accepted.transfer.status).toBe('accepted')
    expect(accepted.transfer.externalPaymentInitiated).toBe(false)
    expect(accepted.entry.source).toEqual({ kind: 'org_member_transfer', transferId: 'pt_1' })
    expect(storeRef.current.accounts.get(cash.id)?.balanceMinor).toBe(25_000)
  })

  test('rejects unbalanced personal entries', async () => {
    const storeRef = { current: createEmptyPersonalStore() }
    const svc = serviceWith(storeRef)
    const owner = actor('user_a')
    const book = await svc.createBook(owner, {
      id: 'pbook_1',
      orgId: 'org_1',
      name: 'Mine',
      requestId: 'r1',
      idempotencyKey: 'k1',
    })
    const cash = await svc.createAccount(owner, {
      id: 'pacc_c',
      orgId: 'org_1',
      bookId: book.id,
      code: '1000',
      name: 'Cash',
      accountType: 'asset',
      requestId: 'r2',
      idempotencyKey: 'k2',
    })
    const exp = await svc.createAccount(owner, {
      id: 'pacc_e',
      orgId: 'org_1',
      bookId: book.id,
      code: '5000',
      name: 'Exp',
      accountType: 'expense',
      requestId: 'r3',
      idempotencyKey: 'k3',
    })
    await expect(
      svc.postEntry(owner, {
        id: 'pe_bad',
        orgId: 'org_1',
        bookId: book.id,
        entryDate: '2026-08-01',
        description: 'bad',
        lines: [
          { accountId: exp.id, debitMinor: 100, creditMinor: 0 },
          { accountId: cash.id, debitMinor: 0, creditMinor: 50 },
        ],
        requestId: 'r4',
        idempotencyKey: 'k4',
      }),
    ).rejects.toThrow(/balance/i)
  })
})
