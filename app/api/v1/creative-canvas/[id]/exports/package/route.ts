import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import { buildCreativeCanvasExportPackage } from '@/lib/creative-canvas/exporters/package'
import { getCreativeCanvas } from '@/lib/creative-canvas/store'
import type { CreativeCanvasActor } from '@/lib/creative-canvas/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function resolveOrgId(req: NextRequest, user: ApiUser): string | null {
  const url = new URL(req.url)
  return url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.orgId ?? user.orgIds?.[0] ?? null
}

function actorFromUser(user: ApiUser): CreativeCanvasActor {
  return {
    uid: user.uid,
    type: user.role === 'ai' ? 'agent' : 'user',
  }
}

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as RouteContext).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  const body = await req.json().catch(() => null) as { nodeIds?: unknown; title?: unknown } | null
  const canvas = await getCreativeCanvas(id, orgId)
  if (!canvas) return apiError('Creative canvas not found', 404)
  const nodeIds = Array.isArray(body?.nodeIds)
    ? body.nodeIds.filter((nodeId): nodeId is string => typeof nodeId === 'string' && Boolean(nodeId.trim()))
    : undefined

  try {
    const pack = buildCreativeCanvasExportPackage({
      canvas,
      actor: actorFromUser(user),
      nodeIds,
      title: typeof body?.title === 'string' ? body.title : undefined,
    })
    const ref = await adminDb.collection('creative_canvas_export_packages').add({
      ...pack.exportRecord,
      payload: pack.payload,
      createdAt: FieldValue.serverTimestamp(),
    })
    return apiSuccess({ exportId: ref.id, package: pack.payload }, 201)
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Creative canvas export package failed', 400)
  }
})
