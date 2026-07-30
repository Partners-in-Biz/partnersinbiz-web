import fs from 'node:fs'
import path from 'node:path'

const architecturePath = path.join(
  process.cwd(),
  'docs/architecture/finance-accounting-payroll-data-model.md',
)

function architecture(): string {
  return fs.readFileSync(architecturePath, 'utf8')
}

describe('finance, accounting, and payroll architecture contract', () => {
  it('publishes the implementation-ready architecture document', () => {
    expect(fs.existsSync(architecturePath)).toBe(true)
  })

  it('records the canonical sources and inspected baseline', () => {
    const content = architecture()
    expect(content).toContain('Flie3SblIDXvplYmqOhy')
    expect(content).toContain('planning-discovery revision 12')
    expect(content).toContain('Existing application inventory')
    expect(content).toContain('Compatibility boundaries')
  })

  it('defines all required accounting and payroll aggregates', () => {
    const content = architecture()
    const requiredTerms = [
      'legal_entities',
      'finance_branches',
      'accounting_books',
      'ledger_accounts',
      'journal_entries',
      'journal_lines',
      'tax_codes',
      'bank_transactions',
      'reconciliations',
      'intercompany_pairs',
      'payroll_employees',
      'pay_runs',
      'payslips',
      'payroll_rule_versions',
      'finance_audit_events',
      'finance_audit_heads',
      'finance_outbox_events',
      'finance_unique_claims',
      'open_items',
      'account_credits',
      'reconciliation_adjustments',
      'book_policy_versions',
      'tax_periods',
      'tax_return_snapshots',
      'accounting_rate_sets',
      'payroll_tax_years',
      'payroll_calculation_manifests',
    ]

    for (const term of requiredTerms) expect(content).toContain(term)
  })

  it('states the non-negotiable finance invariants', () => {
    const content = architecture()
    const requiredInvariants = [
      'debits equal credits',
      'minor units',
      'immutable after posting',
      'locked payroll run',
      'orgId + legalEntityId + bookId',
      'No automatic external payment initiation',
      'No direct SARS submission or payment',
      'transactionally',
      'external egress disabled',
      'Missing scope means no access',
    ]

    for (const invariant of requiredInvariants) expect(content).toContain(invariant)
  })

  it('defines an append-only journal reversal lifecycle', () => {
    const content = architecture()

    expect(content).toContain('status: draft | pending_approval | posted`')
    expect(content).not.toContain('status: draft | pending_approval | posted | reversed`')
    expect(content).toContain('original entry remains `posted`')
    expect(content).toContain('derived reversal projection')
    expect(content).toContain(
      'separate balanced reversal entry in an open correction period, with equal-and-opposite lines, `status: posted`, and `reversesJournalEntryId` pointing to the original posted entry',
    )
  })

  it('contains an additive migration, affected-file map, security model, and test plan', () => {
    const content = architecture()
    expect(content).toContain('Additive migration strategy')
    expect(content).toContain('Affected files and modules')
    expect(content).toContain('Authorization matrix')
    expect(content).toContain('Test plan')
    expect(content).toContain('Rollback and compatibility')
    expect(content).toContain('DCAh9tNOlloqSOwYSUP2')
    expect(content).toContain('Legacy PayPal routes remain outside the new finance/payroll contract')
  })
})
