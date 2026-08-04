import type { FinanceActorContext } from '@/lib/finance/types'
import { FinanceAuthorizationError } from '@/lib/finance/policy'
import {
  ExpenseClaimFinanceService,
  ExpenseClaimValidationError,
  buildOcrAssistSuggestion,
  createEmptyExpenseClaimStore,
  filterExpenseClaims,
  sumClaimLines,
  vatMinorForNet,
  type ExpenseClaimStore,
} from '@/lib/finance/expense-claims/service'

function actor(
  uid: string,
  orgId: string,
  opts?: { role?: FinanceActorContext['membershipRole']; financeRole?: string },
): FinanceActorContext {
  const membershipRole = opts?.role ?? 'admin'
  const financeRole = (opts?.financeRole ?? 'finance_admin') as any
  return {
    uid,
    orgId,
    membershipRole,
    membershipActive: true,
    financeModuleEnabled: true,
    assignments:
      membershipRole === 'owner' || membershipRole === 'admin'
        ? [
            {
              id: 'asg1',
              orgId,
              userId: uid,
              legalEntityId: 'le_1',
              scopeMode: 'entity',
              role: financeRole,
              status: 'active',
            },
          ]
        : [
            {
              id: 'asg1',
              orgId,
              userId: uid,
              legalEntityId: 'le_1',
              scopeMode: 'entity',
              role: financeRole,
              status: 'active',
            },
          ],
  }
}

function serviceWith(storeRef: { current: ExpenseClaimStore }) {
  return new ExpenseClaimFinanceService(
    async () => storeRef.current,
    async (_b, after) => {
      storeRef.current = after
    },
    () => '2026-08-03T12:00:00.000Z',
  )
}

describe('expense claim pure helpers', () => {
  test('VAT 15% half-up style integer on net', () => {
    expect(vatMinorForNet(100_00, 'za_std_15')).toBe(15_00)
    expect(vatMinorForNet(850_00, 'za_std_15')).toBe(127_50)
    expect(vatMinorForNet(100_00, 'za_zero')).toBe(0)
  })

  test('OCR assist never auto-applies and guesses fuel from filename', () => {
    const o = buildOcrAssistSuggestion({
      id: 'o1',
      claimId: 'c1',
      orgId: 'org_a',
      receiptId: 'r1',
      fileName: 'engen-fuel.pdf',
      textSnippet: 'Total R977.50',
      actorId: 'u1',
      nowIso: '2026-08-03T12:00:00.000Z',
    })
    expect(o.autoApplied).toBe(false)
    expect(o.autoPosted).toBe(false)
    expect(o.externalPaymentInitiated).toBe(false)
    expect(o.status).toBe('suggested')
    expect(o.vendorGuess?.toLowerCase()).toContain('fuel')
    expect((o.totalGrossMinorGuess || 0) > 0).toBe(true)
  })

  test('filter by status and vendor', () => {
    const claims = [
      {
        id: '1',
        status: 'submitted',
        vendor: 'Engen',
        employeeId: 'e1',
        claimDate: '2026-08-01',
        grossTotalMinor: 100,
        receiptIds: ['r'],
      },
      {
        id: '2',
        status: 'draft',
        vendor: 'Woolworths',
        employeeId: 'e2',
        claimDate: '2026-08-02',
        grossTotalMinor: 50,
        receiptIds: [],
      },
    ] as any
    expect(filterExpenseClaims(claims, { status: 'submitted' })).toHaveLength(1)
    expect(filterExpenseClaims(claims, { vendorContains: 'wool' })).toHaveLength(1)
    expect(filterExpenseClaims(claims, { hasReceipt: true })).toHaveLength(1)
  })
})

