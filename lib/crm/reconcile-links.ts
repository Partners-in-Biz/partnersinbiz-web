import { FieldValue } from 'firebase-admin/firestore'
import type * as FirebaseFirestore from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

export type ReconcileMode = 'dry-run' | 'apply'

export interface ReconcileOptions {
  mode?: ReconcileMode
  companyId?: string
  limit?: number
}

export interface ProposedCrmLink {
  resourceType: 'project' | 'client_document' | 'quote' | 'invoice'
  resourceId: string
  companyId: string
  reason: string
  patch: Record<string, unknown>
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function limitValue(value: unknown, fallback = 500): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : fallback, 1), 1000)
}

async function listOrgRows(collectionName: string, orgId: string, limit = 1000) {
  const snap = await adminDb.collection(collectionName).where('orgId', '==', orgId).limit(limit).get()
  return snap.docs
    .map((doc) => ({ id: doc.id, ref: doc.ref, data: doc.data() as Record<string, unknown> }))
    .filter((row) => row.data.deleted !== true && row.data.archived !== true)
}

function buildCompanyLookup(companies: Array<{ id: string; data: Record<string, unknown> }>) {
  const byLinkedOrg = new Map<string, { id: string; name: string }>()
  const byName = new Map<string, { id: string; name: string }>()
  for (const company of companies) {
    const name = cleanString(company.data.name)
    const linkedOrgId = cleanString(company.data.linkedOrgId)
    if (linkedOrgId) byLinkedOrg.set(linkedOrgId, { id: company.id, name })
    if (name) byName.set(name.toLowerCase(), { id: company.id, name })
  }
  return { byLinkedOrg, byName }
}

function proposedPatchForResource(
  resourceType: ProposedCrmLink['resourceType'],
  resource: { id: string; data: Record<string, unknown> },
  lookup: ReturnType<typeof buildCompanyLookup>,
): ProposedCrmLink | null {
  if (cleanString(resource.data.companyId)) return null
  const orgCandidates = [
    resource.data.recipientOrgId,
    resource.data.targetOrgId,
    resource.data.clientOrgId,
    resource.data.legacyOrgId,
  ].map(cleanString).filter(Boolean)
  for (const orgId of orgCandidates) {
    const company = lookup.byLinkedOrg.get(orgId)
    if (!company) continue
    return {
      resourceType,
      resourceId: resource.id,
      companyId: company.id,
      reason: `Matched linked organisation ${orgId}`,
      patch: {
        companyId: company.id,
        sourceCompanyId: company.id,
        companyName: company.name,
        recipientCompanyName: cleanString(resource.data.recipientCompanyName) || company.name,
      },
    }
  }

  const companyName = cleanString(resource.data.recipientCompanyName || resource.data.companyName)
  if (companyName) {
    const company = lookup.byName.get(companyName.toLowerCase())
    if (company) {
      return {
        resourceType,
        resourceId: resource.id,
        companyId: company.id,
        reason: `Matched company name ${companyName}`,
        patch: {
          companyId: company.id,
          sourceCompanyId: company.id,
          companyName: company.name,
        },
      }
    }
  }
  return null
}

function collectionForResource(resourceType: ProposedCrmLink['resourceType']): string {
  if (resourceType === 'client_document') return 'client_documents'
  if (resourceType === 'project') return 'projects'
  if (resourceType === 'quote') return 'quotes'
  return 'invoices'
}

export async function reconcileCrmLinks(
  orgId: string,
  options: ReconcileOptions = {},
  actor?: MemberRef,
) {
  const mode = options.mode === 'apply' ? 'apply' : 'dry-run'
  const limit = limitValue(options.limit)
  const companies = await listOrgRows('companies', orgId, limit)
  const filteredCompanies = options.companyId
    ? companies.filter((company) => company.id === options.companyId)
    : companies
  const lookup = buildCompanyLookup(filteredCompanies)
  const [projects, documents, quotes, invoices] = await Promise.all([
    listOrgRows('projects', orgId, limit),
    listOrgRows('client_documents', orgId, limit),
    listOrgRows('quotes', orgId, limit),
    listOrgRows('invoices', orgId, limit),
  ])
  const candidates: Array<[ProposedCrmLink['resourceType'], Array<{ id: string; ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }>]> = [
    ['project', projects],
    ['client_document', documents],
    ['quote', quotes],
    ['invoice', invoices],
  ]
  const proposedLinks = candidates.flatMap(([resourceType, rows]) =>
    rows
      .map((row) => proposedPatchForResource(resourceType, row, lookup))
      .filter((row): row is ProposedCrmLink => Boolean(row)),
  )

  if (mode === 'apply') {
    await Promise.all(proposedLinks.map((link) =>
      adminDb.collection(collectionForResource(link.resourceType)).doc(link.resourceId).set({
        ...link.patch,
        reconciledByRef: actor,
        reconciledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
    ))
  }

  return {
    mode,
    proposedLinks,
    appliedCount: mode === 'apply' ? proposedLinks.length : 0,
  }
}
