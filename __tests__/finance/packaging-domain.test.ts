import type { FinanceActorContext } from '@/lib/finance/types'
import { FinanceAuthorizationError } from '@/lib/finance/policy'
import {
  ALL_PACKAGING_KINDS,
  PackagingFinanceService,
  buildPackFiles,
  createEmptyPackagingStore,
  familyForKind,
  sha256Hex,
  type PackagingFinanceStore,
} from '@/lib/finance/packaging/service'

function actor(uid: string, orgId: string, role: FinanceActorContext['membershipRole'] = 'admin'): FinanceActorContext {
  return {
    uid,
    orgId,
    membershipRole: role,
    membershipActive: true,
    financeModuleEnabled: true,
    assignments:
      role === 'owner' || role === 'admin'
        ? [
            {
              id: 'asg1',
              orgId,
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

function serviceWith(storeRef: { current: PackagingFinanceStore }) {
  return new PackagingFinanceService(
    async () => storeRef.current,
    async (_before, after) => {
      storeRef.current = after
    },
    () => '2026-08-02T12:00:00.000Z',
  )
}

describe('packaging file builders', () => {
  test('every kind builds files with stable digests and hard gates in README/meta', () => {
    for (const kind of ALL_PACKAGING_KINDS) {
      const { files, rowCount } = buildPackFiles(kind, {
        rows: [
          {
            taxPeriod: '2026-07',
            payeMinor: 1,
            uifMinor: 1,
            sdlMinor: 1,
            totalMinor: 3,
            employeeCount: 1,
            reference: 'r1',
            taxYear: '2026',
            emp201TotalMinor: 1,
            certificateTotalMinor: 1,
            differenceMinor: 0,
            status: 'ok',
            certificateKind: 'IRP5',
            employeeId: 'e1',
            taxableIncomeMinor: 1,
            certificateNumber: 'c1',
            beneficiaryName: 'B',
            bankName: 'Bank',
            accountNumber: '1',
            branchCode: '1',
            amountMinor: 100,
            currency: 'ZAR',
            sourceDocumentId: 'd1',
            employeeName: 'Name',
            netPayMinor: 100,
            payRunId: 'pr1',
            accountId: 'a1',
            accountCode: '1000',
            accountName: 'Cash',
            debitMinor: 100,
            creditMinor: 0,
            journalEntryId: 'j1',
            postingDate: '2026-08-01',
            description: 'x',
            openItemId: 'o1',
            counterpartyRole: 'customer',
            counterpartyCompanyId: 'c1',
            originalMinor: 100,
            openMinor: 100,
            dueDate: '2026-08-01',
            sourceType: 'opening',
            eventId: 'ev1',
            occurredAt: '2026-08-01T00:00:00.000Z',
            action: 'journal.post',
            actorId: 'u1',
            resourceType: 'journal',
            resourceId: 'j1',
            summary: 'posted',
          },
        ],
        boxRows: [{ boxCode: '14', label: 'VAT', amountMinor: 1, currency: 'ZAR' }],
        package: { id: 'cut_1', status: 'activated' },
      })
      expect(files.length).toBeGreaterThanOrEqual(1)
      expect(rowCount).toBeGreaterThanOrEqual(1)
      expect(familyForKind(kind)).toMatch(/sars|payment|accountant/)
      for (const file of files) {
        expect(file.sha256).toBe(sha256Hex(file.content))
        expect(file.byteLength).toBeGreaterThan(0)
      }
      const joined = files.map((f) => f.content).join('\n')
      expect(joined).not.toMatch(/sarsSubmissionInitiated": true/)
      expect(joined).not.toMatch(/externalPaymentInitiated": true/)
    }
  })
})

describe('packaging lifecycle', () => {
  test('create → download mark never initiates SARS or payments', async () => {
    const storeRef = { current: createEmptyPackagingStore() }
    const svc = serviceWith(storeRef)
    const admin = actor('u1', 'org_pib')

    const created = await svc.createPack(admin, {
      id: 'pack_1',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      kind: 'sars.emp201',
      payload: {
        rows: [
          {
            taxPeriod: '2026-07',
            payeMinor: 100,
            uifMinor: 10,
            sdlMinor: 5,
            totalMinor: 115,
            employeeCount: 2,
            reference: 'EMP201-1',
          },
        ],
      },
      requestId: 'req-1',
      idempotencyKey: 'idem-1',
    })
    expect(created.status).toBe('ready')
    expect(created.family).toBe('sars')
    expect(created.files.length).toBeGreaterThanOrEqual(2)
    expect(created.manifest.sarsSubmissionInitiated).toBe(false)
    expect(created.manifest.externalPaymentInitiated).toBe(false)
    expect(created.manifest.externalEgressAllowed).toBe(false)
    expect(created.sarsSubmissionInitiated).toBe(false)
    expect(created.externalPaymentInitiated).toBe(false)

    const downloaded = await svc.markDownloaded(admin, {
      id: 'pack_1',
      orgId: 'org_pib',
      requestId: 'req-2',
      idempotencyKey: 'idem-2',
    })
    expect(downloaded.status).toBe('downloaded')
    expect(downloaded.downloadedBy).toBe('u1')
    expect(downloaded.sarsSubmissionInitiated).toBe(false)
    expect(downloaded.externalPaymentInitiated).toBe(false)
  })

  test('payment pack create stays download-only', async () => {
    const storeRef = { current: createEmptyPackagingStore() }
    const svc = serviceWith(storeRef)
    const admin = actor('u1', 'org_pib')
    const pack = await svc.createPack(admin, {
      id: 'pack_pay',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      kind: 'payment.eft_instructions',
      payload: {
        rows: [
          {
            beneficiaryName: 'Vendor',
            bankName: 'FNB',
            accountNumber: '123',
            branchCode: '250655',
            amountMinor: 5000,
            currency: 'ZAR',
            reference: 'B1',
            sourceDocumentId: 'bill_1',
          },
        ],
      },
      requestId: 'req-p',
      idempotencyKey: 'idem-p',
    })
    expect(pack.family).toBe('payment')
    expect(pack.externalPaymentInitiated).toBe(false)
    expect(pack.files.some((f) => f.name === 'eft-batch.csv')).toBe(true)
  })

  test('accountant cutover evidence pack serializes package snapshot', async () => {
    const storeRef = { current: createEmptyPackagingStore() }
    const svc = serviceWith(storeRef)
    const admin = actor('u1', 'org_pib')
    const pack = await svc.createPack(admin, {
      id: 'pack_cut',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      kind: 'accountant.cutover_evidence',
      payload: { package: { id: 'cut_1', status: 'activated', cutoverAt: '2026-08-01' } },
      requestId: 'req-c',
      idempotencyKey: 'idem-c',
    })
    expect(pack.family).toBe('accountant')
    expect(pack.files[0].content).toContain('cut_1')
  })

  test('member without finance role is denied', async () => {
    const storeRef = { current: createEmptyPackagingStore() }
    const svc = serviceWith(storeRef)
    const member = actor('u2', 'org_pib', 'member')
    await expect(
      svc.createPack(member, {
        id: 'pack_x',
        orgId: 'org_pib',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        kind: 'accountant.trial_balance',
        payload: { rows: [] },
        requestId: 'r',
        idempotencyKey: 'i',
      }),
    ).rejects.toBeInstanceOf(FinanceAuthorizationError)
  })
})
