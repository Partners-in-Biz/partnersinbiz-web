import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess } from '@/lib/youtube-studio/api'
import { serializeVideoEditorRecord } from '@/lib/video-editor/sanitize'
import { VIDEO_EDITOR_PREVIEW_COLLECTIONS } from '@/lib/video-editor/types'
import type { VideoEditorProxyLedgerEntry } from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const orgId = new URL(req.url).searchParams.get('orgId') ?? ''
  if (!orgId) return apiError('orgId is required', 400)
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const snapshot = await adminDb.collection(VIDEO_EDITOR_PREVIEW_COLLECTIONS.proxyLedger)
    .where('orgId', '==', orgId)
    .orderBy('lastAccessAt', 'asc')
    .limit(500)
    .get()
  const entries = snapshot.docs.map((doc) => serializeVideoEditorRecord<VideoEditorProxyLedgerEntry>(doc.id, doc.data()))
  const totalBytes = entries.reduce((sum, entry) => sum + (typeof entry.sizeBytes === 'number' ? entry.sizeBytes : 0), 0)
  return apiSuccess({ entries, totalBytes })
})
