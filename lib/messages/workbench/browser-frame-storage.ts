import crypto from 'node:crypto'
import { getStorage } from 'firebase-admin/storage'
import { getAdminApp } from '@/lib/firebase/admin'

/**
 * Storage for headless-Chrome screenshot frames captured by a linked
 * computer's browser control session. Mirrors the two existing upload
 * patterns in this codebase: `conversation-attachments` (raw bytes ->
 * `bucket.file(path).save(buffer, { metadata })`, see the attachments
 * route) and `project-sync/storage.ts` (a durable object path plus a
 * short-lived v4 signed download URL). Frames are small and ephemeral (a
 * session lives at most 30 minutes), so unlike attachments there is no
 * durable Firestore record per frame and no user-facing download proxy
 * route — only the signed URL, embedded directly as `imageUrl` in the
 * session's progress stream.
 */

export const MAX_WORKBENCH_BROWSER_FRAME_BYTES = 1_572_864 // 1.5MB
/** Comfortably longer than the 30-minute session TTL so a signed URL never expires mid-session. */
const FRAME_URL_TTL_MS = 60 * 60 * 1000
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

const FRAME_CONTENT_TYPE_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

export type WorkbenchBrowserFrameContentType = keyof typeof FRAME_CONTENT_TYPE_EXTENSION

export function isWorkbenchBrowserFrameContentType(value: string): value is WorkbenchBrowserFrameContentType {
  return value === 'image/jpeg' || value === 'image/png'
}

function identifier(value: string, field: string): string {
  const clean = value.trim()
  if (!SAFE_ID.test(clean)) throw new Error(`workbench: browser frame ${field} is invalid`)
  return clean
}

export interface StoreWorkbenchBrowserFrameInput {
  orgId: string
  conversationId: string
  sessionId: string
  seq: number
  contentType: WorkbenchBrowserFrameContentType
  bytes: Buffer
}

export interface StoredWorkbenchBrowserFrame {
  imageUrl: string
  storagePath: string
  contentType: WorkbenchBrowserFrameContentType
}

export async function storeWorkbenchBrowserFrame(input: StoreWorkbenchBrowserFrameInput): Promise<StoredWorkbenchBrowserFrame> {
  if (!Number.isSafeInteger(input.seq) || input.seq < 0) throw new Error('workbench: browser frame seq is invalid')
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_WORKBENCH_BROWSER_FRAME_BYTES) {
    throw new Error('workbench: browser frame exceeds the size limit')
  }
  const orgId = identifier(input.orgId, 'orgId')
  const conversationId = identifier(input.conversationId, 'conversationId')
  const sessionId = identifier(input.sessionId, 'sessionId')
  const extension = FRAME_CONTENT_TYPE_EXTENSION[input.contentType]
  const random = crypto.randomBytes(8).toString('hex')
  const storagePath = `workbench-browser-frames/${orgId}/${conversationId}/${sessionId}/${input.seq}-${random}.${extension}`

  const bucket = getStorage(getAdminApp()).bucket()
  const file = bucket.file(storagePath)
  await file.save(input.bytes, {
    metadata: {
      contentType: input.contentType,
      cacheControl: 'private, max-age=0, no-store',
    },
  })
  const expiresAtMs = Date.now() + FRAME_URL_TTL_MS
  const [imageUrl] = await file.getSignedUrl({ version: 'v4', action: 'read', expires: new Date(expiresAtMs) })
  return { imageUrl, storagePath, contentType: input.contentType }
}
