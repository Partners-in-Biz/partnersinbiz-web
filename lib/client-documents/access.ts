import { apiError } from '@/lib/api/response'
import { resolveOrgScope } from '@/lib/api/orgScope'
import type { ApiUser } from '@/lib/api/types'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

import { getClientDocument } from './store'
import type { ClientDocument, ClientDocumentStatus } from './types'

const CLIENT_VISIBLE_STATUSES = new Set<ClientDocumentStatus>([
  'client_review',
  'changes_requested',
  'approved',
  'accepted',
])

function userOrgIds(user: ApiUser): string[] {
  return user.orgIds?.length ? user.orgIds : (user.orgId ? [user.orgId] : [])
}

function isPlatformLinkedClientVisible(document: Partial<ClientDocument>, user: ApiUser): boolean {
  if (user.role !== 'client') return false
  if (document.orgId !== PIB_PLATFORM_ORG_ID) return false
  if (!document.status || !CLIENT_VISIBLE_STATUSES.has(document.status)) return false
  const linkedClientOrgId = document.linked?.clientOrgId
  return Boolean(linkedClientOrgId && userOrgIds(user).includes(linkedClientOrgId))
}

export function assertClientDocumentDataAccess(document: Partial<ClientDocument>, user: ApiUser) {
  if (isPlatformLinkedClientVisible(document, user)) {
    return { ok: true as const }
  }

  if (!document.orgId) {
    if (user.role === 'client') return { ok: false as const, response: apiError('Forbidden', 403) }
    return { ok: true as const }
  }

  const scope = resolveOrgScope(user, document.orgId)
  if (!scope.ok) return { ok: false as const, response: apiError(scope.error, scope.status) }

  return { ok: true as const }
}

export async function getAccessibleClientDocument(id: string, user: ApiUser) {
  const document = await getClientDocument(id)
  if (!document) return { ok: false as const, response: apiError('Document not found', 404) }

  const access = assertClientDocumentDataAccess(document, user)
  if (!access.ok) return access

  return { ok: true as const, document }
}

export function isClientVisibleClientDocument(document: Pick<ClientDocument, 'status'>): boolean {
  return CLIENT_VISIBLE_STATUSES.has(document.status)
}
