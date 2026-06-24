// app/api/v1/crm/contacts/merge/route.ts
//
// POST /api/v1/crm/contacts/merge
// Merges two same-workspace contacts. The winner keeps populated fields, loser
// fields backfill blanks, tags are unioned, loser is soft-deleted, and related
// CRM records are re-parented within the same org only.
// Auth: admin+

import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { apiSuccess, apiError } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { safeTouchCrmLiveUpdate } from '@/lib/crm/live-updates'

export const dynamic = 'force-dynamic'

const BATCH_CHUNK = 450 // leave headroom under Firestore's 500-write batch limit

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

async function reparentByField(
  collection: string,
  orgId: string,
  field: string,
  loserId: string,
  winnerId: string,
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
      batch.update(doc.ref, { [field]: winnerId, updatedAt: FieldValue.serverTimestamp() })
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
  if (winnerId === loserId) return apiError('winnerId and loserId must be different contacts', 400)

  const [winnerSnap, loserSnap] = await Promise.all([
    adminDb.collection('contacts').doc(winnerId).get(),
    adminDb.collection('contacts').doc(loserId).get(),
  ])

  if (!winnerSnap.exists) return apiError('Winner contact not found', 404)
  if (!loserSnap.exists) return apiError('Loser contact not found', 404)

  const winner = winnerSnap.data() as Record<string, unknown>
  const loser = loserSnap.data() as Record<string, unknown>

  if (winner.orgId !== orgId) return apiError('Winner contact not found', 404)
  if (loser.orgId !== orgId) return apiError('Loser contact not found', 404)
  if (winner.deleted === true) return apiError('Winner contact not found', 404)
  if (loser.deleted === true) return apiError('Loser contact not found', 404)

  const merged: Record<string, unknown> = { ...winner }
  for (const [key, value] of Object.entries(loser)) {
    if (!hasValue(merged[key]) && hasValue(value)) merged[key] = value
  }

  const winnerTags: string[] = Array.isArray(winner.tags) ? (winner.tags as string[]) : []
  const loserTags: string[] = Array.isArray(loser.tags) ? (loser.tags as string[]) : []
  merged.tags = Array.from(new Set([...winnerTags, ...loserTags]))
  merged.updatedBy = ctx.isAgent ? undefined : ctx.actor.uid
  merged.updatedByRef = ctx.actor
  merged.updatedAt = FieldValue.serverTimestamp()

  const winnerWrite = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined))

  await Promise.all([
    adminDb.collection('contacts').doc(winnerId).update(winnerWrite),
    adminDb.collection('contacts').doc(loserId).update({
      deleted: true,
      mergedIntoId: winnerId,
      updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
      updatedByRef: ctx.actor,
      updatedAt: FieldValue.serverTimestamp(),
    }),
  ])

  const reparented = {
    deals: await reparentByField('deals', orgId, 'contactId', loserId, winnerId),
    activities: await reparentByField('activities', orgId, 'contactId', loserId, winnerId),
    quotes: await reparentByField('quotes', orgId, 'contactId', loserId, winnerId),
    quoteSourceContacts: await reparentByField('quotes', orgId, 'sourceContactId', loserId, winnerId),
    formSubmissions: await reparentByField('form_submissions', orgId, 'contactId', loserId, winnerId),
    leadCaptureSubmissions: await reparentByField('lead_capture_submissions', orgId, 'contactId', loserId, winnerId),
    tasks: await reparentByField('tasks', orgId, 'contactId', loserId, winnerId),
  }

  await safeTouchCrmLiveUpdate(orgId, 'contacts', 'contact.merged')

  const winnerResult: Record<string, unknown> = { id: winnerId, ...merged }
  delete winnerResult.updatedAt

  return apiSuccess({ winner: winnerResult, loserId, reparented })
}

export const POST = withCrmAuth('admin', handler)
