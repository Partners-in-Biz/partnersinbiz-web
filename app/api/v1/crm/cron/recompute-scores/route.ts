// app/api/v1/crm/cron/recompute-scores/route.ts
//
// Nightly cron (02:00 UTC) — recomputes lead + ICP + AI scores for all contacts.
// Mirrors the budget-pacing-check pattern: GET, Bearer CRON_SECRET auth, adminDb.
//
// Budget: up to 200 contacts per org, concurrency 5, 55 s wall-clock limit.

import { NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { computeScoresForContact } from '@/lib/scoring/compute'
import { getOrBootstrapConfig } from '@/lib/scoring/store'
import { adminDb } from '@/lib/firebase/admin'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

export const dynamic = 'force-dynamic'

const CONTACTS_PER_ORG = 200
const CHUNK_SIZE = 5 // concurrent AI calls per chunk
const TIME_BUDGET_MS = 55_000 // stop before Vercel's 60 s hard limit

const SYSTEM_ACTOR: MemberRef = {
  uid: 'system',
  displayName: 'A4 Scoring Cron',
  kind: 'agent',
}

export async function GET(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return apiError('CRON_SECRET not configured', 500)
  }

  const provided = req.headers.get('authorization')
  if (provided !== `Bearer ${cronSecret}`) {
    return apiError('Unauthorized', 401)
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  const startedAt = Date.now()
  let orgsProcessed = 0
  let contactsProcessed = 0
  const errors: string[] = []

  // ── Discover orgs ────────────────────────────────────────────────────────────
  // Use organizations collection, filter deleted !== true (mirrors other crons)
  const orgsSnap = await adminDb
    .collection('organizations')
    .where('deleted', '!=', true)
    .get()

  // ── Per-org processing ───────────────────────────────────────────────────────
  for (const orgDoc of orgsSnap.docs) {
    const orgId = orgDoc.id

    try {
      // Load per-org scoring config (decides aiEnabled)
      const config = await getOrBootstrapConfig(orgId)

      // Query stale-first: contacts for this org, not deleted, ordered by scoreUpdatedAt asc
      const contactsSnap = await adminDb
        .collection('contacts')
        .where('orgId', '==', orgId)
        .where('deleted', '!=', true)
        .orderBy('deleted')
        .orderBy('scoreUpdatedAt', 'asc')
        .limit(CONTACTS_PER_ORG)
        .get()

      const contactDocs = contactsSnap.docs

      // Process in chunks of CHUNK_SIZE (AI rate-limit aware)
      for (let i = 0; i < contactDocs.length; i += CHUNK_SIZE) {
        const chunk = contactDocs.slice(i, i + CHUNK_SIZE)

        await Promise.all(
          chunk.map(async (doc) => {
            try {
              await computeScoresForContact(orgId, doc.id, {
                includeAi: config.aiEnabled,
                actor: SYSTEM_ACTOR,
              })
              contactsProcessed++
            } catch (err) {
              const msg = `${orgId}/${doc.id}: ${(err as Error).message}`
              console.error('[recompute-scores]', msg)
              errors.push(msg)
            }
          }),
        )
      }

      orgsProcessed++
    } catch (err) {
      const msg = `org ${orgId} setup: ${(err as Error).message}`
      console.error('[recompute-scores]', msg)
      errors.push(msg)
    }

    // Time budget: stop before Vercel's 60 s hard limit
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      break
    }
  }

  return apiSuccess({ orgsProcessed, contactsProcessed, errors })
}
