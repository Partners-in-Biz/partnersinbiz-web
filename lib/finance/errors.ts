import { FinanceValidationError } from '@/lib/accounting/foundation'
import { FinanceAuthorizationError } from './policy'

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
    error instanceof FinanceValidationError
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
  if (error instanceof FinanceNotFoundError) {
    return { status: error.statusCode, error: error.message, code: 'finance_not_found' }
  }
  if (error instanceof FinanceValidationError) {
    return { status: error.statusCode, error: error.message, code: 'finance_validation' }
  }
  return { status: 500, error: 'Finance request failed', code: 'finance_internal' }
}

export function safeFinanceErrorMessage(error: unknown): string {
  return mapFinanceErrorToHttp(error).error
}
