// Storage upload helper for Book Studio assembly artifacts (interior PDF,
// cover PDF, EPUB). Clones the download-token scheme from
// lib/social/storage.ts so uploaded files work on uniform-bucket-level-access
// buckets without relying on bucket.makePublic().

import { getStorage } from 'firebase-admin/storage'
import { getAdminApp } from '@/lib/firebase/admin'
import crypto from 'crypto'

export async function uploadBookFileToStorage(
  buffer: Buffer,
  mimeType: string,
  orgId: string,
  projectId: string,
  filename: string,
): Promise<{ publicUrl: string; storagePath: string }> {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const id = crypto.randomBytes(6).toString('hex')
  const storagePath = `book-studio/${orgId}/${projectId}/${id}-${safeFilename}`

  // Bake a permanent Firebase download token into the object metadata at
  // upload time. `bucket.makePublic()` doesn't work on
  // uniform-bucket-level-access buckets (the security default), so use the
  // same download-token scheme the Firebase client SDK's getDownloadURL()
  // uses — tokens never expire, the URL is shareable, no per-request signing.
  const downloadToken = crypto.randomUUID()

  const bucket = getStorage(getAdminApp()).bucket()
  const file = bucket.file(storagePath)
  await file.save(buffer, {
    metadata: {
      contentType: mimeType,
      metadata: { firebaseStorageDownloadTokens: downloadToken },
    },
  })

  const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`
  return { publicUrl, storagePath }
}
