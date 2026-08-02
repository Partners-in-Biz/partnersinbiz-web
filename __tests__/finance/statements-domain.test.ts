import type { FinanceActorContext } from '@/lib/finance/types'
import { FinanceAuthorizationError } from '@/lib/finance/policy'
import { parseAmountToMinor, parseStatementFile } from '@/lib/finance/statements/parse'
import {
  StatementFinanceService,
  createEmptyStatementStore,
  type BankTransactionImporter,
  type StatementFinanceStore,
} from '@/lib/finance/statements/service'

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

function serviceWith(
  storeRef: { current: StatementFinanceStore },
  importer: BankTransactionImporter,
) {
  return new StatementFinanceService(
    async () => storeRef.current,
    async (_before, after) => {
      storeRef.current = after
    },
    importer,
    () => '2026-08-02T15:00:00.000Z',
  )
}

describe('statement file parsers', () => {
  test('parses CSV with header and signed amounts', () => {
    const csv = `date,amount,description,reference
2026-08-01,-100.50,Coffee shop,POS-1
01/08/2026,2500.00,Client payment,INV-9
`
    const { format, lines } = parseStatementFile(csv, 'csv')
    expect(format).toBe('csv')
    expect(lines).toHaveLength(2)
    expect(lines[0].amountMinor).toBe(-10050)
    expect(lines[1].statementDate).toBe('2026-08-01')
    expect(lines[1].amountMinor).toBe(250000)
    expect(lines[0].sourceFingerprint).toHaveLength(64)
  })

  test('parses OFX STMTTRN blocks', () => {
    const ofx = `OFXHEADER:100
<OFX>
<BANKMSGSRSV1>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260801
<TRNAMT>-50.00
<FITID>abc123
<NAME>NETFLIX
<MEMO>Subscription
</STMTTRN>
</BANKMSGSRSV1>
</OFX>`
    const { format, lines } = parseStatementFile(ofx, 'auto')
    expect(format).toBe('ofx')
    expect(lines).toHaveLength(1)
    expect(lines[0].amountMinor).toBe(-5000)
    expect(lines[0].reference).toBe('abc123')
    expect(lines[0].description).toMatch(/NETFLIX/)
  })

  test('parses MT940 :61: lines', () => {
    const mt = `:20:START
:25:123456
:28C:1/1
:61:2608010801D100,00NTRFNONREF//X
:86:Office supplies
:61:260802C2500,00NTRFINV100
:86:Invoice receipt
-`
    const { format, lines } = parseStatementFile(mt, 'mt940')
    expect(format).toBe('mt940')
    expect(lines).toHaveLength(2)
    expect(lines[0].amountMinor).toBe(-10000)
    expect(lines[1].amountMinor).toBe(250000)
  })

  test('parseAmountToMinor handles parentheses negatives', () => {
    expect(parseAmountToMinor('(12.34)')).toBe(-1234)
  })
})

describe('statement import + recon suggestion domain', () => {
  test('parse apply and suggest never auto-post; accept is human-gated', async () => {
    const storeRef = { current: createEmptyStatementStore() }
    const imported: string[] = []
    const importer: BankTransactionImporter = async (input) => {
      imported.push(input.sourceFingerprint)
      return { id: input.id }
    }
    const svc = serviceWith(storeRef, importer)
    const admin = actor('u1', 'org_pib')

    const parsed = await svc.parseStatement(admin, {
      id: 'sib_1',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      bankAccountId: 'bank_1',
      fileName: 'aug.csv',
      contentText: `date,amount,description,reference
2026-08-01,-500.00,Office rent,RENT
2026-08-02,500.00,Client paid,PAY-1
`,
      format: 'csv',
      requestId: 'r1',
      idempotencyKey: 'k1',
    })
    expect(parsed.batch.status).toBe('parsed')
    expect(parsed.batch.externalPaymentInitiated).toBe(false)
    expect(parsed.lines).toHaveLength(2)

    const applied = await svc.applyStatement(admin, {
      id: 'sib_1',
      orgId: 'org_pib',
      requestId: 'r2',
      idempotencyKey: 'k2',
    })
    expect(applied.batch.status).toBe('applied')
    expect(applied.batch.importedCount).toBe(2)
    expect(imported).toHaveLength(2)

    const suggestions = await svc.generateSuggestions(admin, {
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      bankAccountId: 'bank_1',
      bankTransactions: [
        {
          id: 'btx_rent',
          bankAccountId: 'bank_1',
          amountMinor: -50000,
          statementDate: '2026-08-01',
          description: 'Office rent',
          reference: 'RENT',
          reconciliationState: 'unmatched',
        },
        {
          id: 'btx_in',
          bankAccountId: 'bank_1',
          amountMinor: 50000,
          statementDate: '2026-08-02',
          description: 'Client paid',
          reference: 'PAY-1',
          reconciliationState: 'unmatched',
        },
      ],
      payments: [
        {
          id: 'pay_1',
          amountMinor: 50000,
          description: 'Client paid',
          externalReference: 'PAY-1',
          status: 'verified',
        },
      ],
      requestId: 'r3',
      idempotencyKey: 'k3',
    })
    expect(suggestions.autoPosted).toBe(false)
    expect(suggestions.suggestions.length).toBeGreaterThanOrEqual(2)
    const match = suggestions.suggestions.find((s) => s.kind === 'match_payment')
    expect(match?.suggestedPaymentId).toBe('pay_1')
    expect(match?.autoPosted).toBe(false)
    const expense = suggestions.suggestions.find((s) => s.kind === 'propose_expense' || s.kind === 'match_recurring')
    expect(expense?.autoPosted).toBe(false)

    const accepted = await svc.acceptSuggestion(admin, {
      id: match!.id,
      orgId: 'org_pib',
      resolutionNote: 'Looks right',
      requestId: 'r4',
      idempotencyKey: 'k4',
    })
    expect(accepted.status).toBe('accepted')
    expect(accepted.autoPosted).toBe(false)

    await expect(
      svc.acceptSuggestion(admin, {
        id: match!.id,
        orgId: 'org_pib',
        requestId: 'r5',
        idempotencyKey: 'k5',
      }),
    ).rejects.toThrow(/Only pending/)
  })

  test('rejects member without finance role and blocks cross-org read', async () => {
    const storeRef = { current: createEmptyStatementStore() }
    const svc = serviceWith(storeRef, async () => ({ id: 'x' }))
    const member = actor('m1', 'org_pib', 'member')
    await expect(
      svc.parseStatement(member, {
        id: 'sib_x',
        orgId: 'org_pib',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        bankAccountId: 'bank_1',
        fileName: 'a.csv',
        contentText: 'date,amount,description\n2026-08-01,1.00,x\n',
        requestId: 'r',
        idempotencyKey: 'k',
      }),
    ).rejects.toBeInstanceOf(FinanceAuthorizationError)

    storeRef.current.batches.set('sib_seed', {
      id: 'sib_seed',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      bankAccountId: 'bank_1',
      format: 'csv',
      fileName: 'seed.csv',
      contentDigest: 'abc',
      status: 'parsed',
      lineCount: 0,
      importedCount: 0,
      skippedDuplicateCount: 0,
      errorCount: 0,
      createdBy: 'u1',
      createdAt: '2026-08-02T15:00:00.000Z',
      schemaVersion: 1,
      version: 1,
      externalPaymentInitiated: false,
    })
    const other = actor('u2', 'org_other')
    const listed = await svc.listForOrg(other, 'org_other')
    expect(listed.batches).toHaveLength(0)
  })
})
