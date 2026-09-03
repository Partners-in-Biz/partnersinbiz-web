import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'
import { LINKED_RUN_JOBS } from '@/lib/linked-computers/run-queue-store'
import {
  CONVERSATION_ATTACHMENT_ALLOWED_MIME,
  CONVERSATION_ATTACHMENT_MAX_BYTES,
  storeConversationAttachment,
} from '@/lib/conversations/attachments-store'
import { getConversation } from '@/lib/conversations/conversations'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ deviceId: string; jobId: string }> }
type DeviceIdentity = Awaited<ReturnType<typeof authenticateSignedDeviceRequest>>

export const RUN_MEDIA_PER_RUN_CAP = 12

function mediaError(error: unknown): Response {
  const message = error instanceof Error ? error.message : ''
  if (message === 'Unsupported file type') {
    return NextResponse.json({ success: false, error: 'Unsupported file type' }, { status: 400, headers: noStoreHeaders })
  }
  if (message === 'File too large (max 10MB)') {
    return NextResponse.json({ success: false, error: 'File too large (max 10MB)' }, { status: 413, headers: noStoreHeaders })
  }
  if (message === 'linked computers: run media cap exceeded') {
    return NextResponse.json({ success: false, error: 'Run media cap exceeded' }, { status: 400, headers: noStoreHeaders })
  }
  return lifecycleError(error)
}

function sanitizeFilename(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  const base = raw.replace(/\\/g, '/').split('/').pop()?.trim() ?? ''
  if (!base || base === '.' || base.includes('..') || base.length > 200) return ''
  return base
}

export async function handleLinkedRunMedia(
  req: NextRequest,
  deviceId: string,
  jobId: string,
  auth: (request: NextRequest, deviceId: string, rawBody: string) => Promise<DeviceIdentity> = authenticateSignedDeviceRequest,
  store: typeof storeConversationAttachment = storeConversationAttachment,
): Promise<Response> {
  try {
    const rawBody = await req.text()
    const identity = await auth(req, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('linked computers: tenant scope mismatch')

    const body = JSON.parse(rawBody) as { filename?: unknown; contentType?: unknown; bytesBase64?: unknown }
    const filename = sanitizeFilename(body.filename)
    const contentType = typeof body.contentType === 'string' ? body.contentType.trim().toLowerCase() : ''
    const bytesBase64 = typeof body.bytesBase64 === 'string' ? body.bytesBase64 : ''
    if (!filename || !contentType || !bytesBase64) throw new Error('linked computers: invalid run media')
    if (!CONVERSATION_ATTACHMENT_ALLOWED_MIME.has(contentType)) {
      throw new Error('Unsupported file type')
    }
    if (bytesBase64.length > Math.ceil(CONVERSATION_ATTACHMENT_MAX_BYTES * 4 / 3) + 1_024) {
      throw new Error('File too large (max 10MB)')
    }
    const bytes = Buffer.from(bytesBase64, 'base64')
    if (!bytes.byteLength) throw new Error('linked computers: invalid run media')
    if (bytes.byteLength > CONVERSATION_ATTACHMENT_MAX_BYTES) {
      throw new Error('File too large (max 10MB)')
    }

    const jobRef = adminDb.collection(LINKED_RUN_JOBS).doc(jobId)
    const reserved = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(jobRef)
      if (!snap.exists) throw new Error('linked computers: run not found')
      const job = snap.data() ?? {}
      if (job.deviceId !== deviceId) throw new Error('linked computers: tenant scope mismatch')
      const orgId = typeof job.orgId === 'string' ? job.orgId : ''
      const conversationId = typeof job.conversationId === 'string' ? job.conversationId : ''
      if (!orgId || !conversationId) throw new Error('linked computers: invalid run media')
      const count = Number(job.mediaUploadCount ?? 0)
      if (!Number.isFinite(count) || count >= RUN_MEDIA_PER_RUN_CAP) {
        throw new Error('linked computers: run media cap exceeded')
      }
      tx.update(jobRef, {
        mediaUploadCount: count + 1,
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { orgId, conversationId }
    })

    const conversation = await getConversation(reserved.conversationId).catch(() => null)
    const visibility = conversation?.crossOrg
      ? {
          principalIds: conversation.crossOrg.participants
            .filter((participant) => participant.status === 'active')
            .map((participant) => participant.principalId),
        }
      : undefined

    const stored = await store({
      orgId: reserved.orgId,
      conversationId: reserved.conversationId,
      filename,
      contentType,
      bytes,
      actor: { createdBy: identity.ownerUserId, createdByType: 'system' },
      ...(visibility ? { visibility } : {}),
    })

    return NextResponse.json({ success: true, data: { url: stored.url } }, { headers: noStoreHeaders })
  } catch (error) {
    return mediaError(error)
  }
}

export const POST = async (req: NextRequest, context: Context) => {
  const { deviceId, jobId } = await context.params
  return handleLinkedRunMedia(req, deviceId, jobId)
}
