import {
  CLIENT_VISIBILITY_FIELD,
  type ClientVisibility,
  type WorkOwnerKind,
  type WorkScope,
  type WorkScopeRecord,
} from './types'

export {
  CLIENT_VISIBILITY_FIELD,
  type ClientVisibility,
  type WorkOwnerKind,
  type WorkScope,
  type WorkScopeRecord,
}

export const PERSONAL_SCOPE = 'personal'
export const ORG_SCOPE = 'org'

function cleanScopeId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function recordCompanyId(record: { companyId?: unknown }): string {
  return cleanScopeId(record.companyId)
}

function isPersonalRecord(record: WorkScopeRecord): boolean {
  return record.accountScope === PERSONAL_SCOPE
}

/**
 * Resolve work scope from query/body values.
 * `companyId` and `sourceCompanyId` are aliases (portal uses sourceCompanyId;
 * APIs use companyId via scopedApiPath).
 */
export function resolveWorkScope(input: {
  personal?: boolean
  scope?: unknown
  companyId?: unknown
  sourceCompanyId?: unknown
  uid?: string
}): WorkScope {
  if (input.personal || cleanScopeId(input.scope) === PERSONAL_SCOPE) {
    const uid = cleanScopeId(input.uid)
    return { owner: 'personal', ...(uid ? { uid } : {}) }
  }
  const companyId = cleanScopeId(input.companyId) || cleanScopeId(input.sourceCompanyId)
  if (companyId) return { owner: 'company', companyId }
  return { owner: 'org' }
}

export function resolveWorkScopeFromSearchParams(
  searchParams: URLSearchParams,
  uid?: string,
): WorkScope {
  return resolveWorkScope({
    personal: searchParams.get('scope') === PERSONAL_SCOPE,
    scope: searchParams.get('scope'),
    companyId: searchParams.get('companyId'),
    sourceCompanyId: searchParams.get('sourceCompanyId'),
    uid,
  })
}

/** Accept body fields on create/patch as well as query aliases. */
export function resolveWorkScopeFromRequest(input: {
  searchParams?: URLSearchParams | null
  body?: Record<string, unknown> | null
  uid?: string
}): WorkScope {
  const body = input.body ?? {}
  const params = input.searchParams
  return resolveWorkScope({
    personal: body.personal === true
      || cleanScopeId(body.scope) === PERSONAL_SCOPE
      || params?.get('scope') === PERSONAL_SCOPE,
    scope: body.scope ?? params?.get('scope'),
    companyId: body.companyId ?? params?.get('companyId'),
    sourceCompanyId: body.sourceCompanyId ?? params?.get('sourceCompanyId'),
    uid: input.uid,
  })
}

/**
 * Stamp fields for writes. Keeps `marketingOwner` as a legacy alias so
 * existing marketing readers keep working; also writes `workOwner`.
 */
export function workScopeFieldsForWrite(scope: WorkScope): Record<string, unknown> {
  if (scope.owner === 'personal') {
    const uid = cleanScopeId(scope.uid)
    return {
      accountScope: PERSONAL_SCOPE,
      workOwner: 'personal',
      marketingOwner: 'personal',
      ...(uid ? { ownerUid: uid } : {}),
    }
  }
  if (scope.owner === 'company' && scope.companyId) {
    return {
      workOwner: 'company',
      marketingOwner: 'company',
      companyId: scope.companyId,
    }
  }
  return { workOwner: 'org', marketingOwner: 'org' }
}

export function companyFieldsForWrite(companyId?: unknown): Record<string, unknown> {
  const id = cleanScopeId(companyId)
  return id
    ? { companyId: id, workOwner: 'company', marketingOwner: 'company' }
    : { workOwner: 'org', marketingOwner: 'org' }
}

/**
 * List visibility.
 *
 * - personal: only the owner's personal rows
 * - company: only rows stamped with that companyId
 * - org (default): org rows AND company-scoped rows (with a company badge in UI).
 *   Pass `orgViewIncludesCompany: false` to hide company-stamped rows
 *   (social accounts keep this false — publish identities must not leak).
 */
export function recordVisibleForWorkScope(
  record: WorkScopeRecord,
  scope: WorkScope,
  options: { orgViewIncludesCompany?: boolean } = {},
): boolean {
  const orgViewIncludesCompany = options.orgViewIncludesCompany !== false
  if (scope.owner === 'personal') {
    return isPersonalRecord(record) && cleanScopeId(record.ownerUid) === cleanScopeId(scope.uid)
  }
  if (isPersonalRecord(record)) return false
  if (scope.owner === 'company') {
    const companyId = cleanScopeId(scope.companyId)
    return Boolean(companyId) && recordCompanyId(record) === companyId
  }
  if (!orgViewIncludesCompany && recordCompanyId(record)) return false
  return true
}

export function parseClientVisibility(value: unknown): ClientVisibility {
  return value === 'private' ? 'private' : 'shared'
}

/** Unset / missing = shared (default share with linked org). */
export function isClientPrivate(record: { clientVisibility?: unknown }): boolean {
  return parseClientVisibility(record.clientVisibility) === 'private'
}

export function isClientShared(record: { clientVisibility?: unknown }): boolean {
  return !isClientPrivate(record)
}

export function clientVisibilityFieldsForWrite(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null || value === '') return {}
  return { [CLIENT_VISIBILITY_FIELD]: parseClientVisibility(value) }
}

export function brandKitDocId(orgId: string, scope: WorkScope): string {
  const home = orgId.trim()
  if (!home) return ''
  if (scope.owner === 'personal') {
    const uid = cleanScopeId(scope.uid)
    return uid ? `${home}__personal_${uid}` : home
  }
  if (scope.owner === 'company') {
    const companyId = cleanScopeId(scope.companyId)
    return companyId ? `${home}__company_${companyId}` : home
  }
  return home
}
