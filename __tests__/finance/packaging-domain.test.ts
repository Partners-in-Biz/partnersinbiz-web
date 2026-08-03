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
import {
  SA_BANK_OPERATOR_NOTICE,
  buildAcbBatchCsv,
  buildAcbBatchTxt,
  buildNetCashBatchCsv,
  buildNetCashBatchTxt,
  minorToDecimalString,
} from '@/lib/finance/packaging/sa-bank-formats'

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

const AP_FIXTURE_ROW = {
  beneficiaryName: 'Vendor Pty',
  bankName: 'FNB',
  accountNumber: '62800123456',
  branchCode: '250655',
  accountType: 1,
  amountMinor: 125050,
  currency: 'ZAR',
  reference: 'BILL-42',
  sourceDocumentId: 'bill_42',
  actionDate: '2026-08-05',
}

const PAYROLL_FIXTURE_ROW = {
  employeeId: 'emp_9',
  employeeName: 'Pat Worker',
  bankName: 'Standard Bank',
  accountNumber: '100200300',
  branchCode: '051001',
  accountType: 1,
  netPayMinor: 3200000,
  currency: 'ZAR',
  payRunId: 'pr_2026_07',
  reference: 'NET-emp_9-2026-07',
  actionDate: '2026-08-05',
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

describe('SA bank format snapshots', () => {
  test('minorToDecimalString is half-cent stable', () => {
    expect(minorToDecimalString(125050)).toBe('1250.50')
    expect(minorToDecimalString(0)).toBe('0.00')
    expect(minorToDecimalString(-105)).toBe('-1.05')
  })

  test('ACB CSV/TXT snapshots for AP fixture', () => {
    const csv = buildAcbBatchCsv([AP_FIXTURE_ROW], { purpose: 'ap', actionDateFallback: '2026-08-05' })
    const txt = buildAcbBatchTxt([AP_FIXTURE_ROW], { purpose: 'ap', actionDateFallback: '2026-08-05' })
    expect(csv.name).toBe('acb-batch.csv')
    expect(txt.name).toBe('acb-batch.txt')
    expect(csv.content).toMatchInlineSnapshot(`
"# ACB-style EFT batch template (ap)
# DOWNLOAD ONLY. Operator must download this file and upload it manually in the banking channel (internet banking / NetCash / ACB batch). Partners in Biz never initiates payments, opens bank sessions, or auto-uploads to banks.
# externalPaymentInitiated=false
RecordType,BranchCode,AccountNumber,AccountType,AmountCents,Amount,ActionDate,BeneficiaryName,StatementReference,OwnReference,BankName,Currency
10,250655,62800123456,1,125050,1250.50,20260805,Vendor Pty,BILL-42,bill_42,FNB,ZAR
"
`)
    expect(txt.content).toMatchInlineSnapshot(`
"H|ACB_TEMPLATE|ap|DOWNLOAD_ONLY|externalPaymentInitiated=false
N|DOWNLOAD ONLY. Operator must download this file and upload it manually in the banking channel (internet banking / NetCash / ACB batch). Partners in Biz never initiates payments, opens bank sessions, or auto-uploads to banks.
D|10|250655|62800123456|1|125050|20260805|Vendor Pty|BILL-42|bill_42|ZAR
T|1|125050|externalPaymentInitiated=false
"
`)
    expect(csv.content).toContain('externalPaymentInitiated=false')
    expect(txt.content).toContain('externalPaymentInitiated=false')
    expect(csv.content).not.toMatch(/externalPaymentInitiated=true/)
  })

  test('NetCash CSV/TXT snapshots for AP fixture', () => {
    const csv = buildNetCashBatchCsv([AP_FIXTURE_ROW], { purpose: 'ap' })
    const txt = buildNetCashBatchTxt([AP_FIXTURE_ROW], { purpose: 'ap' })
    expect(csv.content).toMatchInlineSnapshot(`
"# NetCash-style batch template (ap)
# DOWNLOAD ONLY. Operator must download this file and upload it manually in the banking channel (internet banking / NetCash / ACB batch). Partners in Biz never initiates payments, opens bank sessions, or auto-uploads to banks.
# externalPaymentInitiated=false
Account reference,Name,Branch code,Account number,Account type,Amount,Extra 1,Extra 2,Email notification,Mobile notification
bill_42,Vendor Pty,250655,62800123456,1,1250.50,BILL-42,FNB,,
"
`)
    expect(txt.content).toMatchInlineSnapshot(`
"# NetCash-style TXT (ap) | DOWNLOAD_ONLY | externalPaymentInitiated=false
Account reference,Name,Branch code,Account number,Account type,Amount,Extra 1
bill_42,Vendor Pty,250655,62800123456,1,1250.50,BILL-42
"
`)
  })

  test('payroll prefers netPayMinor in ACB/NetCash builders', () => {
    const csv = buildAcbBatchCsv([PAYROLL_FIXTURE_ROW], {
      purpose: 'payroll',
      preferNetPay: true,
      actionDateFallback: '2026-08-05',
    })
    expect(csv.content).toContain('3200000')
    expect(csv.content).toContain('32000.00')
    expect(csv.content).toContain('Pat Worker')
    const nc = buildNetCashBatchCsv([PAYROLL_FIXTURE_ROW], { purpose: 'payroll', preferNetPay: true })
    expect(nc.content).toContain('32000.00')
    expect(nc.content).toContain('emp_9')
  })

  test('dedicated ACB/NetCash pack kinds embed templates and hard gates', () => {
    for (const kind of [
      'payment.acb_ap',
      'payment.netcash_ap',
      'payment.acb_payroll',
      'payment.netcash_payroll',
      'payment.eft_instructions',
      'payment.payroll_net',
    ] as const) {
      const preferPayroll = kind.includes('payroll')
      const { files } = buildPackFiles(kind, {
        rows: [preferPayroll ? PAYROLL_FIXTURE_ROW : AP_FIXTURE_ROW],
        actionDate: '2026-08-05',
      })
      const names = files.map((f) => f.name)
      if (kind.includes('acb') || kind === 'payment.eft_instructions' || kind === 'payment.payroll_net') {
        expect(names).toEqual(expect.arrayContaining(['acb-batch.csv', 'acb-batch.txt']))
      }
      if (kind.includes('netcash') || kind === 'payment.eft_instructions' || kind === 'payment.payroll_net') {
        expect(names).toEqual(expect.arrayContaining(['netcash-batch.csv', 'netcash-batch.txt']))
      }
      const joined = files.map((f) => f.content).join('\n')
      expect(joined).toContain(SA_BANK_OPERATOR_NOTICE)
      expect(joined).toMatch(/externalPaymentInitiated\": false|externalPaymentInitiated=false/)
      expect(joined).not.toMatch(/externalPaymentInitiated\": true|externalPaymentInitiated=true/)
      expect(joined).toMatch(/bankSessionOpened\": false|DOWNLOAD_ONLY/)
      expect(joined).not.toMatch(/autoUploadToBank\": true/)
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
    expect(pack.files.some((f) => f.name === 'acb-batch.csv')).toBe(true)
    expect(pack.files.some((f) => f.name === 'netcash-batch.csv')).toBe(true)
    expect(pack.manifest.externalPaymentInitiated).toBe(false)
  })

  test('ACB and NetCash dedicated kinds stay externalPaymentInitiated=false', async () => {
    const storeRef = { current: createEmptyPackagingStore() }
    const svc = serviceWith(storeRef)
    const admin = actor('u1', 'org_pib')
    for (const [id, kind] of [
      ['pack_acb_ap', 'payment.acb_ap'],
      ['pack_nc_ap', 'payment.netcash_ap'],
      ['pack_acb_pr', 'payment.acb_payroll'],
      ['pack_nc_pr', 'payment.netcash_payroll'],
    ] as const) {
      const pack = await svc.createPack(admin, {
        id,
        orgId: 'org_pib',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        kind,
        payload: {
          rows: [kind.includes('payroll') ? PAYROLL_FIXTURE_ROW : AP_FIXTURE_ROW],
        },
        requestId: `req-${id}`,
        idempotencyKey: `idem-${id}`,
      })
      expect(pack.externalPaymentInitiated).toBe(false)
      expect(pack.sarsSubmissionInitiated).toBe(false)
      expect(pack.externalEgressAllowed).toBe(false)
      expect(pack.family).toBe('payment')
      const joined = pack.files.map((f) => f.content).join('\n')
      expect(joined).toContain('externalPaymentInitiated')
      expect(joined).not.toMatch(/externalPaymentInitiated\": true|externalPaymentInitiated=true/)
    }
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
