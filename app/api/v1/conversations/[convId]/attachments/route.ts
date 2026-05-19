import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import crypto from 'crypto'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import { getConversation } from '@/lib/conversations/conversations'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string }> }

const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_MIME = new Set([
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

function canAccess(user: ApiUser, participantUids: string[]): boolean {
  if (user.role === 'admin' || user.role === 'ai') return true
  return participantUids.includes(user.uid)
}

function extensionFor(file: File): string {
  const ext = file.name.split('.').pop()?.trim().toLowerCase()
  if (ext && /^[a-z0-9]{1,12}$/.test(ext)) return ext
  if (file.type === 'image/jpeg') return 'jpg'
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/gif') return 'gif'
  if (file.type === 'image/webp') return 'webp'
  if (file.type === 'application/pdf') return 'pdf'
  return 'bin'
}

export const POST = withAuth(
  'client',
  async (req: NextRequest, user: ApiUser, context?: unknown) => {
    const { convId } = await (context as Params).params
    const conversation = await getConversation(convId)
    if (!conversation) return apiError('Conversation not found', 404)
    if (!canAccess(user, conversation.participantUids)) return apiError('Forbidden', 403)

    const contentLengthHeader = req.headers.get('content-length')
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader)
      if (Number.isFinite(contentLength) && contentLength > MAX_BYTES + 64 * 1024) {
        return apiError('File too large (max 10MB)', 413)
      }
    }

    const formData = await req.formData().catch(() => null)
    if (!formData) return apiError('Invalid form data', 400)

    const file = formData.get('file') as File | null
    if (!file) return apiError('No file provided', 400)
    if (file.size > MAX_BYTES) return apiError('File too large (max 10MB)', 413)

    const contentType = (file.type || 'application/octet-stream').toLowerCase()
    if (!ALLOWED_MIME.has(contentType)) {
      return apiError('Unsupported file type', 400)
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.byteLength > MAX_BYTES) return apiError('File too large (max 10MB)', 413)

    try {
      const bucket = getStorage(getAdminApp()).bucket()
      const id = crypto.randomBytes(12).toString('hex')
      const storagePath = `conversation-attachments/${conversation.orgId}/${convId}/${id}.${extensionFor(file)}`
      const downloadToken = crypto.randomUUID()
      const storageFile = bucket.file(storagePath)

      await storageFile.save(buffer, {
        metadata: {
          contentType,
          metadata: { firebaseStorageDownloadTokens: downloadToken },
        },
      })

      const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`
      const docRef = await adminDb.collection('conversation_attachments').add({
        conversationId: convId,
        orgId: conversation.orgId,
        name: file.name,
        storagePath,
        url,
        contentType,
        sizeBytes: buffer.byteLength,
        deleted: false,
        ...actorFrom(user),
        createdAt: FieldValue.serverTimestamp(),
      })

      return apiSuccess({
        id: docRef.id,
        name: file.name,
        url,
        contentType,
        sizeBytes: buffer.byteLength,
        storagePath,
      }, 201)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[conversation-attachments] Firebase Storage error:', message)
      return apiError(`Storage error: ${message}`, 500)
    }
  },
)
