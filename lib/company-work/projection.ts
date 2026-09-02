/**
 * Company-work projection — third sanctioned cross-org read path
 * (alongside command-center.ts and shares.ts).
 *
 * Serving org records (orgId = serving, companyId set) become visible to the
 * linked org when:
 *   1. live bilateral PartnerLink
 *   2. active company_workspace grant with the module in items[]
 *   3. clientVisibility !== 'private'
 */
import { adminDb } from '@/lib/firebase/admin'
import type { SharedBusinessCapability } from '@/lib/business-relationships/types'
import { CrossOrgPolicyService, FirestoreCrossOrgPolicyStore } from '@/lib/cross-org/policy-service'
import {
  PARTNER_LINKS_COLLECTION,
  type PartnerLink,
  type PartnerResourceGrant,
} from '@/lib/cross-org/types'
import { isClientPrivate } from '@/lib/work-scope'
import { projectRecordFields } from './fields'
import {
  grantIncludesModule,
  listActiveCompanyWorkspaceGrantsForGrantee,
  type CompanyWorkspaceAction,
} from './grants'

export type LinkedCompanyProjection = {
  companyId: string
  companyName: string
  servingOrgId: string
  servingOrgName: string
  partnerLinkId: string
  grantId: string
  modules: string[]
}

export type SharedRecordProjection = {
  id: string
  module: SharedBusinessCapability
  servingOrgId: string
  companyId: string
  partnerLinkId: string
  grantId: string
  fields: Record<string, unknown>
}

