import { canonicalDigest } from '@/lib/finance/integrity'
import type { FinanceActorContext, FinanceApprovalRecord } from '@/lib/finance/types'
import { FinanceTaxService, InMemoryTaxStore } from '@/lib/accounting/tax-service'
import { ZA_STANDARD_VAT_RATE_BPS } from '@/lib/accounting/tax'
import { HASH_ALGORITHM_VERSION } from '@/lib/finance/integrity'

const now = '2026-07-30T10:00:00.000Z'
const request = (key: string) => ({ requestId: `request-${key}`, idempotencyKey: `idem-${key}` })
const scope = { orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a' }

const actor: FinanceActorContext = {
  uid: 'finance-admin',
  orgId: 'org-a',
  membershipRole: 'owner',
  membershipActive: true,
  financeModuleEnabled: true,
  assignments: [{
    id: 'admin-assignment',
    orgId: 'org-a',
    userId: 'finance-admin',
    legalEntityId: 'entity-a',
    scopeMode: 'entity',
    role: 'finance_admin',
    status: 'active',
  }],
}

const approver: FinanceActorContext = {
  ...actor,
  uid: 'approver',
  membershipRole: 'admin',
  assignments: [{
    ...actor.assignments[0],
    id: 'approver-assignment',
    userId: 'approver',
    role: 'finance_approver',
  }],
}

function approval(partial: Pick<FinanceApprovalRecord, 'id' | 'action' | 'reason'>): FinanceApprovalRecord {
  const base = {
    ...scope,
    id: partial.id,
    schemaVersion: 1 as const,
    action: partial.action,
    status: 'approved' as const,
    approvedBy: approver.uid,
    approverRole: 'finance_approver' as const,
    approverAssignmentId: 'approver-assignment',
    approvedAt: now,
    reason: partial.reason,
    subjectDigest: canonicalDigest({ id: partial.id, action: partial.action }),
    immutable: true as const,
    canonicalPayloadVersion: 1 as const,
    hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
  }
  return { ...base, contentHash: canonicalDigest(base) }
}

describe('finance tax service', () => {
  test('configures ZA VAT code/rule, calculates pinned tax, and locks a return snapshot', async () => {
    const store = new InMemoryTaxStore()
    const service = new FinanceTaxService(store, () => now)

    await service.createTaxCode(actor, {
      ...scope,
      id: 'tax-za-standard',
      code: 'ZA-STD',
      name: 'Standard VAT',
      jurisdictionCode: 'ZA',
      category: 'output_vat',
      recoverability: 'full',
      outputAccountId: 'vat-output',
      active: true,
      expectedVersion: 0,
      ...request('tax-code'),
    })

    service.registerApproval(approval({
      id: 'approve-rule',
      action: 'tax-rule.approve',
      reason: 'ZA VAT package reviewed',
    }))

    const rule = await service.createTaxRuleVersion(actor, {
      ...scope,
      id: 'rule-za-standard-v1',
      taxCodeId: 'tax-za-standard',
      jurisdictionCode: 'ZA',
      versionNumber: 1,
      rateBasisPoints: ZA_STANDARD_VAT_RATE_BPS,
      rateNumerator: 15,
      rateDenominator: 100,
      roundingMode: 'half_up',
      taxPointPolicyId: 'za-invoice',
      effectiveFrom: '2026-07-01',
      sourceCitation: 'SARS VAT standard rate boundary 15%',
      sourceChecksum: 'za-vat-standard-15-v1',
      approvalId: 'approve-rule',
      expectedVersion: 0,
      ...request('tax-rule'),
    })

    expect(rule.immutable).toBe(true)
    expect(rule.rateBasisPoints).toBe(1500)

    const amount = service.calculateTax(actor, {
      ...scope,
      taxCodeId: 'tax-za-standard',
      documentDate: '2026-07-15',
      taxableMinorExclusive: 10_000,
      taxIncluded: false,
    })
    expect(amount.taxMinor).toBe(1_500)
    expect(amount.trace.taxRuleVersionId).toBe(rule.id)

    await service.createTaxPeriod(actor, {
      ...scope,
      id: 'tax-period-2026-07',
      jurisdictionCode: 'ZA',
      label: '2026-07',
      startsAt: '2026-07-01',
      endsAt: '2026-07-31',
      status: 'open',
      expectedVersion: 0,
      ...request('tax-period'),
    })

    service.recordJournalTaxTrace({
      journalEntryId: 'journal-sale',
      taxCodeId: 'tax-za-standard',
      taxRuleVersionId: rule.id,
      category: 'output_vat',
      taxableMinor: 10_000,
      taxMinor: 1_500,
      direction: 'output',
    })
    service.recordJournalTaxTrace({
      journalEntryId: 'journal-purchase',
      taxCodeId: 'tax-za-standard',
      taxRuleVersionId: rule.id,
      category: 'input_vat',
      taxableMinor: 2_000,
      taxMinor: 300,
      direction: 'input',
    })

    const prepared = await service.prepareTaxReturn(actor, {
      ...scope,
      id: 'vat-return-2026-07',
      taxPeriodId: 'tax-period-2026-07',
      sourceCutoffAt: '2026-07-31',
      accountingBasis: 'accrual',
      expectedVersion: 0,
      ...request('tax-return'),
    })
    expect(prepared.outputTaxMinor).toBe(1_500)
    expect(prepared.inputTaxMinor).toBe(300)
    expect(prepared.netTaxMinor).toBe(1_200)
    expect(prepared.inputDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(prepared.sourceJournalEntryIds).toEqual(['journal-purchase', 'journal-sale'])

    service.registerApproval(approval({
      id: 'approve-return',
      action: 'tax.return.approve',
      reason: 'VAT return reviewed',
    }))
    const locked = await service.approveTaxReturn(actor, {
      ...scope,
      taxReturnId: prepared.id,
      expectedVersion: prepared.version,
      approvalId: 'approve-return',
      reason: 'Lock VAT return',
      ...request('tax-return-approve'),
    })
    expect(locked.status).toBe('approved_locked')
    expect(locked.immutable).toBe(true)
    expect(store.taxPeriods.get('tax-period-2026-07')?.status).toBe('approved_locked')
  })

  test('rejects overlapping tax rule versions for the same code', async () => {
    const store = new InMemoryTaxStore()
    const service = new FinanceTaxService(store, () => now)
    await service.createTaxCode(actor, {
      ...scope,
      id: 'tax-za-standard',
      code: 'ZA-STD',
      name: 'Standard VAT',
      jurisdictionCode: 'ZA',
      category: 'output_vat',
      recoverability: 'full',
      active: true,
      expectedVersion: 0,
      ...request('tax-code-2'),
    })
    service.registerApproval(approval({ id: 'approve-rule-1', action: 'tax-rule.approve', reason: 'one' }))
    service.registerApproval(approval({ id: 'approve-rule-2', action: 'tax-rule.approve', reason: 'two' }))
    await service.createTaxRuleVersion(actor, {
      ...scope,
      id: 'rule-1',
      taxCodeId: 'tax-za-standard',
      jurisdictionCode: 'ZA',
      versionNumber: 1,
      rateBasisPoints: 1500,
      rateNumerator: 15,
      rateDenominator: 100,
      roundingMode: 'half_up',
      taxPointPolicyId: 'za-invoice',
      effectiveFrom: '2026-07-01',
      effectiveTo: '2026-12-31',
      sourceCitation: 'v1',
      sourceChecksum: 'v1',
      approvalId: 'approve-rule-1',
      expectedVersion: 0,
      ...request('rule-1'),
    })
    await expect(service.createTaxRuleVersion(actor, {
      ...scope,
      id: 'rule-2',
      taxCodeId: 'tax-za-standard',
      jurisdictionCode: 'ZA',
      versionNumber: 2,
      rateBasisPoints: 1500,
      rateNumerator: 15,
      rateDenominator: 100,
      roundingMode: 'half_up',
      taxPointPolicyId: 'za-invoice',
      effectiveFrom: '2026-12-01',
      sourceCitation: 'v2',
      sourceChecksum: 'v2',
      approvalId: 'approve-rule-2',
      expectedVersion: 0,
      ...request('rule-2'),
    })).rejects.toThrow('overlaps')
  })
})
