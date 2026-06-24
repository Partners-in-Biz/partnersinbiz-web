// app/api/v1/org/data-export/[id]/download/route.ts
//
// Authenticated download for a GDPR org-wide data export (US-196).
//
// The export file is stored privately in Firebase Storage with NO public
// download token. This route is the only way to fetch it: it re-runs the
// portal admin auth, verifies the job belongs to the caller's resolved org,
// and mints a short-lived (~15 min) signed URL on demand. If signing is
// unavailable it falls back to streaming the bytes through this authenticated
// endpoint.
//
// GET (admin) -> apiSuccess({ url }) with a 15-minute signed URL.

import { NextRequest } from 'next/server'
import { getStorage } from 'firebase-admin/storage'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const SIGNED_URL_TTL_MS = 15 * 60 * 1000

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withPortalAuthAndRole(
  'admin',
  async (_req: NextRequest, _uid: string, orgId: string, _role, context?: RouteContext) => {
    try {
      const { id } = await context!.params
      if (!id) return apiError('Missing export id', 400)

      const jobSnap = await adminDb.collection('data_exports').doc(id).get()
      if (!jobSnap.exists) return apiError('Export not found', 404)

      const job = jobSnap.data() as Record<string, unknown>

      // Enforce tenant isolation: the job must belong to the caller's org.
      if (job.orgId !== orgId) return apiError('Forbidden', 403)

      if (job.status !== 'complete') return apiError('Export is not ready for download', 409)

      const storagePath = typeof job.storagePath === 'string' ? job.storagePath : null
      if (!storagePath) return apiError('Export file is unavailable', 404)

      const bucket = getStorage(getAdminApp()).bucket()
      const fileRef = bucket.file(storagePath)

      try {
        const [signedUrl] = await fileRef.getSignedUrl({
          action: 'read',
          expires: Date.now() + SIGNED_URL_TTL_MS,
        })
        return apiSuccess({ url: signedUrl, expiresInSeconds: SIGNED_URL_TTL_MS / 1000 })
      } catch (signErr) {
        // Signing unavailable (e.g. no service-account key) — stream the bytes
        // through this already-authenticated endpoint instead.
        console.error('[org/data-export/download] signing failed, streaming bytes:', signErr)
        const [buffer] = await fileRef.download()
        return new Response(new Uint8Array(buffer), {
          headers: {
            'content-type': 'application/json',
            'content-disposition': `attachment; filename="data-export-${orgId}-${id}.json"`,
          },
        })
      }
    } catch (err) {
      return apiErrorFromException(err)
    }
  },
)
