import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { ensureOrgAccess, updateActorFields } from '@/lib/youtube-studio/api'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const DELETE = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const ref = adminDb.collection(VIDEO_EDITOR_COLLECTIONS.luts).doc(id)
  const snap = await ref.get()
  const data = snap.exists ? (snap.data() as Record<string, unknown>) : undefined
  if (!data || data.deleted === true || data.orgId !== orgId) return apiError('LUT not found', 404)

  await ref.set({ deleted: true, ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id })
})
