import type { ClientDocument } from './types'

export function isDocumentPreviewableInOrg(doc: Pick<ClientDocument, 'orgId' | 'linked'>, orgId: string): boolean {
  return doc.orgId === orgId || doc.linked?.clientOrgId === orgId
}

export function getDocumentPreviewOrgIds(doc: Pick<ClientDocument, 'orgId' | 'linked'>): string[] {
  return Array.from(new Set([doc.orgId, doc.linked?.clientOrgId].filter(Boolean) as string[]))
}
