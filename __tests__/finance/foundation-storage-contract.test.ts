import fs from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '../..')

describe('finance foundation storage contract', () => {
  test('keeps every foundation, ledger and audit collection server-only', () => {
    const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8')
    for (const collection of [
      'legal_entities', 'finance_branches', 'accounting_books', 'accounting_periods',
      'book_policy_versions', 'finance_calendar_heads', 'finance_idempotency_claims',
      'finance_role_assignments', 'finance_approvals', 'ledger_accounts', 'journal_entries', 'journal_lines',
      'finance_unique_claims', 'finance_sequences', 'finance_audit_events',
      'finance_audit_heads', 'finance_outbox_events',
      'tax_codes', 'tax_rule_versions', 'tax_periods', 'tax_return_snapshots', 'tax_return_lines',
      'financial_report_snapshots',
      'supplier_bills', 'supplier_bill_lines', 'finance_customer_invoices', 'finance_customer_invoice_lines',
      'open_items', 'account_credits', 'finance_payments', 'payment_allocations',
      'bank_accounts', 'bank_transactions', 'reconciliations', 'reconciliation_matches',
      'reconciliation_adjustments',
      'intercompany_pairs', 'intercompany_transactions', 'elimination_rules',
      'consolidation_runs', 'consolidation_entries',
    ]) {
      expect(rules).toContain(`match /${collection}/{id} { allow read, write: if false; }`)
    }
  })

  test('indexes canonical active role-assignment lookup', () => {
    const indexes = JSON.parse(fs.readFileSync(path.join(root, 'firestore.indexes.json'), 'utf8')) as {
      indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string }> }>
    }
    const assignmentIndex = indexes.indexes.find((index) => index.collectionGroup === 'finance_role_assignments')
    expect(assignmentIndex?.fields.map((field) => field.fieldPath)).toEqual(['orgId', 'userId', 'status'])
  })

  test('repository atomically claims posting identity, writes line/audit/outbox evidence and exposes no update/delete path', () => {
    const source = fs.readFileSync(path.join(root, 'lib/accounting/firestore-foundation-repository.ts'), 'utf8')
    expect(source).toContain("this.db.collection('finance_unique_claims')")
    expect(source).toContain("this.db.collection('journal_lines')")
    expect(source).toContain("storageRef(this.db, 'finance_audit_events'")
    expect(source).toContain("storageRef(this.db, 'finance_outbox_events'")
    expect(source).toContain('scopedStorageId(scope, logicalId)')
    expect(source).toContain('externalEgressAllowed: false')
    expect(source).not.toMatch(/\b(update|delete)PostedJournal\b/)
  })
})
