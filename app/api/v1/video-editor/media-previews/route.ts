import { NextRequest } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess } from '@/lib/youtube-studio/api'
import { ensureMediaPreviews } from '@/lib/video-editor/media-previews-server'
import { sanitizeMediaRef, serializeVideoEditorRecord } from '@/lib/video-editor/sanitize'
import { VIDEO_EDITOR_PREVIEW_COLLECTIONS } from '@/lib/video-editor/types'
import type { MediaRef, VideoEditorMediaPreview } from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

const LEDGER_TOUCH_MIN_AGE_MS = 60 * 60 * 1000

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' && body.orgId.trim()
    ? body.orgId.trim()
    : new URL(req.url).searchParams.get('orgId') ?? ''
  if (!orgId) return apiError('orgId is required', 400)
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const refs = (Array.isArray(body.refs) ? body.refs : [])
    .map((entry: unknown) => sanitizeMediaRef(entry))
    .filter((entry: MediaRef | undefined): entry is MediaRef => Boolean(entry))
  if (!refs.length) return apiError('At least one valid media ref is required', 400)
  if (refs.length > 50) return apiError('Too many refs (max 50 per call)', 400)
  const previews = await ensureMediaPreviews(orgId, refs, user)
  return apiSuccess({ previews })
})

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId') ?? ''
  if (!orgId) return apiError('orgId is required', 400)
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const keys = (url.searchParams.get('keys') ?? '').split(',').map((key) => key.trim()).filter(Boolean).slice(0, 100)

  const collection = adminDb.collection(VIDEO_EDITOR_PREVIEW_COLLECTIONS.mediaPreviews)
  let docs
  if (keys.length) {
    docs = []
    for (let i = 0; i < keys.length; i += 10) {
      const chunk = await collection.where('orgId', '==', orgId).where('mediaKey', 'in', keys.slice(i, i + 10)).get()
      docs.push(...chunk.docs)
    }
  } else {
    docs = (await collection.where('orgId', '==', orgId).limit(200).get()).docs
  }

  const previews = docs
    .filter((doc) => doc.data().deleted !== true)
    .map((doc) => serializeVideoEditorRecord<VideoEditorMediaPreview>(doc.id, doc.data()))

  // LRU touch: previews with a proxy that were last accessed over an hour ago.
  const ledger = adminDb.collection(VIDEO_EDITOR_PREVIEW_COLLECTIONS.proxyLedger)
  const cutoffMillis = Date.now() - LEDGER_TOUCH_MIN_AGE_MS
  await Promise.all(previews.filter((preview) => preview.proxy).map(async (preview) => {
    const entry = await ledger.doc(preview.id).get()
    const lastAccessAt = entry.get('lastAccessAt') as Timestamp | undefined
    if (entry.exists && (!lastAccessAt || lastAccessAt.toMillis() < cutoffMillis)) {
      await entry.ref.set({ lastAccessAt: FieldValue.serverTimestamp() }, { merge: true })
    }
  }))

  return apiSuccess({ previews })
})
