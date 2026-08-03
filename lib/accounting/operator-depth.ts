import { FinanceValidationError, assertMinorUnits, assertSafeInteger } from './foundation'
import type {
  AllocationPlanLine,
  BulkSelectionPlan,
  MultiAllocatePlan,
  OperatorAdvancedFilters,
  OperatorListResourceKind,
  OverpayMode,
  PeriodCloseBlocker,
  PeriodCloseCommandCentre,
} from './operator-depth-types'

export const OPERATOR_BULK_MAX_TARGETS = 50

export function normalizeOperatorFilters(input: OperatorAdvancedFilters | null | undefined): OperatorAdvancedFilters {
  const filters: OperatorAdvancedFilters = {}
  if (!input) return filters
  if (input.status?.trim()) filters.status = input.status.trim()
  if (Array.isArray(input.statuses) && input.statuses.length > 0) {
    filters.statuses = [...new Set(input.statuses.map((s) => String(s).trim()).filter(Boolean))]
  }
  if (input.counterpartyCompanyId?.trim()) filters.counterpartyCompanyId = input.counterpartyCompanyId.trim()
  if (input.fromDate?.trim()) filters.fromDate = input.fromDate.trim()
  if (input.toDate?.trim()) filters.toDate = input.toDate.trim()
  if (input.documentNumberContains?.trim()) filters.documentNumberContains = input.documentNumberContains.trim()
  if (input.referenceContains?.trim()) filters.referenceContains = input.referenceContains.trim()
  if (input.currency?.trim()) filters.currency = input.currency.trim().toUpperCase()
  if (input.direction === 'receipt' || input.direction === 'disbursement') filters.direction = input.direction
  if (input.periodId?.trim()) filters.periodId = input.periodId.trim()
  if (input.sourceType?.trim()) filters.sourceType = input.sourceType.trim()
  if (input.query?.trim()) filters.query = input.query.trim()
  if (input.unallocatedOnly === true) filters.unallocatedOnly = true
  for (const key of ['minOutstandingMinor', 'maxOutstandingMinor', 'minAmountMinor', 'maxAmountMinor'] as const) {
    const value = input[key]
    if (value === undefined || value === null) continue
    assertMinorUnits(value as number, key)
    filters[key] = value as number
  }
  if (
    filters.minOutstandingMinor !== undefined &&
    filters.maxOutstandingMinor !== undefined &&
    filters.minOutstandingMinor > filters.maxOutstandingMinor
  ) {
    throw new FinanceValidationError('minOutstandingMinor cannot exceed maxOutstandingMinor')
  }
  if (
    filters.minAmountMinor !== undefined &&
    filters.maxAmountMinor !== undefined &&
    filters.minAmountMinor > filters.maxAmountMinor
  ) {
    throw new FinanceValidationError('minAmountMinor cannot exceed maxAmountMinor')
  }
  if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) {
    throw new FinanceValidationError('fromDate cannot be after toDate')
  }
  return filters
}

function rowTextBlob(row: Record<string, unknown>): string {
  return [
    row.documentNumber,
    row.number,
    row.reference,
    row.description,
    row.memo,
    row.customerCompanyId,
    row.supplierCompanyId,
    row.counterpartyCompanyId,
    row.id,
  ]
    .filter((v) => typeof v === 'string')
    .join(' ')
    .toLowerCase()
}