describe('expense claim lifecycle', () => {
  test('draft → submit → approve → post payable with balanced journal; hard gates hold', async () => {
    const storeRef = { current: createEmptyExpenseClaimStore() }
    const svc = serviceWith(storeRef)
    const bookkeeper = actor('bk1', 'org_pib', { role: 'member', financeRole: 'bookkeeper' })
    const manager = actor('mgr1', 'org_pib', { role: 'member', financeRole: 'finance_approver' })

    const claim = await svc.createClaim(bookkeeper, {
      id: 'c1',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      payeeName: 'Thandi Nkosi',
      employeeId: 'emp_thandi',
      claimDate: '2026-08-01',
      vendor: 'Engen',
      policyNotes: 'Fuel within policy',
      lines: [
        {
          id: 'l1',
          description: 'Fuel',
          expenseAccountId: 'acc_travel',
          netMinor: 850_00,
          taxRateCode: 'za_std_15',
        },
      ],
      requestId: 'r1',
      idempotencyKey: 'idem-c1',
    })
    expect(claim.status).toBe('draft')
    expect(claim.vatTotalMinor).toBe(127_50)
    expect(claim.grossTotalMinor).toBe(977_50)
    expect(claim.externalPaymentInitiated).toBe(false)
    expect(claim.autoPosted).toBe(false)

    const receipt = await svc.attachReceipt(bookkeeper, {
      id: 'rc1',
      orgId: 'org_pib',
      claimId: 'c1',
      fileName: 'engen.pdf',
      contentType: 'application/pdf',
      storageRefId: 'stor_1',
      requestId: 'r2',
      idempotencyKey: 'idem-rc',
    })
    expect(receipt.claimId).toBe('c1')

    const ocr = await svc.runOcrAssist(bookkeeper, {
      id: 'ocr1',
      orgId: 'org_pib',
      claimId: 'c1',
      receiptId: 'rc1',
      textSnippet: 'Engen R977.50',
      requestId: 'r3',
      idempotencyKey: 'idem-ocr',
    })
    expect(ocr.autoApplied).toBe(false)
    expect(ocr.status).toBe('suggested')

    // OCR confirm without auto-post
    await svc.confirmOcr(bookkeeper, {
      id: 'ocr1',
      orgId: 'org_pib',
      applyLines: false,
      requestId: 'r4',
      idempotencyKey: 'idem-ocr-c',
    })

    await svc.submitClaim(bookkeeper, {
      id: 'c1',
      orgId: 'org_pib',
      requestId: 'r5',
      idempotencyKey: 'idem-sub',
    })

    // Bookkeeper lacks approver role
    await expect(
      svc.approveClaim(bookkeeper, {
        id: 'c1',
        orgId: 'org_pib',
        requestId: 'r6',
        idempotencyKey: 'idem-bad',
      }),
    ).rejects.toBeInstanceOf(FinanceAuthorizationError)

    const approved = await svc.approveClaim(manager, {
      id: 'c1',
      orgId: 'org_pib',
      note: 'OK',
      requestId: 'r7',
      idempotencyKey: 'idem-apr',
    })
    expect(approved.status).toBe('approved')

    const posted = await svc.postClaim(manager, {
      id: 'c1',
      orgId: 'org_pib',
      postTarget: 'payable',
      creditAccountId: 'acc_claims_payable',
      vatControlAccountId: 'acc_vat_input',
      requestId: 'r8',
      idempotencyKey: 'idem-post',
    })
    expect(posted.status).toBe('posted')
    expect(posted.journalProposal?.balanced).toBe(true)
    expect(posted.externalPaymentInitiated).toBe(false)
    expect(posted.autoPosted).toBe(false)
    const deb = posted.journalProposal!.lines.reduce((s, l) => s + l.debitMinor, 0)
    const cred = posted.journalProposal!.lines.reduce((s, l) => s + l.creditMinor, 0)
    expect(deb).toBe(cred)
    expect(deb).toBe(posted.grossTotalMinor)

    const exported = await svc.exportPaymentInstruction(manager, {
      id: 'pack1',
      orgId: 'org_pib',
      claimId: 'c1',
      format: 'eft_csv',
      requestId: 'r9',
      idempotencyKey: 'idem-pay',
    })
    expect(exported.status).toBe('payment_instruction_exported')
    expect(exported.paymentInstructionExport?.externalPaymentInitiated).toBe(false)
    expect(exported.externalPaymentInitiated).toBe(false)

    const bundle = await svc.getBundle(manager, 'org_pib', 'le_1', 'book_1')
    expect(bundle.hardGates.externalPaymentInitiated).toBe(false)
    expect(bundle.hardGates.autoPosted).toBe(false)
    expect(bundle.hardGates.ocrAutoApplied).toBe(false)
    expect(bundle.claims[0].id).toBe('c1')
    expect(bundle.auditEvents.length).toBeGreaterThan(0)
  })

  test('bulk approve multiple submitted claims for managers', async () => {
    const storeRef = { current: createEmptyExpenseClaimStore() }
    const svc = serviceWith(storeRef)
    const bk = actor('bk', 'org_pib', { role: 'member', financeRole: 'bookkeeper' })
    const mgr = actor('mgr', 'org_pib', { role: 'member', financeRole: 'accountant' })

    for (const id of ['a', 'b']) {
      await svc.createClaim(bk, {
        id,
        orgId: 'org_pib',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        payeeName: 'P',
        claimDate: '2026-08-01',
        lines: [
          {
            id: `${id}l`,
            description: 'x',
            expenseAccountId: 'e',
            netMinor: 100_00,
            taxRateCode: 'za_zero',
          },
        ],
        requestId: `cr${id}`,
        idempotencyKey: `ic${id}`,
      })
      await svc.submitClaim(bk, { id, orgId: 'org_pib', requestId: `s${id}`, idempotencyKey: `is${id}` })
    }

    const res = await svc.bulkApprove(mgr, {
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      claimIds: ['a', 'b'],
      note: 'bulk',
      requestId: 'bulk1',
      idempotencyKey: 'ibulk',
    })
    expect(res.count).toBe(2)
    expect(res.approved.every((c) => c.status === 'approved')).toBe(true)
  })

  test('reject requires note; viewer cannot create', async () => {
    const storeRef = { current: createEmptyExpenseClaimStore() }
    const svc = serviceWith(storeRef)
    const bk = actor('bk', 'org_pib', { role: 'member', financeRole: 'bookkeeper' })
    const viewer = actor('v', 'org_pib', { role: 'member', financeRole: 'finance_viewer' })
    await svc.createClaim(bk, {
      id: 'c',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      payeeName: 'P',
      claimDate: '2026-08-01',
      lines: [
        { id: 'l', description: 'x', expenseAccountId: 'e', netMinor: 10_00, taxRateCode: 'za_zero' },
      ],
      requestId: '1',
      idempotencyKey: '1',
    })
    await svc.submitClaim(bk, { id: 'c', orgId: 'org_pib', requestId: '2', idempotencyKey: '2' })
    await expect(
      svc.rejectClaim(actor('mgr', 'org_pib', { role: 'member', financeRole: 'finance_approver' }), {
        id: 'c',
        orgId: 'org_pib',
        requestId: '3',
        idempotencyKey: '3',
      }),
    ).rejects.toBeInstanceOf(ExpenseClaimValidationError)

    await expect(
      svc.createClaim(viewer, {
        id: 'x',
        orgId: 'org_pib',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        payeeName: 'P',
        claimDate: '2026-08-01',
        lines: [
          { id: 'l', description: 'x', expenseAccountId: 'e', netMinor: 10_00, taxRateCode: 'za_zero' },
        ],
        requestId: '4',
        idempotencyKey: '4',
      }),
    ).rejects.toBeInstanceOf(FinanceAuthorizationError)
  })


  test('soft SOD: submitter finance_approver cannot approve own claim', async () => {
    const storeRef = { current: createEmptyExpenseClaimStore() }
    const svc = serviceWith(storeRef)
    // accountant can create+submit; finance_approver-only cannot create — use accountant for both then second approver
    const acc = actor('acc1', 'org_pib', { role: 'member', financeRole: 'accountant' })
    const other = actor('acc2', 'org_pib', { role: 'member', financeRole: 'finance_approver' })
    await svc.createClaim(acc, {
      id: 'sod1',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      payeeName: 'P',
      claimDate: '2026-08-01',
      lines: [
        { id: 'l', description: 'x', expenseAccountId: 'e', netMinor: 10_00, taxRateCode: 'za_zero' },
      ],
      requestId: 's1',
      idempotencyKey: 's1',
    })
    await svc.submitClaim(acc, { id: 'sod1', orgId: 'org_pib', requestId: 's2', idempotencyKey: 's2' })
    await expect(
      svc.approveClaim(acc, { id: 'sod1', orgId: 'org_pib', requestId: 's3', idempotencyKey: 's3' }),
    ).rejects.toBeInstanceOf(ExpenseClaimValidationError)
    const ok = await svc.approveClaim(other, {
      id: 'sod1',
      orgId: 'org_pib',
      note: 'peer',
      requestId: 's4',
      idempotencyKey: 's4',
    })
    expect(ok.status).toBe('approved')
  })

  test('tenant isolation on load', async () => {
    const storeRef = { current: createEmptyExpenseClaimStore() }
    const svc = serviceWith(storeRef)
    const a = actor('u', 'org_a')
    await svc.createClaim(a, {
      id: 'c',
      orgId: 'org_a',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      payeeName: 'P',
      claimDate: '2026-08-01',
      lines: [
        { id: 'l', description: 'x', expenseAccountId: 'e', netMinor: 10_00, taxRateCode: 'za_zero' },
      ],
      requestId: '1',
      idempotencyKey: '1',
    })
    const other = actor('u2', 'org_b')
    await expect(
      svc.submitClaim(other, { id: 'c', orgId: 'org_b', requestId: '2', idempotencyKey: '2' }),
    ).rejects.toThrow(/not found/i)
  })
})

describe('sum lines', () => {
  test('aggregates', () => {
    const s = sumClaimLines([
      {
        id: '1',
        description: 'a',
        expenseAccountId: 'e',
        netMinor: 100,
        taxRateCode: 'za_std_15',
        vatMinor: 15,
        grossMinor: 115,
      },
      {
        id: '2',
        description: 'b',
        expenseAccountId: 'e',
        netMinor: 200,
        taxRateCode: 'za_zero',
        vatMinor: 0,
        grossMinor: 200,
      },
    ])
    expect(s).toEqual({ netTotalMinor: 300, vatTotalMinor: 15, grossTotalMinor: 315 })
  })
})
