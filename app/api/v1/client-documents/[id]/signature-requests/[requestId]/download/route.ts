import { NextRequest } from 'next/server'
import { getStorage } from 'firebase-admin/storage'

import { withAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getAccessibleClientDocument } from '@/lib/client-documents/access'
import { issueDocumentArtifactReadUrl } from '@/lib/client-documents/artifacts'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; requestId: string }> }

/**
 * Authenticated signed-copy download.
 * Revalidates document.download grant on every request and either streams the
 * PDF or returns a short-lived signed URL (?mode=url). Durable firebase tokens
 * are never exposed.
 */
export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id, requestId } = await ctx.params
  const access = await getAccessibleClientDocument(id, user, 'attachments')
  if (!access.ok) return access.response

  const requestSnap = await adminDb
    .collection(CLIENT_DOCUMENTS_COLLECTION)
    .doc(id)
    .collection('signature_requests')
    .doc(requestId)
    .get()
  if (!requestSnap.exists) return apiError('Signature request not found', 404)

  const request = requestSnap.data() ?? {}
  const storagePath = typeof request.pdfSnapshotPath === 'string' ? request.pdfSnapshotPath.trim() : ''
  if (!storagePath) return apiError('Signed copy not available', 404)
  if (request.status !== 'signed') return apiError('Signature request is not signed', 409)

  const mode = req.nextUrl.searchParams.get('mode')
  if (mode === 'url') {
    try {
      const issued = await issueDocumentArtifactReadUrl(storagePath)
      return Response.json(
        { success: true, data: issued },
        {
          status: 200,
          headers: {
            'Cache-Control': 'private, no-store, max-age=0',
            Pragma: 'no-cache',
          },
        },
      )
    } catch {
      return apiError('Signed copy not available', 404)
    }
  }

  try {
    const [buffer] = await getStorage(getAdminApp()).bucket().file(storagePath).download()
    const fileName = `signed-${requestId}.pdf`.replace(/["\r\n]/g, '_')
    return new Response(Uint8Array.from(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Cache-Control': 'private, no-store, max-age=0',
        Pragma: 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return apiError('Signed copy not available', 404)
  }
})
