import crypto from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'
import { actorFrom } from '@/lib/api/actor'
import type { ApiUser } from '@/lib/api/types'

export interface SavedVideoEditorUpload {
  id: string
  url: string
  storagePath: string
  sizeBytes: number
}

/**
 * Server-side twin of POST /api/v1/upload: writes a generated buffer to
 * Firebase Storage with a download token and records an `uploads` doc so the
 * file is a first-class MediaRef ({ type: 'upload', fileId }).
 */
export async function saveVideoEditorUpload(
  buffer: Buffer,
  input: { orgId: string; folder: string; filename: string; mimeType: string; user: ApiUser; relatedTo?: { type: string; id: string } },
): Promise<SavedVideoEditorUpload> {
  const safeFilename = input.filename.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 120)
  if (!safeFilename) throw new Error('A filename is required')
  const storagePath = `${input.folder}/${safeFilename}`

  const bucket = getStorage(getAdminApp()).bucket()
  const downloadToken = crypto.randomUUID()
  await bucket.file(storagePath).save(buffer, {
    metadata: { contentType: input.mimeType, metadata: { firebaseStorageDownloadTokens: downloadToken } },
  })
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`

  const docRef = await adminDb.collection('uploads').add({
    orgId: input.orgId,
    name: safeFilename,
    storagePath,
    url,
    mimeType: input.mimeType,
    size: buffer.length,
    folder: input.folder,
    relatedTo: input.relatedTo ?? null,
    ...actorFrom(input.user),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
  })

  return { id: docRef.id, url, storagePath, sizeBytes: buffer.length }
}
