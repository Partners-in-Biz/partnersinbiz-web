import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import type { ReportConfig } from '@/lib/seo/report-builder'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/seo/reports?sprintId=...  — list report history for a sprint.
 */
export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const sprintId = new URL(req.url).searchParams.get('sprintId')
  if (!sprintId) return apiError('sprintId is required', 400)

  const sprintSnap = await adminDb.collection('seo_sprints').doc(sprintId).get()
  if (!sprintSnap.exists) return apiError('Sprint not found', 404)
  const sprint = sprintSnap.data() as { orgId?: string }
  if (user.role !== 'ai' && sprint.orgId !== user.orgId) return apiError('Forbidden', 403)

  const snap = await adminDb
    .collection('seo_reports')
    .where('sprintId', '==', sprintId)
    .where('deleted', '==', false)
    .get()

  const reports = snap.docs
    .map((d) => {
      const data = d.data() as Record<string, unknown>
      return {
        id: d.id,
        clientName: data.clientName ?? '',
        from: data.from ?? '',
        to: data.to ?? '',
        sections: data.sections ?? {},
        brandColor: data.brandColor ?? null,
        hasLogo: !!data.logoDataUrl,
        createdAt: data.createdAtIso ?? '',
        shareToken: data.shareToken ?? null,
        shareExpiresAt: data.shareExpiresAt ?? null,
      }
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))

  return apiSuccess(reports)
})

/**
 * POST /api/v1/seo/reports  — save a report configuration.
 * Body: { sprintId, config: ReportConfig }
 */
export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  const sprintId = typeof body?.sprintId === 'string' ? body.sprintId : ''
  const config = body?.config as ReportConfig | undefined
  if (!sprintId) return apiError('sprintId is required', 400)
  if (!config?.from || !config?.to || !config?.sections) return apiError('A valid report config is required', 400)

  const sprintSnap = await adminDb.collection('seo_sprints').doc(sprintId).get()
  if (!sprintSnap.exists) return apiError('Sprint not found', 404)
  const sprint = sprintSnap.data() as { orgId?: string }
  if (user.role !== 'ai' && sprint.orgId !== user.orgId) return apiError('Forbidden', 403)

  // Reject oversize logos (keep Firestore docs under control — ~1MB doc limit)
  if (typeof config.logoDataUrl === 'string' && config.logoDataUrl.length > 700_000) {
    return apiError('Logo image is too large (max ~500KB). Use a smaller image.', 400)
  }

  const ref = await adminDb.collection('seo_reports').add({
    sprintId,
    orgId: sprint.orgId,
    clientName: config.clientName ?? '',
    brandColor: config.brandColor ?? null,
    logoDataUrl: config.logoDataUrl ?? null,
    from: config.from,
    to: config.to,
    sections: config.sections,
    shareToken: null,
    shareExpiresAt: null,
    createdAtIso: new Date().toISOString(),
    createdAt: FieldValue.serverTimestamp(),
    createdBy: user.uid ?? user.role,
    deleted: false,
  })

  return apiSuccess({ id: ref.id }, 201)
})
