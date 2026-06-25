// app/api/v1/crm/companies/merge/route.ts
//
// POST /api/v1/crm/companies/merge
// Merges two same-workspace companies. The winner keeps populated fields, loser
// fields backfill blanks, tags are unioned, loser is soft-deleted, and related
// records are re-linked to the winner within the current org only.
// Auth: admin+

import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { apiSuccess, apiError } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { loadCompany } from '@/lib/companies/store'
import { safeTouchCrmLiveUpdate } from '@/lib/crm/live-updates'

export const dynamic = 'force-dynamic'

const BATCH_CHUNK = 450

type CompanyLink = {
  companyId?: string
  companyName?: string
  roleTitle?: string
  relationshipType?: string
  primary?: boolean
  [key: string]: unknown
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

function mergeCompanyLinks(rawLinks: unknown, winnerId: string, winnerName: string, loserId: string): CompanyLink[] | undefined {
  if (!Array.isArray(rawLinks)) return undefined
  const merged: CompanyLink[] = []
  for (const raw of rawLinks) {
    if (!raw || typeof raw !== 'object') continue
    const link = { ...(raw as CompanyLink) }
    if (link.companyId === loserId) {
      link.companyId = winnerId
      link.companyName = winnerName
    }
    if (!link.companyId) continue
    const existingIndex = merged.findIndex((candidate) => candidate.companyId === link.companyId)
    if (existingIndex >= 0) {
      merged[existingIndex] = {
        ...merged[existingIndex],
        ...link,
        primary: merged[existingIndex].primary === true || link.primary === true,
      }
    } else {
      merged.push(link)
    }
  }
  return merged.length > 0 ? merged : undefined
}

async function reparentByField(
  collection: string,
  orgId: string,
  field: string,
  loserId: string,
  winnerId: string,
  winnerName?: string,
): Promise<number> {
  const snap = await adminDb
    .collection(collection)
    .where('orgId', '==', orgId)
    .where(field, '==', loserId)
    .get()

  let updated = 0
  for (let i = 0; i < snap.docs.length; i += BATCH_CHUNK) {
    const batch = adminDb.batch()
    const chunk = snap.docs.slice(i, i + BATCH_CHUNK)
    for (const doc of chunk) {
      const patch: Record<string, unknown> = {
        [field]: winnerId,
        updatedAt: FieldValue.serverTimestamp(),
      }
      if (field === 'companyId' && winnerName) patch.companyName = winnerName
      batch.update(doc.ref, patch)
    }
    await batch.commit()
    updated += chunk.length
  }
  return updated
}

async function reparentContactCompanyLinks(orgId: string, loserId: string, winnerId: string, winnerName: string): Promise<number> {
  const snap = await adminDb.collection('contacts')
    .where('orgId', '==', orgId)
    .limit(1000)
    .get()

  const docsToUpdate = snap.docs
    .map((doc) => ({ doc, links: mergeCompanyLinks(doc.data()?.companyLinks, winnerId, winnerName, loserId) }))
    .filter(({ doc, links }) => links && JSON.stringify(doc.data()?.companyLinks ?? []) !== JSON.stringify(links))

  let updated = 0
  for (let i = 0; i < docsToUpdate.length; i += BATCH_CHUNK) {
    const batch = adminDb.batch()
    const chunk = docsToUpdate.slice(i, i + BATCH_CHUNK)
    for (const { doc, links } of chunk) {
      batch.update(doc.ref, { companyLinks: links, updatedAt: FieldValue.serverTimestamp() })
    }
    await batch.commit()
    updated += chunk.length
  }
  return updated
}

async function handler(req: NextRequest, ctx: CrmAuthContext): Promise<Response> {
  const { orgId } = ctx

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const { winnerId, loserId } = body as { winnerId?: string; loserId?: string }
  if (!winnerId) return apiError('winnerId is required', 400)
  if (!loserId) return apiError('loserId is required', 400)
  if (winnerId === loserId) return apiError('winnerId and loserId must be different companies', 400)

  const [winnerLoaded, loserLoaded] = await Promise.all([
    loadCompany(winnerId, orgId),
    loadCompany(loserId, orgId),
  ])
  if (!winnerLoaded) return apiError('Winner company not found', 404)
  if (!loserLoaded) return apiError('Loser company not found', 404)

  const winner = winnerLoaded.data as unknown as Record<string, unknown>
  const loser = loserLoaded.data as unknown as Record<string, unknown>
  const merged: Record<string, unknown> = { ...winner }
  for (const [key, value] of Object.entries(loser)) {
    if (!hasValue(merged[key]) && hasValue(value)) merged[key] = value
  }

  const winnerTags = Array.isArray(winner.tags) ? (winner.tags as string[]) : []
  const loserTags = Array.isArray(loser.tags) ? (loser.tags as string[]) : []
  merged.tags = Array.from(new Set([...winnerTags, ...loserTags]))
  merged.updatedBy = ctx.isAgent ? undefined : ctx.actor.uid
  merged.updatedByRef = ctx.actor
  merged.updatedAt = FieldValue.serverTimestamp()

  const winnerWrite = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined))

  await Promise.all([
    winnerLoaded.ref.update(winnerWrite),
    loserLoaded.ref.update({
      deleted: true,
      mergedIntoId: winnerId,
      updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
      updatedByRef: ctx.actor,
      updatedAt: FieldValue.serverTimestamp(),
    }),
  ])

  const winnerName = typeof merged.name === 'string' ? merged.name : winnerLoaded.data.name
  const reparented = {
    contacts: await reparentByField('contacts', orgId, 'companyId', loserId, winnerId, winnerName),
    contactCompanyLinks: await reparentContactCompanyLinks(orgId, loserId, winnerId, winnerName),
    deals: await reparentByField('deals', orgId, 'companyId', loserId, winnerId, winnerName),
    quotes: await reparentByField('quotes', orgId, 'companyId', loserId, winnerId, winnerName),
    quoteSourceCompanies: await reparentByField('quotes', orgId, 'sourceCompanyId', loserId, winnerId),
    invoices: await reparentByField('invoices', orgId, 'companyId', loserId, winnerId, winnerName),
    invoiceSourceCompanies: await reparentByField('invoices', orgId, 'sourceCompanyId', loserId, winnerId),
    activities: await reparentByField('activities', orgId, 'companyId', loserId, winnerId),
    projects: await reparentByField('projects', orgId, 'companyId', loserId, winnerId, winnerName),
    formSubmissions: await reparentByField('form_submissions', orgId, 'companyId', loserId, winnerId, winnerName),
    leadCaptureSubmissions: await reparentByField('lead_capture_submissions', orgId, 'companyId', loserId, winnerId, winnerName),
  }

  await safeTouchCrmLiveUpdate(orgId, 'companies', 'company.merged')

  const companyResult: Record<string, unknown> = { id: winnerId, ...merged }
  delete companyResult.updatedAt
  return apiSuccess({ company: companyResult, loserId, reparented })
}

export const POST = withCrmAuth('admin', handler)
