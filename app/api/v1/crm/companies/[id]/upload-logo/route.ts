/**
 * POST /api/v1/crm/companies/:id/upload-logo — upload company logo to Firebase Storage
 *
 * Accepts multipart/form-data with a `file` field.
 * Allowed types: image/png, image/jpeg, image/webp, image/svg+xml
 * Max size: 5MB
 *
 * Stores at: companies/{orgId}/{id}/logo.{ext}
 * Returns: { logoUrl: string }
 *
 * Auth: member+
 */
import { FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { loadCompany } from '@/lib/companies/store'
import crypto from 'crypto'

type RouteCtx = { params: Promise<{ id: string }> }

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
])

const EXT_MAP: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

export const POST = withCrmAuth<RouteCtx>(
  'member',
  async (req, ctx, routeCtx) => {
    const { id } = await routeCtx!.params

    // Verify company exists and belongs to org
    const loaded = await loadCompany(id, ctx.orgId)
    if (!loaded) return apiError('Company not found', 404)

    // Parse multipart form-data
    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      return apiError('Invalid form data', 400)
    }

    const file = formData.get('file') as File | null
    if (!file) return apiError('No file provided', 400)

    // Validate content type
    if (!ALLOWED_TYPES.has(file.type)) {
      return apiError(
        'Invalid file type. Allowed: image/png, image/jpeg, image/webp, image/svg+xml',
        400,
      )
    }

    // Validate size
    if (file.size > MAX_FILE_SIZE) {
      return apiError('File too large. Maximum size is 5MB', 413)
    }

    const ext = EXT_MAP[file.type] ?? 'bin'
    const storagePath = `companies/${ctx.orgId}/${id}/logo.${ext}`

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    try {
      const bucket = getStorage(getAdminApp()).bucket()
      const fileRef = bucket.file(storagePath)
      const downloadToken = crypto.randomUUID()

      await fileRef.save(buffer, {
        metadata: {
          contentType: file.type,
          cacheControl: 'public, max-age=3600',
          metadata: { firebaseStorageDownloadTokens: downloadToken },
        },
      })

      const logoUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`

      // Update company doc with new logoUrl
      await loaded.ref.update({
        logoUrl,
        updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
        updatedByRef: ctx.actor,
        updatedAt: FieldValue.serverTimestamp(),
      })

      return apiSuccess({ logoUrl })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[companies/upload-logo] Storage error:', message)
      return apiError(`Storage error: ${message}`, 500)
    }
  },
)
