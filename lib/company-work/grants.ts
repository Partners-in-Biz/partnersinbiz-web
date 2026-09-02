/**
 * Canonical company_workspace PartnerResourceGrant helpers.
 * One grant per linked company per direction. items[] = module capability keys.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { SharedBusinessCapability } from '@/lib/business-relationships/types'
import {
  CROSS_ORG_SCHEMA_VERSION,
  PARTNER_RESOURCE_GRANTS_COLLECTION,
  type PartnerResourceGrant,
} from '@/lib/cross-org/types'
import {
  COMPANY_WORKSPACE_MODULES,
  DEFAULT_COMPANY_WORKSPACE_MODULES,
} from './module-keys'

export {
  COMPANY_WORKSPACE_MODULES,
  DEFAULT_COMPANY_WORKSPACE_MODULES,
} from './module-keys'

export const COMPANY_WORKSPACE_ACTIONS = ['view', 'comment', 'approve'] as const
export type CompanyWorkspaceAction = (typeof COMPANY_WORKSPACE_ACTIONS)[number]

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function companyWorkspaceGrantId(input: {
  partnerLinkId: string
  ownerOrgId: string
  companyId: string
}): string {
  return `cw:${input.partnerLinkId}:${input.ownerOrgId}:${input.companyId}`
}

export function normalizeCompanyWorkspaceModules(
  capabilities: SharedBusinessCapability[] | undefined | null,
  fallback: SharedBusinessCapability[] = DEFAULT_COMPANY_WORKSPACE_MODULES,
): SharedBusinessCapability[] {
  const allowed = new Set(COMPANY_WORKSPACE_MODULES)
  const source = Array.isArray(capabilities) && capabilities.length > 0 ? capabilities : fallback
  return [...new Set(source.filter((cap) => allowed.has(cap)))]
}

export async function upsertCompanyWorkspaceGrant(input: {
  partnerLinkId: string
  ownerOrgId: string
  companyId: string
  granteeOrgId: string
  modules: SharedBusinessCapability[]
  status?: PartnerResourceGrant['status']
  scopeAgreementId?: string
}): Promise<PartnerResourceGrant> {
  const partnerLinkId = clean(input.partnerLinkId)
  const ownerOrgId = clean(input.ownerOrgId)
  const companyId = clean(input.companyId)
  const granteeOrgId = clean(input.granteeOrgId)
  if (!partnerLinkId || !ownerOrgId || !companyId || !granteeOrgId) {
    throw new Error('company_workspace grant requires partnerLinkId, ownerOrgId, companyId, granteeOrgId')
  }

  const id = companyWorkspaceGrantId({ partnerLinkId, ownerOrgId, companyId })
  const items = normalizeCompanyWorkspaceModules(input.modules)
  const scopeAgreementId = input.scopeAgreementId
    || `${partnerLinkId}:${ownerOrgId}:${granteeOrgId}`
  const now = FieldValue.serverTimestamp()
  const grant: Record<string, unknown> = {
    id,
    partnerLinkId,
    scopeAgreementId,
    ownerOrgId,
    resourceType: 'company_workspace',
    resourceId: companyId,
    grantee: {
      orgIds: [granteeOrgId],
      userIds: [],
      teamIds: [],
    },
    role: 'viewer',
    actions: [...COMPANY_WORKSPACE_ACTIONS],
    items,
    status: input.status ?? 'active',
    provenance: {},
    schemaVersion: CROSS_ORG_SCHEMA_VERSION,
    updatedAt: now,
  }

  const ref = adminDb.collection(PARTNER_RESOURCE_GRANTS_COLLECTION).doc(id)
  const existing = await ref.get()
  if (!existing.exists) grant.createdAt = now
  await ref.set(grant, { merge: true })
  return { id, ...grant } as PartnerResourceGrant
}

/**
 * Issue both directions after a bilateral link activates.
 * Each ownerOrg holds its own company row; the counterpart is the grantee.
 */
export async function issueCompanyWorkspaceGrantsForLink(input: {
  partnerLinkId: string
  sourceOrgId: string
  sourceCompanyId: string
  targetOrgId: string
  targetCompanyId: string
  /** Modules the source org shares into the target (source → target). */
  sourceModules: SharedBusinessCapability[]
  /** Modules the target org shares into the source (target → source). */
  targetModules: SharedBusinessCapability[]
}): Promise<{ sourceGrantId: string; targetGrantId: string }> {
  const sourceGrant = await upsertCompanyWorkspaceGrant({
    partnerLinkId: input.partnerLinkId,
    ownerOrgId: input.sourceOrgId,
    companyId: input.sourceCompanyId,
    granteeOrgId: input.targetOrgId,
    modules: input.sourceModules,
  })
  const targetGrant = await upsertCompanyWorkspaceGrant({
    partnerLinkId: input.partnerLinkId,
    ownerOrgId: input.targetOrgId,
    companyId: input.targetCompanyId,
    granteeOrgId: input.sourceOrgId,
    modules: input.targetModules,
  })
  return { sourceGrantId: sourceGrant.id, targetGrantId: targetGrant.id }
}

export async function updateCompanyWorkspaceGrantItems(input: {
  partnerLinkId: string
  ownerOrgId: string
  companyId: string
  modules: SharedBusinessCapability[]
}): Promise<PartnerResourceGrant | null> {
  const id = companyWorkspaceGrantId(input)
  const ref = adminDb.collection(PARTNER_RESOURCE_GRANTS_COLLECTION).doc(id)
  const snap = await ref.get()
  if (!snap.exists) return null
  const items = normalizeCompanyWorkspaceModules(input.modules, [])
  await ref.set({
    items,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return { id, ...snap.data(), items } as PartnerResourceGrant
}

export async function revokeCompanyWorkspaceGrantsForPartnerLink(partnerLinkId: string): Promise<number> {
  const linkId = clean(partnerLinkId)
  if (!linkId) return 0
  const snap = await adminDb
    .collection(PARTNER_RESOURCE_GRANTS_COLLECTION)
    .where('partnerLinkId', '==', linkId)
    .where('resourceType', '==', 'company_workspace')
    .limit(50)
    .get()
  let count = 0
  for (const doc of snap.docs) {
    await doc.ref.set({
      status: 'revoked',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    count += 1
  }
  return count
}

export async function listActiveCompanyWorkspaceGrantsForGrantee(
  granteeOrgId: string,
): Promise<PartnerResourceGrant[]> {
  const orgId = clean(granteeOrgId)
  if (!orgId) return []
  const snap = await adminDb
    .collection(PARTNER_RESOURCE_GRANTS_COLLECTION)
    .where('resourceType', '==', 'company_workspace')
    .where('status', '==', 'active')
    .limit(200)
    .get()
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as PartnerResourceGrant)
    .filter((grant) => Array.isArray(grant.grantee?.orgIds) && grant.grantee.orgIds.includes(orgId))
}

export function grantIncludesModule(
  grant: PartnerResourceGrant | null | undefined,
  module: SharedBusinessCapability,
): boolean {
  if (!grant || grant.status !== 'active') return false
  if (!Array.isArray(grant.items) || grant.items.length === 0) return false
  return grant.items.includes(module)
}
