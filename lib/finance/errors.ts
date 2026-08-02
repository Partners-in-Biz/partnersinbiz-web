import { FinanceValidationError } from '@/lib/accounting/foundation'
import { FinanceAuthorizationError } from './policy'
import {
  PersonalFinanceNotFoundError,
  PersonalFinanceValidationError,
} from '@/lib/finance/personal/service'
import {
  CrossOrgFinanceNotFoundError,
  CrossOrgFinanceValidationError,
} from '@/lib/finance/cross-org/service'
import {
  StatementFinanceNotFoundError,
  StatementFinanceValidationError,
} from '@/lib/finance/statements/service'
import {
  CutoverFinanceNotFoundError,
  CutoverFinanceValidationError,
} from '@/lib/finance/cutover/service'
import {
  PackagingFinanceNotFoundError,
  PackagingFinanceValidationError,
} from '@/lib/finance/packaging/service'
import {
  MultiCurrencyFinanceNotFoundError,
  MultiCurrencyFinanceValidationError,
} from '@/lib/finance/multi-currency/service'
import {
  BankRulesNotFoundError,
  BankRulesValidationError,
} from '@/lib/finance/bank-rules/service'
import {
  BudgetsNotFoundError,
  BudgetsValidationError,
} from '@/lib/finance/budgets/service'

/** Non-enumerating denial for sensitive finance/payroll resources. */
export class FinanceNotFoundError extends Error {
  readonly statusCode = 404
  readonly code = 'finance_not_found' as const

  constructor(message = 'Resource not found') {
    super(message)
    this.name = 'FinanceNotFoundError'
  }
}

export type FinanceHttpErrorBody = {
  status: number
  error: string
  code: 'finance_forbidden' | 'finance_not_found' | 'finance_validation' | 'finance_internal'
}

export function isFinanceHttpError(error: unknown): error is Error & { statusCode: number } {
  return (
    error instanceof FinanceAuthorizationError ||
    error instanceof FinanceNotFoundError ||
    error instanceof FinanceValidationError ||
    error instanceof PersonalFinanceNotFoundError ||
    error instanceof PersonalFinanceValidationError ||
    error instanceof CrossOrgFinanceNotFoundError ||
    error instanceof CrossOrgFinanceValidationError ||
    error instanceof StatementFinanceNotFoundError ||
    error instanceof StatementFinanceValidationError ||
    error instanceof CutoverFinanceNotFoundError ||
    error instanceof CutoverFinanceValidationError ||
    error instanceof PackagingFinanceNotFoundError ||
    error instanceof PackagingFinanceValidationError ||
    error instanceof MultiCurrencyFinanceNotFoundError ||
    error instanceof MultiCurrencyFinanceValidationError
  )
}

/**
 * Map domain errors to safe HTTP responses.
 * Unknown errors never leak stack traces, paths, or internal identifiers.
 */
export function mapFinanceErrorToHttp(error: unknown): FinanceHttpErrorBody {
  if (error instanceof FinanceAuthorizationError) {
    return { status: error.statusCode, error: error.message, code: 'finance_forbidden' }
  }
  if (
    error instanceof FinanceNotFoundError ||
    error instanceof PersonalFinanceNotFoundError ||
    error instanceof CrossOrgFinanceNotFoundError ||
    error instanceof StatementFinanceNotFoundError ||
    error instanceof CutoverFinanceNotFoundError ||
    error instanceof PackagingFinanceNotFoundError ||
    error instanceof MultiCurrencyFinanceNotFoundError
  ) {
    return { status: error.statusCode, error: error.message, code: 'finance_not_found' }
  }
  if (
    error instanceof FinanceValidationError ||
    error instanceof PersonalFinanceValidationError ||
    error instanceof CrossOrgFinanceValidationError ||
    error instanceof StatementFinanceValidationError ||
    error instanceof CutoverFinanceValidationError ||
    error instanceof PackagingFinanceValidationError ||
    error instanceof MultiCurrencyFinanceValidationError
  ) {
    return { status: error.statusCode, error: error.message, code: 'finance_validation' }
  }
  return { status: 500, error: 'Finance request failed', code: 'finance_internal' }
}

export function safeFinanceErrorMessage(error: unknown): string {
  return mapFinanceErrorToHttp(error).error
}
