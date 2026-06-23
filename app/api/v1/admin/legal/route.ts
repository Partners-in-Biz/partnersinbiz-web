/**
 * GET  /api/v1/admin/legal           — list legal document versions (?docType filter), version desc
 * POST /api/v1/admin/legal           — create a new DRAFT version (auto-increment version per docType)
 *
 * Firestore collection `legal_documents` — each doc is a single VERSION of a docType.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import {
  serializeGovernance,
  genId,
  cleanStr,
  actorOf,
} from '@/lib/governance/firestore'

export const dynamic = 'force-dynamic'

const COLLECTION = 'legal_documents'

export const GET = withAuth('admin', async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url)
    const docType = cleanStr(searchParams.get('docType'), 60) || null

    // Single-field query to avoid composite indexes: pull then sort in memory.
    let query: FirebaseFirestore.Query = adminDb.collection(COLLECTION)
    if (docType) query = query.where('docType', '==', docType)
    const snap = await query.limit(1000).get()

    const versions = snap.docs
      .map((d) => serializeGovernance({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        if (a.docType !== b.docType) return String(a.docType).localeCompare(String(b.docType))
        return (b.version ?? 0) - (a.version ?? 0)
      })

    return apiSuccess({ versions })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)

    const docType = cleanStr((body as Record<string, unknown>).docType, 60)
    if (!docType) return apiError('docType is required', 400)

    const title = cleanStr((body as Record<string, unknown>).title, 300)
    const docBody = cleanStr((body as Record<string, unknown>).body, 200000)
    const effectiveDate = cleanStr((body as Record<string, unknown>).effectiveDate, 60) || null

    // Auto-increment version per docType.
    const existing = await adminDb.collection(COLLECTION).where('docType', '==', docType).get()
    const maxVersion = existing.docs.reduce((max, d) => {
      const v = Number(d.data().version) || 0
      return v > max ? v : max
    }, 0)
    const version = maxVersion + 1

    const id = genId('legaldoc')
    const now = FieldValue.serverTimestamp()
    const record = {
      docType,
      version,
      title: title || `${docType} v${version}`,
      body: docBody,
      status: 'draft' as const,
      effectiveDate,
      publishedAt: null,
      createdBy: actorOf(user),
      createdAt: now,
      updatedAt: now,
    }
    await adminDb.collection(COLLECTION).doc(id).set(record)
    const saved = await adminDb.collection(COLLECTION).doc(id).get()
    return apiSuccess({ version: serializeGovernance({ id, ...saved.data() }) }, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
