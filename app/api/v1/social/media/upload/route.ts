// app/api/v1/social/media/upload/route.ts
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'
import { uploadMediaToStorage } from '@/lib/social/storage'
import { probeSocialMediaMetadata } from '@/lib/social/media-metadata'
import type { MediaType, MediaStatus } from '@/lib/social/providers'

export const dynamic = 'force-dynamic'

const MAX_SIZE_BYTES = 512 * 1024 * 1024
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/quicktime',
]

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
}

export const POST = withAuth('client', withTenant(async (req, user, orgId) => {
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > MAX_SIZE_BYTES) {
    return apiError('File exceeds 512MB limit', 413)
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return apiError('Request must be multipart/form-data')
  }

  const file = formData.get('file') as File | null
  if (!file) return apiError('file field is required')
  if (!ALLOWED_TYPES.includes(file.type)) {
    return apiError(`Unsupported file type: ${file.type}. Allowed: ${ALLOWED_TYPES.join(', ')}`)
  }
  if (file.size > MAX_SIZE_BYTES) {
    return apiError(`File exceeds 512MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB)`)
  }

  const altText = (formData.get('altText') as string | null) ?? ''
  const buffer = Buffer.from(await file.arrayBuffer())

  const type: MediaType = file.type.startsWith('video/')
    ? 'video'
    : file.type === 'image/gif'
    ? 'gif'
    : 'image'
  const metadata = await probeSocialMediaMetadata({ buffer, mimeType: file.type })

  let publicUrl: string
  let storagePath: string
  try {
    const safeFilename = `upload.${MIME_TO_EXT[file.type] ?? 'bin'}`
    const result = await uploadMediaToStorage(buffer, file.type, orgId, safeFilename)
    publicUrl = result.publicUrl
    storagePath = result.storagePath
  } catch (err) {
    console.error('[media/upload] storage upload error:', err)
    return apiError('Upload failed. Please try again.', 500)
  }

  let docId: string
  try {
    const doc = {
      orgId,
      originalUrl: publicUrl,
      originalFilename: file.name,
      originalMimeType: file.type,
      originalSize: file.size,
      status: 'ready' as MediaStatus,
      variants: {},
      thumbnailUrl: publicUrl,
      type,
      width: metadata.width,
      height: metadata.height,
      duration: metadata.duration,
      altText,
      storagePath,
      usedInPosts: [],
      uploadedBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    const docRef = await adminDb.collection('social_media').add(doc)
    docId = docRef.id
  } catch (err) {
    console.error('[media/upload] Firestore write error:', err)
    return apiError('Failed to save media record. Please try again.', 500)
  }

  return apiSuccess({ id: docId, url: publicUrl, type, mimeType: file.type }, 201)
}))
