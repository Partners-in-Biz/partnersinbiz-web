import { FinanceValidationError } from '@/lib/accounting/foundation'
import { FinanceNotFoundError } from './errors'
import type { FinanceScope } from './types'

export type RequiredFinanceScope = Required<Pick<FinanceScope, 'orgId' | 'legalEntityId' | 'bookId'>>

function cleanPart(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new FinanceValidationError(`${field} is required`)
  }
  return value.trim()
}

/** Normalize and require the full org/entity/book tuple used by finance writes. */
export function normalizeRequiredFinanceScope(scope: FinanceScope): RequiredFinanceScope {
  return {
    orgId: cleanPart(scope.orgId, 'orgId'),
    legalEntityId: cleanPart(scope.legalEntityId, 'legalEntityId'),
    bookId: cleanPart(scope.bookId, 'bookId'),
  }
}

export function scopesEqual(a: RequiredFinanceScope, b: RequiredFinanceScope): boolean {
  return a.orgId === b.orgId && a.legalEntityId === b.legalEntityId && a.bookId === b.bookId
}

export function matchesExactFinanceScope(
  expected: RequiredFinanceScope,
  actual: { orgId?: string; legalEntityId?: string; bookId?: string | null },
): boolean {
  return (
    actual.orgId === expected.orgId &&
    actual.legalEntityId === expected.legalEntityId &&
    actual.bookId === expected.bookId
  )
}

/**
 * Fail closed with a non-enumerating not-found when a loaded record is out of scope.
 * Callers must not distinguish missing vs cross-tenant for sensitive aggregates.
 */
export function assertExactFinanceScope(
  expected: RequiredFinanceScope,
  actual: { orgId?: string; legalEntityId?: string; bookId?: string | null } | null | undefined,
  resourceLabel: string,
): asserts actual is RequiredFinanceScope {
  if (!actual || !matchesExactFinanceScope(expected, actual)) {
    throw new FinanceNotFoundError(`${resourceLabel} not found`)
  }
}
