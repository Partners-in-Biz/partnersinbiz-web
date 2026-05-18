// app/api/v1/crm/contacts/merge/route.ts
//
// POST /api/v1/crm/contacts/merge
// Merges two contacts: winner keeps its fields (nulls backfilled from loser),
// tags are unioned, loser is soft-deleted, deals + activities are re-parented.
// Auth: admin+

import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { apiSuccess, apiError } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

const BATCH_CHUNK = 500 // Firestore batch limit

async function handler(req: NextRequest, ctx: CrmAuthContext): Promise<Response> {
  const { orgId } = ctx

  // ── Parse body ───────────────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const { winnerId, loserId } = body as { winnerId?: string; loserId?: string }
  if (!winnerId) return apiError('winnerId is required', 400)
  if (!loserId) return apiError('loserId is required', 400)

  // ── Fetch both contacts ──────────────────────────────────────────────────────
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

  // ── Build merged winner ──────────────────────────────────────────────────────
  // Start with winner's fields; fill nulls/undefineds from loser
  const merged: Record<string, unknown> = { ...winner }
  for (const [key, value] of Object.entries(loser)) {
    if (merged[key] === null || merged[key] === undefined) {
      merged[key] = value
    }
  }

  // Merge tags: union of both arrays
  const winnerTags: string[] = Array.isArray(winner.tags) ? (winner.tags as string[]) : []
  const loserTags: string[] = Array.isArray(loser.tags) ? (loser.tags as string[]) : []
  merged.tags = Array.from(new Set([...winnerTags, ...loserTags]))
  merged.updatedAt = FieldValue.serverTimestamp()

  // ── Write winner + soft-delete loser ────────────────────────────────────────
  await Promise.all([
    adminDb.collection('contacts').doc(winnerId).update(merged),
    adminDb.collection('contacts').doc(loserId).update({
      deleted: true,
      mergedIntoId: winnerId,
      updatedAt: FieldValue.serverTimestamp(),
    }),
  ])

  // ── Re-parent deals ──────────────────────────────────────────────────────────
  const dealsSnap = await adminDb
    .collection('deals')
    .where('contactId', '==', loserId)
    .where('orgId', '==', orgId)
    .get()

  for (let i = 0; i < dealsSnap.docs.length; i += BATCH_CHUNK) {
    const batch = adminDb.batch()
    const chunk = dealsSnap.docs.slice(i, i + BATCH_CHUNK)
    for (const doc of chunk) {
      batch.update(doc.ref, { contactId: winnerId, updatedAt: FieldValue.serverTimestamp() })
    }
    await batch.commit()
  }

  // ── Re-parent activities ──────────────────────────────────────────────────────
  const activitiesSnap = await adminDb
    .collection('activities')
    .where('contactId', '==', loserId)
    .where('orgId', '==', orgId)
    .get()

  for (let i = 0; i < activitiesSnap.docs.length; i += BATCH_CHUNK) {
    const batch = adminDb.batch()
    const chunk = activitiesSnap.docs.slice(i, i + BATCH_CHUNK)
    for (const doc of chunk) {
      batch.update(doc.ref, { contactId: winnerId, updatedAt: FieldValue.serverTimestamp() })
    }
    await batch.commit()
  }

  // Return merged winner (without server timestamp placeholder)
  const winnerResult: Record<string, unknown> = { id: winnerId, ...merged }
  delete winnerResult['updatedAt'] // remove FieldValue sentinel

  return apiSuccess({ winner: winnerResult })
}

export const POST = withCrmAuth('admin', handler)