export function applyAdvancedOperatorFilters<T extends Record<string, any>>(
  rows: readonly T[],
  rawFilters: OperatorAdvancedFilters | null | undefined,
): T[] {
  const filters = normalizeOperatorFilters(rawFilters)
  return rows.filter((row) => {
    if (filters.status && row.status !== filters.status) return false
    if (filters.statuses && filters.statuses.length > 0 && !filters.statuses.includes(String(row.status || ''))) {
      return false
    }
    const counterparty = row.customerCompanyId || row.supplierCompanyId || row.counterpartyCompanyId
    if (filters.counterpartyCompanyId && counterparty !== filters.counterpartyCompanyId) return false
    const date = row.issueDate || row.dueDate || row.effectiveDate || row.postingDate || row.date || row.createdAt
    if (filters.fromDate && typeof date === 'string' && date.slice(0, 10) < filters.fromDate) return false
    if (filters.toDate && typeof date === 'string' && date.slice(0, 10) > filters.toDate) return false
    if (filters.documentNumberContains) {
      const needle = filters.documentNumberContains.toLowerCase()
      const hay = String(row.documentNumber || row.number || row.id || '').toLowerCase()
      if (!hay.includes(needle)) return false
    }
    if (filters.referenceContains) {
      const needle = filters.referenceContains.toLowerCase()
      const hay = String(row.reference || row.description || row.memo || '').toLowerCase()
      if (!hay.includes(needle)) return false
    }
    if (filters.query) {
      if (!rowTextBlob(row).includes(filters.query.toLowerCase())) return false
    }
    if (filters.currency && String(row.currency || '').toUpperCase() !== filters.currency) return false
    if (filters.direction && row.direction !== filters.direction) return false
    if (filters.periodId && row.periodId !== filters.periodId) return false
    if (filters.sourceType && row.sourceType !== filters.sourceType) return false
    if (filters.unallocatedOnly === true) {
      const unallocated = typeof row.unallocatedMinor === 'number' ? row.unallocatedMinor : undefined
      if (!(typeof unallocated === 'number' && unallocated > 0)) return false
    }
    const outstanding = typeof row.outstandingMinor === 'number' ? row.outstandingMinor : undefined
    if (filters.minOutstandingMinor !== undefined) {
      if (typeof outstanding !== 'number' || outstanding < filters.minOutstandingMinor) return false
    }
    if (filters.maxOutstandingMinor !== undefined) {
      if (typeof outstanding !== 'number' || outstanding > filters.maxOutstandingMinor) return false
    }
    const amount =
      typeof row.amountMinor === 'number'
        ? row.amountMinor
        : typeof row.totalMinor === 'number'
          ? row.totalMinor
          : typeof row.grossMinor === 'number'
            ? row.grossMinor
            : undefined
    if (filters.minAmountMinor !== undefined) {
      if (typeof amount !== 'number' || amount < filters.minAmountMinor) return false
    }
    if (filters.maxAmountMinor !== undefined) {
      if (typeof amount !== 'number' || amount > filters.maxAmountMinor) return false
    }
    return true
  })
}

export function selectAllFilteredIds(
  rows: readonly { id: string }[],
  filters: OperatorAdvancedFilters | null | undefined,
  maxTargets = OPERATOR_BULK_MAX_TARGETS,
): BulkSelectionPlan {
  assertSafeInteger(maxTargets, 'maxTargets', 1)
  if (maxTargets > OPERATOR_BULK_MAX_TARGETS) {
    throw new FinanceValidationError(`maxTargets cannot exceed ${OPERATOR_BULK_MAX_TARGETS}`)
  }
  const filtered = applyAdvancedOperatorFilters(rows as any, filters)
  const selectedIds = filtered.slice(0, maxTargets).map((row) => row.id)
  return {
    action: 'bulk_issue',
    resourceKind: 'ar_documents',
    selectAllFiltered: true,
    filteredCount: filtered.length,
    selectedIds,
    capped: filtered.length > selectedIds.length,
    maxTargets,
  }
}

