/**
 * POST /api/v1/crm/scoring/recompute-all — batch recompute scores for all
 * contacts in the org (admin+).
 *
 * Body: { includeAi?: boolean, limit?: number }
 *   - includeAi defaults to true
 *   - limit defaults to 200, capped at 500
 *
 * Processes oldest-stale-first (contacts without scoreUpdatedAt sort first in
 * Firestore because undefined is treated as the smallest value).
 *
 * Processes in chunks of 10 concurrent requests. Best-effort — partial
 * completion is acceptable. Returns counts of processed / succeeded / failed.
 */
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { computeScoresForContact } from '@/lib/scoring/compute'

export const dynamic = 'force-dynamic'

const CHUNK_SIZE = 10
const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500

interface ErrorEntry {
  id: string
  message: string
}

export const POST = withCrmAuth('admin', async (req, ctx) => {
  // Parse body
  let includeAi = true
  let limit = DEFAULT_LIMIT

  const bodyText = await req.text()
  if (bodyText && bodyText.trim() !== '') {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(bodyText)
    } catch {
      return apiError('Invalid JSON', 400)
    }
    if (typeof parsed?.includeAi === 'boolean') {
      includeAi = parsed.includeAi
    }
    if (typeof parsed?.limit === 'number') {
      limit = Math.min(Math.max(1, parsed.limit), MAX_LIMIT)
    }
  }

  // Query contacts: scope to org, exclude deleted, oldest stale first
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snapshot = await (adminDb.collection('contacts') as any)
    .where('orgId', '==', ctx.orgId)
    .where('deleted', '!=', true)
    .orderBy('deleted')
    .orderBy('scoreUpdatedAt', 'asc')
    .limit(limit)
    .get()

  const contactIds: string[] = snapshot.docs.map((doc: any) => doc.id)

  let processed = 0
  let succeeded = 0
  let failed = 0
  const errors: ErrorEntry[] = []

  // Process in chunks of CHUNK_SIZE
  for (let i = 0; i < contactIds.length; i += CHUNK_SIZE) {
    const chunk = contactIds.slice(i, i + CHUNK_SIZE)
    await Promise.all(
      chunk.map(async (contactId) => {
        processed++
        try {
          await computeScoresForContact(ctx.orgId, contactId, {
            includeAi,
            actor: ctx.actor,
          })
          succeeded++
        } catch (e: unknown) {
          failed++
          errors.push({
            id: contactId,
            message: e instanceof Error ? e.message : String(e),
          })
        }
      }),
    )
  }

  return apiSuccess({ processed, succeeded, failed, errors })
})
