/**
 * GET  /api/v1/admin/legal/compliance  — list report configs
 * POST /api/v1/admin/legal/compliance  — create a report config
 *
 * Firestore collection `compliance_reports`:
 *   { name, type, schedule, status, contents[], lastGeneratedAt, nextRunAt, createdBy, createdAt }
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import { serializeGovernance, toMillis, genId, cleanStr, actorOf } from '@/lib/governance/firestore'

export const dynamic = 'force-dynamic'

const COLLECTION = 'compliance_reports'
const VALID_TYPES = ['gdpr', 'data_retention', 'security', 'access_audit']
const VALID_SCHEDULES = ['manual', 'weekly', 'monthly']

export const GET = withAuth('admin', async () => {
  try {
    const snap = await adminDb.collection(COLLECTION).limit(500).get()
    const reports = snap.docs
      .map((d) => serializeGovernance({ id: d.id, ...d.data() }))
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
    return apiSuccess({ reports })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
    const b = body as Record<string, unknown>

    const name = cleanStr(b.name, 200)
    if (!name) return apiError('name is required', 400)
    const type = cleanStr(b.type, 30)
    if (!VALID_TYPES.includes(type)) return apiError(`type must be one of ${VALID_TYPES.join(', ')}`, 400)
    const schedule = cleanStr(b.schedule, 20) || 'manual'
    if (!VALID_SCHEDULES.includes(schedule)) return apiError(`schedule must be one of ${VALID_SCHEDULES.join(', ')}`, 400)

    const contents = Array.isArray(b.contents)
      ? (b.contents as unknown[]).map((c) => cleanStr(c, 60)).filter(Boolean)
      : []

    const id = genId('creport')
    const now = FieldValue.serverTimestamp()
    const record = {
      name,
      type,
      schedule,
      status: 'scheduled' as const,
      contents,
      lastGeneratedAt: null,
      nextRunAt: null,
      createdBy: actorOf(user),
      createdAt: now,
      updatedAt: now,
    }
    await adminDb.collection(COLLECTION).doc(id).set(record)
    const saved = await adminDb.collection(COLLECTION).doc(id).get()
    return apiSuccess({ report: serializeGovernance({ id, ...saved.data() }) }, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