export function buildBulkSelectionPlan(input: {
  action: BulkSelectionPlan['action']
  resourceKind: OperatorListResourceKind
  rows: readonly { id: string; status?: string }[]
  filters?: OperatorAdvancedFilters | null
  explicitIds?: string[]
  selectAllFiltered?: boolean
  maxTargets?: number
}): BulkSelectionPlan {
  const maxTargets = input.maxTargets ?? OPERATOR_BULK_MAX_TARGETS
  assertSafeInteger(maxTargets, 'maxTargets', 1)
  if (maxTargets > OPERATOR_BULK_MAX_TARGETS) {
    throw new FinanceValidationError(`maxTargets cannot exceed ${OPERATOR_BULK_MAX_TARGETS}`)
  }
  if (input.selectAllFiltered) {
    const base = selectAllFilteredIds(input.rows, input.filters, maxTargets)
    return { ...base, action: input.action, resourceKind: input.resourceKind }
  }
  const explicit = [...new Set((input.explicitIds || []).filter(Boolean))]
  if (explicit.length === 0) throw new FinanceValidationError('Bulk selection requires ids or selectAllFiltered')
  if (explicit.length > maxTargets) throw new FinanceValidationError(`Bulk selection limited to ${maxTargets} targets`)
  const allowed = new Set(input.rows.map((r) => r.id))
  for (const id of explicit) {
    if (!allowed.has(id)) throw new FinanceValidationError(`Selected id not in list scope: ${id}`)
  }
  return {
    action: input.action,
    resourceKind: input.resourceKind,
    selectAllFiltered: false,
    filteredCount: explicit.length,
    selectedIds: explicit,
    capped: false,
    maxTargets,
  }
}

export function planMultiDocumentAllocation(input: {
  paymentId: string
  paymentUnallocatedMinor: number
  targets: ReadonlyArray<{
    targetType: 'customer_invoice' | 'supplier_bill' | 'open_item'
    targetId: string
    outstandingMinor: number
    openItemId?: string
    discountMinor?: number
    writeOffMinor?: number
  }>
  overpayMode?: OverpayMode
}): MultiAllocatePlan {
  const overpayMode: OverpayMode = input.overpayMode || 'on_account'
  assertMinorUnits(input.paymentUnallocatedMinor, 'paymentUnallocatedMinor')
  if (input.paymentUnallocatedMinor <= 0) {
    throw new FinanceValidationError('paymentUnallocatedMinor must be positive for multi-allocate')
  }
  if (!Array.isArray(input.targets) || input.targets.length === 0) {
    throw new FinanceValidationError('multi-allocate requires at least one target')
  }
  if (input.targets.length > OPERATOR_BULK_MAX_TARGETS) {
    throw new FinanceValidationError(`multi-allocate limited to ${OPERATOR_BULK_MAX_TARGETS} targets`)
  }

  let remaining = input.paymentUnallocatedMinor
  const lines: AllocationPlanLine[] = []

  for (const target of input.targets) {
    if (remaining <= 0) break
    assertMinorUnits(target.outstandingMinor, 'outstandingMinor')
    if (target.outstandingMinor <= 0) {
      throw new FinanceValidationError('Cannot allocate to a fully settled target')
    }
    const discountMinor = target.discountMinor ?? 0
    const writeOffMinor = target.writeOffMinor ?? 0
    assertMinorUnits(discountMinor, 'discountMinor')
    assertMinorUnits(writeOffMinor, 'writeOffMinor')
    const maxAgainstOpen = target.outstandingMinor - discountMinor - writeOffMinor
    if (maxAgainstOpen <= 0) {
      throw new FinanceValidationError('discount/write-off leave no room for cash allocation')
    }
    const allocatedMinor = Math.min(remaining, maxAgainstOpen)
    if (allocatedMinor <= 0) continue
    lines.push({
      targetType: target.targetType,
      targetId: target.targetId,
      allocatedMinor,
      discountMinor,
      writeOffMinor,
      ...(target.openItemId ? { openItemId: target.openItemId } : {}),
    })
    remaining -= allocatedMinor
  }

  if (remaining > 0) {
    if (overpayMode === 'reject') {
      throw new FinanceValidationError('Allocation leaves payment overpay remainder; reject mode forbids surplus')
    }
    if (overpayMode === 'on_account') {
      lines.push({
        targetType: 'on_account',
        targetId: input.paymentId,
        allocatedMinor: remaining,
        discountMinor: 0,
        writeOffMinor: 0,
      })
      remaining = 0
    }
    // leave_unallocated keeps remainder on the payment
  }

  if (lines.length === 0) {
    throw new FinanceValidationError('No allocation lines produced')
  }

  const allocatedTotalMinor = lines.reduce((sum, line) => sum + line.allocatedMinor, 0)
  return {
    paymentId: input.paymentId,
    lines,
    allocatedTotalMinor,
    remainderMinor: remaining,
    overpayMode,
    externalPaymentInitiated: false,
  }
}

