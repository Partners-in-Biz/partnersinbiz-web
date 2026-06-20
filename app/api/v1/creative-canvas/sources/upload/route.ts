import crypto from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { NextRequest } from 'next/server'
import { actorFrom } from '@/lib/api/actor'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'
import type { CreativeCanvasReferenceRole, CreativeCanvasSourceLibraryItem } from '@/lib/creative-canvas/types'

export const dynamic = 'force-dynamic'

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
const ALLOWED_PREFIXES = ['image/', 'video/', 'audio/']
const ALLOWED_TYPES = ['application/pdf']

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function canAccessOrg(user: ApiUser, orgId: string): boolean {
  if (user.role === 'admin') {
    const allowed = user.allowedOrgIds ?? []
    return allowed.length === 0 || allowed.includes(orgId) || user.orgId === orgId
  }
  const orgIds = user.orgIds?.length ? user.orgIds : (user.orgId ? [user.orgId] : [])
  return orgIds.includes(orgId)
}

function cleanReferenceRole(value: unknown): CreativeCanvasReferenceRole {
  const allowed: CreativeCanvasReferenceRole[] = ['general', 'product', 'person', 'character', 'style', 'background', 'logo', 'mask', 'motion']
  return allowed.includes(value as CreativeCanvasReferenceRole) ? value as CreativeCanvasReferenceRole : 'general'
}

function isAllowedMimeType(mimeType: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => mimeType.startsWith(prefix)) || ALLOWED_TYPES.includes(mimeType)
}

function fileExtension(fileName: string): string {
  const ext = fileName.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  return ext || 'bin'
}

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const formData = await req.formData().catch(() => null)
  if (!formData) return apiError('Invalid form data', 400)

  const orgId = cleanString(formData.get('orgId'))
  if (!orgId) return apiError('orgId is required', 400)
  if (!canAccessOrg(user, orgId)) return apiError('You do not have access to this organisation', 403)

  const file = formData.get('file') as File | null
  if (!file) return apiError('No file provided', 400)
  const mimeType = file.type || 'application/octet-stream'
  if (!isAllowedMimeType(mimeType)) return apiError('Creative Canvas sources must be image, video, audio, or PDF files', 400)
  if (file.size > MAX_UPLOAD_BYTES) return apiError('Creative Canvas source upload is too large', 413)

  const canvasId = cleanString(formData.get('canvasId'))
  const referenceRole = cleanReferenceRole(formData.get('referenceRole'))
  const altText = cleanString(formData.get('altText')) ?? file.name
  const folder = `creative-canvas/${orgId}${canvasId ? `/${canvasId}` : ''}`
  const storagePath = `${folder}/${Date.now()}-${crypto.randomUUID()}.${fileExtension(file.name)}`
  const buffer = Buffer.from(await file.arrayBuffer())

  try {
    const bucket = getStorage(getAdminApp()).bucket()
    const fileRef = bucket.file(storagePath)
    const downloadToken = crypto.randomUUID()
    await fileRef.save(buffer, {
      metadata: {
        contentType: mimeType,
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
    })

    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`
    const uploadDoc = {
      orgId,
      name: file.name,
      filename: file.name,
      storagePath,
      url,
      previewUrl: url,
      thumbnailUrl: mimeType.startsWith('image/') ? url : undefined,
      mimeType,
      size: file.size,
      folder,
      source: 'creative_canvas',
      referenceRole,
      altText,
      relatedTo: canvasId ? { type: 'creative_canvas', id: canvasId } : { type: 'creative_canvas' },
      ...actorFrom(user),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      deleted: false,
    }

    const ref = await adminDb.collection('uploads').add(uploadDoc)
    const source: CreativeCanvasSourceLibraryItem = {
      id: `upload:${ref.id}`,
      title: file.name,
      description: `Upload / ${mimeType}`,
      sourceCollection: 'uploads',
      source: {
        kind: 'upload',
        refId: ref.id,
        url,
        thumbnailUrl: mimeType.startsWith('image/') ? url : undefined,
        previewUrl: url,
        storagePath,
        mimeType,
        altText,
        referenceRole,
        weight: 1,
      },
    }

    return apiSuccess({ upload: { id: ref.id, url, storagePath, name: file.name, mimeType, size: file.size }, source }, 201)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[creative-canvas-source-upload] Firebase Storage error:', message)
    return apiError(`Storage error: ${message}`, 500)
  }
})
