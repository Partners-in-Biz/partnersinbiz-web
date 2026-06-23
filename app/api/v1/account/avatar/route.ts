// app/api/v1/account/avatar/route.ts
import { NextRequest } from 'next/server'
import { getStorage } from 'firebase-admin/storage'
import crypto from 'crypto'
import { getAdminApp } from '@/lib/firebase/admin'
import { withPortalAuth } from '@/lib/auth/portal-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

const MAX_FILE_SIZE = 5 * 1024 * 1024

export const POST = withPortalAuth(async (req: NextRequest, uid: string) => {
  const formData = await req.formData().catch(() => null)
  if (!formData) return apiError('Invalid form data', 400)

  const file = formData.get('file') as File | null
  if (!file) return apiError('No file provided', 400)
  if (!file.type.startsWith('image/')) return apiError('Only image uploads are supported', 400)
  if (file.size > MAX_FILE_SIZE) return apiError('Image is too large. Maximum size is 5MB.', 413)

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png'
  const filename = `avatars/${uid}/${Date.now()}-${crypto.randomUUID()}.${ext}`

  const buffer = Buffer.from(await file.arrayBuffer())

  try {
    const bucket = getStorage(getAdminApp()).bucket()
    const fileRef = bucket.file(filename)
    const downloadToken = crypto.randomUUID()

    await fileRef.save(buffer, {
      metadata: {
        contentType: file.type,
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
    })

    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filename)}?alt=media&token=${downloadToken}`

    return apiSuccess({ url })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[account/avatar] Firebase Storage error:', message)
    return apiError(`Storage error: ${message}`, 500)
  }
})