export function planPartialAllocation(input: {
  paymentId: string
  paymentUnallocatedMinor: number
  targetType: 'customer_invoice' | 'supplier_bill' | 'open_item'
  targetId: string
  outstandingMinor: number
  allocatedMinor: number
  discountMinor?: number
  writeOffMinor?: number
  openItemId?: string
}): MultiAllocatePlan {
  assertMinorUnits(input.paymentUnallocatedMinor, 'paymentUnallocatedMinor')
  assertMinorUnits(input.outstandingMinor, 'outstandingMinor')
  assertSafeInteger(input.allocatedMinor, 'allocatedMinor', 1)
  if (input.allocatedMinor > input.paymentUnallocatedMinor) {
    throw new FinanceValidationError('Allocation exceeds payment unallocated amount')
  }
  const discountMinor = input.discountMinor ?? 0
  const writeOffMinor = input.writeOffMinor ?? 0
  if (input.allocatedMinor + discountMinor + writeOffMinor > input.outstandingMinor) {
    throw new FinanceValidationError('Allocation exceeds open item outstanding amount')
  }
  return {
    paymentId: input.paymentId,
    lines: [
      {
        targetType: input.targetType,
        targetId: input.targetId,
        allocatedMinor: input.allocatedMinor,
        discountMinor,
        writeOffMinor,
        ...(input.openItemId ? { openItemId: input.openItemId } : {}),
      },
    ],
    allocatedTotalMinor: input.allocatedMinor,
    remainderMinor: input.paymentUnallocatedMinor - input.allocatedMinor,
    overpayMode: 'leave_unallocated',
    externalPaymentInitiated: false,
  }
}

function portalPath(path: string, orgId: string, legalEntityId: string, bookId: string): string {
  const q = new URLSearchParams({ orgId, legalEntityId, bookId })
  return `${path}?${q.toString()}`
}

