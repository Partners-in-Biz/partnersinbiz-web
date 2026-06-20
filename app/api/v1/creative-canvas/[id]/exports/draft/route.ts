import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { buildCreativeCanvasDraftExport } from '@/lib/creative-canvas/exporters/drafts'
import { getCreativeCanvas } from '@/lib/creative-canvas/store'
import type { CreativeCanvasActor, CreativeCanvasExport } from '@/lib/creative-canvas/types'

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

function cleanTarget(value: unknown): CreativeCanvasExport['target'] | null {
  const allowed: CreativeCanvasExport['target'][] = [
    'social_draft',
    'campaign_asset',
    'client_document',
    'research',
    'youtube_studio',
    'book_studio',
    'workspace_artifact',
  ]
  return allowed.includes(value as CreativeCanvasExport['target']) ? value as CreativeCanvasExport['target'] : null
}

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as RouteContext).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)

  const canvas = await getCreativeCanvas(id, orgId)
  if (!canvas) return apiError('Creative canvas not found', 404)

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return apiError('Malformed JSON body', 400)

  const nodeId = typeof body.nodeId === 'string' ? body.nodeId : ''
  const target = cleanTarget(body.target)
  if (!target) return apiError('Unsupported creative canvas export target', 400)

  const node = canvas.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return apiError('Creative canvas output node not found', 404)

  const draft = buildCreativeCanvasDraftExport({
    canvas,
    node,
    target,
    actor: actorFromUser(user),
  })

  const ref = await adminDb.collection('creative_canvas_exports').add({
    ...draft.exportRecord,
    payload: draft.payload,
    createdAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({ exportId: ref.id, draft: draft.payload }, 201)
})
