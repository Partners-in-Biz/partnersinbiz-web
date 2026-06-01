import type { ClientDocument } from './types'

export function isDocumentPreviewableInOrg(doc: Pick<ClientDocument, 'orgId' | 'linked'>, orgId: string): boolean {
  return doc.orgId === orgId || doc.linked?.clientOrgId === orgId
}
