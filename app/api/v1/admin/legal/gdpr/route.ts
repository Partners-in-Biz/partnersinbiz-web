/**
 * GET  /api/v1/admin/legal/gdpr  — list data-subject requests (?status ?type)
 * POST /api/v1/admin/legal/gdpr  — create a DSR
 *
 * Firestore collection `gdpr_requests`:
 *   { type, subjectEmail, orgId, status, notes, requestedAt, completedAt, handledBy, log[] }
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import { serializeGovernance, toMillis, genId, cleanStr, actorOf } from '@/lib/governance/firestore'

export const dynamic = 'force-dynamic'

const COLLECTION = 'gdpr_requests'
const VALID_TYPES = ['access', 'erasure', 'portability', 'rectification']
const VALID_STATUS = ['open', 'in_progress', 'completed', 'rejected']

export const GET = withAuth('admin', async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url)
    const status = cleanStr(searchParams.get('status'), 30) || null
    const type = cleanStr(searchParams.get('type'), 30) || null

    let query: FirebaseFirestore.Query = adminDb.collection(COLLECTION)
    if (status && VALID_STATUS.includes(status)) query = query.where('status', '==', status)
    const snap = await query.limit(1000).get()

    let rows = snap.docs.map((d) => serializeGovernance({ id: d.id, ...d.data() }))
    if (type && VALID_TYPES.includes(type)) rows = rows.filter((r) => r.type === type)
    rows.sort((a, b) => toMillis(b.requestedAt) - toMillis(a.requestedAt))

    return apiSuccess({ requests: rows })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
    const b = body as Record<string, unknown>

    const type = cleanStr(b.type, 30)
    if (!VALID_TYPES.includes(type)) return apiError(`type must be one of ${VALID_TYPES.join(', ')}`, 400)
    const subjectEmail = cleanStr(b.subjectEmail, 320).toLowerCase()
    if (!subjectEmail) return apiError('subjectEmail is required', 400)

    const id = genId('dsr')
    const now = FieldValue.serverTimestamp()
    const record = {
      type,
      subjectEmail,
      orgId: cleanStr(b.orgId, 120) || null,
      status: 'open' as const,
      notes: cleanStr(b.notes, 5000),
      requestedAt: now,
      completedAt: null,
      handledBy: null,
      log: [
        {
          at: new Date().toISOString(),
          actor: actorOf(user),
          action: 'created',
          detail: `DSR (${type}) opened for ${subjectEmail}`,
        },
      ],
    }
    await adminDb.collection(COLLECTION).doc(id).set(record)
    const saved = await adminDb.collection(COLLECTION).doc(id).get()
    return apiSuccess({ request: serializeGovernance({ id, ...saved.data() }) }, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
