import crypto from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'

export const CONVERSATION_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
export const CONVERSATION_ATTACHMENT_ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

export type StoredConversationAttachment = {
  id: string
  name: string
  url: string
  contentType: string
  sizeBytes: number
  storagePath: string
}

export function conversationAttachmentExtension(filename: string, contentType: string): string {
  const ext = filename.split('.').pop()?.trim().toLowerCase()
  if (ext && /^[a-z0-9]{1,12}$/.test(ext)) return ext
  if (contentType === 'image/jpeg') return 'jpg'
  if (contentType === 'image/png') return 'png'
  if (contentType === 'image/gif') return 'gif'
  if (contentType === 'image/webp') return 'webp'
  if (contentType === 'application/pdf') return 'pdf'
  return 'bin'
}

export async function storeConversationAttachment(input: {
  orgId: string
  conversationId: string
  filename: string
  contentType: string
  bytes: Buffer
  actor?: Record<string, unknown>
  visibility?: { principalIds: string[] }
}): Promise<StoredConversationAttachment> {
  const contentType = input.contentType.toLowerCase()
  if (!CONVERSATION_ATTACHMENT_ALLOWED_MIME.has(contentType)) {
    throw new Error('Unsupported file type')
  }
  if (input.bytes.byteLength > CONVERSATION_ATTACHMENT_MAX_BYTES) {
    throw new Error('File too large (max 10MB)')
  }

  const bucket = getStorage(getAdminApp()).bucket()
  const id = crypto.randomBytes(12).toString('hex')
  const storagePath = `conversation-attachments/${input.orgId}/${input.conversationId}/${id}.${conversationAttachmentExtension(input.filename, contentType)}`
  await bucket.file(storagePath).save(input.bytes, {
    metadata: { contentType },
  })

  const url = `/api/v1/conversations/${input.conversationId}/attachments/${id}`
  const docRef = await adminDb.collection('conversation_attachments').add({
    conversationId: input.conversationId,
    orgId: input.orgId,
    name: input.filename,
    storagePath,
    contentType,
    sizeBytes: input.bytes.byteLength,
    ...(input.visibility ? { visibility: input.visibility } : {}),
    deleted: false,
    ...(input.actor ?? {}),
    createdAt: FieldValue.serverTimestamp(),
  })

  return {
    id: docRef.id,
    name: input.filename,
    url,
    contentType,
    sizeBytes: input.bytes.byteLength,
    storagePath,
  }
}