const MODULE_COLLECTIONS: Partial<Record<SharedBusinessCapability, string>> = {
  seo: 'seo_sprints',
  ads: 'ad_campaigns',
  campaigns: 'content_campaigns',
  social: 'social_posts',
  research: 'research_items',
  documents: 'client_documents',
  projects: 'projects',
  properties: 'properties',
  support: 'support_tickets',
  services: 'service_workspaces',
  analytics: 'analytics_reports',
  email: 'email_campaigns',
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function loadActivePartnerLink(partnerLinkId: string): Promise<PartnerLink | null> {
  const snap = await adminDb.collection(PARTNER_LINKS_COLLECTION).doc(partnerLinkId).get()
  if (!snap.exists) return null
  const link = { id: snap.id, ...snap.data() } as PartnerLink
  return link.status === 'active' ? link : null
}

async function loadOrgName(orgId: string): Promise<string> {
  const snap = await adminDb.collection('organizations').doc(orgId).get()
  if (!snap.exists) return orgId
  return clean((snap.data() ?? {}).name) || orgId
}

async function loadCompanyName(companyId: string): Promise<string> {
  const snap = await adminDb.collection('companies').doc(companyId).get()
  if (!snap.exists) return companyId
  return clean((snap.data() ?? {}).name) || companyId
}

/**
 * Companies on other orgs' books where linkedOrgId === viewer and a live
 * company_workspace grant exists.
 */
export async function listLinkedCompaniesForViewer(
  viewerOrgId: string,
): Promise<LinkedCompanyProjection[]> {
  const viewer = clean(viewerOrgId)
  if (!viewer) return []

  const grants = await listActiveCompanyWorkspaceGrantsForGrantee(viewer)
  const out: LinkedCompanyProjection[] = []

  for (const grant of grants) {
    const partnerLinkId = clean(grant.partnerLinkId)
    if (!partnerLinkId) continue
    const link = await loadActivePartnerLink(partnerLinkId)
    if (!link) continue

    const companyId = clean(grant.resourceId)
    const servingOrgId = clean(grant.ownerOrgId)
    if (!companyId || !servingOrgId || servingOrgId === viewer) continue

    const companySnap = await adminDb.collection('companies').doc(companyId).get()
    const companyData = companySnap.data() ?? {}
    if (clean(companyData.linkedOrgId) !== viewer) continue
    if (companyData.deleted === true) continue

    out.push({
      companyId,
      companyName: clean(companyData.name) || await loadCompanyName(companyId),
      servingOrgId,
      servingOrgName: await loadOrgName(servingOrgId),
      partnerLinkId,
      grantId: grant.id,
      modules: Array.isArray(grant.items) ? grant.items.map(String) : [],
    })
  }

  return out
}

export async function listSharedRecords(
  viewerOrgId: string,
  module: SharedBusinessCapability,
  options: { companyId?: string; limit?: number } = {},
): Promise<SharedRecordProjection[]> {
  const viewer = clean(viewerOrgId)
  const collection = MODULE_COLLECTIONS[module]
  if (!viewer || !collection) return []

  const servingCompanyFilter = await resolveServingCompanyIdsForViewerFilter(
    viewer,
    clean(options.companyId) || undefined,
  )

  const grants = (await listActiveCompanyWorkspaceGrantsForGrantee(viewer))
    .filter((grant) => grantIncludesModule(grant, module))
    .filter((grant) => {
      if (!servingCompanyFilter) return true
      return servingCompanyFilter.has(clean(grant.resourceId))
    })

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
  const out: SharedRecordProjection[] = []

  for (const grant of grants) {
    const partnerLinkId = clean(grant.partnerLinkId)
    if (!partnerLinkId) continue
    const link = await loadActivePartnerLink(partnerLinkId)
    if (!link) continue

    const companyId = clean(grant.resourceId)
    const servingOrgId = clean(grant.ownerOrgId)
    if (!companyId || !servingOrgId) continue

    const snap = await adminDb
      .collection(collection)
      .where('orgId', '==', servingOrgId)
      .where('companyId', '==', companyId)
      .limit(limit)
      .get()

    for (const doc of snap.docs) {
      const data = { id: doc.id, ...doc.data() } as Record<string, unknown>
      if (data.deleted === true) continue
      if (isClientPrivate(data)) continue
      // Documents: still require client-facing statuses when present.
      if (module === 'documents') {
        const visibility = clean(data.visibility)
        const status = clean(data.status)
        if (visibility && visibility !== 'client_visible' && status !== 'shared' && status !== 'accepted') {
          continue
        }
      }
      out.push({
        id: doc.id,
        module,
        servingOrgId,
        companyId,
        partnerLinkId,
        grantId: grant.id,
        fields: projectRecordFields(module, data),
      })
    }
  }

  return out
}

/**
 * Accept either a serving-book company id (grant.resourceId) or the viewer's
 * mirror company id (company on viewer book with linkedOrgId = serving org).
 * Returns null when no filter was requested.
 */
async function resolveServingCompanyIdsForViewerFilter(
  viewerOrgId: string,
  companyId?: string,
): Promise<Set<string> | null> {
  const wanted = clean(companyId)
  if (!wanted) return null

  const ids = new Set<string>([wanted])
  const companySnap = await adminDb.collection('companies').doc(wanted).get()
  if (!companySnap.exists) return ids
  const data = companySnap.data() ?? {}
  const companyOrgId = clean(data.orgId)
  const linkedOrgId = clean(data.linkedOrgId)

  // Viewer passed their mirror company → find serving companies that link back.
  if (companyOrgId === viewerOrgId && linkedOrgId) {
    // Index-light: filter by serving org, then linkedOrgId in memory.
    const servingSnap = await adminDb
      .collection('companies')
      .where('orgId', '==', linkedOrgId)
      .limit(200)
      .get()
    for (const doc of servingSnap.docs) {
      const row = doc.data() ?? {}
      if (row.deleted === true) continue
      if (clean(row.linkedOrgId) !== viewerOrgId) continue
      ids.add(doc.id)
    }
  }

  return ids
}

/**
 * Decide view | comment | approve for a company_workspace module action.
 * Audits via CrossOrgPolicyService.
 *
 * Grant contract: actions are view|comment|approve; role is viewer; module
 * gating is grant.items[] (not scope-agreement capability — those may omit
 * marketing modules the workspace grant still exposes).
 */
export async function decideSharedAction(input: {
  viewerUid: string
  viewerOrgId: string
  module: SharedBusinessCapability
  resourceId: string
  action: CompanyWorkspaceAction
  grant?: PartnerResourceGrant | null
}): Promise<{ allowed: boolean; reason: string; grantId?: string }> {
  const viewerOrgId = clean(input.viewerOrgId)
  let grant = input.grant ?? null
  if (!grant) {
    const grants = await listActiveCompanyWorkspaceGrantsForGrantee(viewerOrgId)
    grant = grants.find((candidate) => (
      grantIncludesModule(candidate, input.module)
      && clean(candidate.resourceId) === clean(input.resourceId)
    )) ?? null
  }
  if (!grant || !grantIncludesModule(grant, input.module)) {
    return { allowed: false, reason: 'No active company_workspace grant for this module' }
  }

  const partnerLinkId = clean(grant.partnerLinkId)
  if (!partnerLinkId) {
    return { allowed: false, reason: 'company_workspace grant missing partnerLinkId' }
  }

  const policy = new CrossOrgPolicyService(new FirestoreCrossOrgPolicyStore())
  const decision = await policy.decide({
    actor: { userId: input.viewerUid, orgId: viewerOrgId },
    resourceType: 'company_workspace',
    resourceId: grant.resourceId,
    // Grant actions are view|comment|approve — not `${module}.read`.
    action: input.action,
    partnerLinkId,
    item: input.module,
    resourceOwnerOrgId: grant.ownerOrgId,
    actorRole: 'viewer',
  })

  return {
    allowed: decision.allowed,
    reason: decision.reason || (decision.allowed ? 'allowed' : 'denied'),
    grantId: grant.id,
  }
}

export { MODULE_COLLECTIONS }