export function buildPeriodCloseCommandCentre(input: {
  orgId: string
  legalEntityId: string
  bookId: string
  asOfDate: string
  periodId?: string
  periodLabel?: string
  reconciliations?: ReadonlyArray<{ id: string; status?: string }>
  journals?: ReadonlyArray<{ id: string; status?: string; approvalStatus?: string }>
  payRuns?: ReadonlyArray<{ id: string; status?: string }>
  fxRevaluationRuns?: ReadonlyArray<{ id: string; status?: string; periodId?: string; asOfDate?: string }>
  cutoverPackages?: ReadonlyArray<{ id: string; status?: string }>
  requireFxReval?: boolean
  requireCutoverComplete?: boolean
}): PeriodCloseCommandCentre {
  const { orgId, legalEntityId, bookId } = input
  const blockers: PeriodCloseBlocker[] = []

  const unreconciled = (input.reconciliations || []).filter((r) => {
    const status = String(r.status || '').toLowerCase()
    return status && !['approved', 'approved_locked', 'closed', 'complete', 'completed'].includes(status)
  })
  if (unreconciled.length > 0) {
    blockers.push({
      code: 'unreconciled_bank',
      severity: 'blocker',
      title: 'Unreconciled bank statements',
      detail: `${unreconciled.length} reconciliation(s) still open or unapproved`,
      count: unreconciled.length,
      href: portalPath('/portal/finance/statements', orgId, legalEntityId, bookId),
      itemIds: unreconciled.map((r) => r.id),
    })
  }

  const unapprovedJournals = (input.journals || []).filter((j) => {
    const status = String(j.status || '').toLowerCase()
    const approval = String(j.approvalStatus || '').toLowerCase()
    if (['posted', 'reversed', 'voided'].includes(status)) return false
    if (status === 'draft' || status === 'pending' || status === 'in_review') return true
    if (approval === 'pending' || approval === 'required') return true
    return status === 'proposed' || status === 'awaiting_approval'
  })
  if (unapprovedJournals.length > 0) {
    blockers.push({
      code: 'unapproved_journals',
      severity: 'blocker',
      title: 'Unapproved or unposted journals',
      detail: `${unapprovedJournals.length} journal(s) still draft/pending approval`,
      count: unapprovedJournals.length,
      href: portalPath('/portal/finance/ledger', orgId, legalEntityId, bookId),
      itemIds: unapprovedJournals.map((j) => j.id),
    })
  }

  const openPayRuns = (input.payRuns || []).filter((run) => {
    const status = String(run.status || '').toLowerCase()
    return !['approved_locked', 'locked', 'reversed', 'cancelled', 'voided'].includes(status)
  })
  if (openPayRuns.length > 0) {
    blockers.push({
      code: 'open_pay_runs',
      severity: 'blocker',
      title: 'Open payroll runs',
      detail: `${openPayRuns.length} pay run(s) not locked/approved`,
      count: openPayRuns.length,
      href: portalPath('/portal/finance/payroll', orgId, legalEntityId, bookId),
      itemIds: openPayRuns.map((r) => r.id),
    })
  }

  if (input.requireFxReval) {
    const approvedFx = (input.fxRevaluationRuns || []).filter((run) => {
      const status = String(run.status || '').toLowerCase()
      if (!['approved', 'approved_locked', 'posted'].includes(status)) return false
      if (input.periodId && run.periodId && run.periodId !== input.periodId) return false
      return true
    })
    if (approvedFx.length === 0) {
      blockers.push({
        code: 'missing_fx_reval',
        severity: 'blocker',
        title: 'Missing FX revaluation',
        detail: 'No approved FX revaluation run for this close scope',
        count: 1,
        href: portalPath('/portal/finance/multi-currency', orgId, legalEntityId, bookId),
        itemIds: [],
      })
    }
  }

  if (input.requireCutoverComplete) {
    const complete = (input.cutoverPackages || []).some((p) =>
      ['activated', 'complete', 'completed', 'approved'].includes(String(p.status || '').toLowerCase()),
    )
    if (!complete) {
      blockers.push({
        code: 'incomplete_cutover',
        severity: 'warning',
        title: 'Cutover incomplete',
        detail: 'Opening balances / cutover package not activated for this book',
        count: 1,
        href: portalPath('/portal/finance/cutover', orgId, legalEntityId, bookId),
        itemIds: (input.cutoverPackages || []).map((p) => p.id),
      })
    }
  }

  const blockerCount = blockers.filter((b) => b.severity === 'blocker').length
  const warningCount = blockers.filter((b) => b.severity === 'warning').length
  return {
    orgId,
    legalEntityId,
    bookId,
    ...(input.periodId ? { periodId: input.periodId } : {}),
    ...(input.periodLabel ? { periodLabel: input.periodLabel } : {}),
    asOfDate: input.asOfDate,
    blockers,
    blockerCount,
    warningCount,
    readyToClose: blockerCount === 0,
    externalPaymentInitiated: false,
    sarsSubmissionInitiated: false,
    externalEgressAllowed: false,
  }
}

export function assertSavedViewName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) throw new FinanceValidationError('Saved view name is required')
  const cleaned = name.trim()
  if (cleaned.length > 80) throw new FinanceValidationError('Saved view name max length is 80')
  return cleaned
}

export function assertOperatorResourceKind(value: unknown): OperatorListResourceKind {
  const allowed: OperatorListResourceKind[] = [
    'ar_documents',
    'ap_documents',
    'ledger_journals',
    'payments',
    'open_items',
  ]
  if (typeof value !== 'string' || !allowed.includes(value as OperatorListResourceKind)) {
    throw new FinanceValidationError('Invalid operator list resourceKind')
  }
  return value as OperatorListResourceKind
}
