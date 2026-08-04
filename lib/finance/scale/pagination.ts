/** Shared finance list pagination helpers (server filters + safe caps). */

export const FINANCE_DEFAULT_PAGE_LIMIT = 100
export const FINANCE_MAX_PAGE_LIMIT = 500
/** Hard ceiling for statement import lines in one batch (world-class target ≥10k). */
export const STATEMENT_IMPORT_MAX_LINES = 20_000
/** Default lines returned to UI/API consumers to avoid DOM death. */
export const STATEMENT_LINES_UI_DEFAULT = 100
/** Preview lines returned from parse/apply command responses. */
export const STATEMENT_LINES_RESPONSE_PREVIEW = 200

export interface PageOpts {
  limit?: number
  offset?: number
  /** Absolute max; defaults to FINANCE_MAX_PAGE_LIMIT */
  maxLimit?: number
  defaultLimit?: number
}

export interface PageResult<T> {
  items: T[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
  nextOffset: number | null
}

export function normalizePageOpts(opts?: PageOpts): { limit: number; offset: number } {
  const maxLimit = opts?.maxLimit ?? FINANCE_MAX_PAGE_LIMIT
  const defaultLimit = opts?.defaultLimit ?? FINANCE_DEFAULT_PAGE_LIMIT
  const rawLimit = opts?.limit
  const limit =
    typeof rawLimit === 'number' && Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), maxLimit)
      : defaultLimit
  const rawOffset = opts?.offset
  const offset =
    typeof rawOffset === 'number' && Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0
  return { limit, offset }
}

export function paginateArray<T>(items: readonly T[], opts?: PageOpts): PageResult<T> {
  const { limit, offset } = normalizePageOpts(opts)
  const total = items.length
  const sliced = items.slice(offset, offset + limit)
  const nextOffset = offset + sliced.length
  return {
    items: sliced,
    total,
    limit,
    offset,
    hasMore: nextOffset < total,
    nextOffset: nextOffset < total ? nextOffset : null,
  }
}

export function parsePositiveInt(value: string | null | undefined, fallback: number): number {
  if (value == null || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.trunc(n)
}
