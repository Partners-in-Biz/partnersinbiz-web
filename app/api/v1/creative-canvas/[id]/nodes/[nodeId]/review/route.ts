import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { updateCreativeCanvasNodeReview } from '@/lib/creative-canvas/collaboration'
import { getCreativeCanvas, updateCreativeCanvasGraph } from '@/lib/creative-canvas/store'
import type { CreativeCanvasActor, CreativeCanvasNode } from '@/lib/creative-canvas/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; nodeId: string }> }

const CLIENT_NOTE_MAX_LENGTH = 1000

type ClientReviewAction = 'approve' | 'request_changes'

// The client-review decision enriches the node's review gate with reviewer
// metadata. The graph sanitizer whitelists review fields, so the decision is
// mirrored into `data.clientReview` (data is persisted verbatim) to survive
// the sanitize pass on write.
type ClientReview = NonNullable<CreativeCanvasNode['review']> & {
  clientNote?: string
  reviewedBy: string
  reviewedByType: CreativeCanvasActor['type']
  reviewedAt: string
}

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

export const PUT = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id, nodeId } = await (context as RouteContext).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Malformed JSON body', 400)
  const payload = body as Record<string, unknown>

  if (!('action' in payload)) {
    // Legacy review-gate patch (status/rightsStatus/brandStatus) used by the
    // admin canvas workspace. Preserved as-is.
    const canvas = await updateCreativeCanvasNodeReview(id, orgId, nodeId, body, actorFromUser(user))
    return apiSuccess({ canvas })
  }

  // Client review decision: { action: 'approve' | 'request_changes', note? }
  const action = payload.action
  if (action !== 'approve' && action !== 'request_changes') {
    return apiError("action must be 'approve' or 'request_changes'", 400)
  }
  const note = typeof payload.note === 'string'
    ? payload.note.trim().slice(0, CLIENT_NOTE_MAX_LENGTH)
    : ''

  const canvas = await getCreativeCanvas(id, orgId)
  if (!canvas) return apiError('Creative canvas not found', 404)
  if (canvas.visibility !== 'admin_agents_clients' && user.role === 'client') {
    return apiError('This canvas is not shared for client review', 403)
  }

  const node = canvas.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return apiError('Canvas node not found', 404)

  const actor = actorFromUser(user)
  const reviewedAt = new Date().toISOString()
  const review: ClientReview = {
    ...(node.review ?? {}),
    status: (action as ClientReviewAction) === 'approve' ? 'passed' : 'needed',
    reviewedBy: actor.uid,
    reviewedByType: actor.type,
    reviewedAt,
  }
  if (note) review.clientNote = note

  const updatedNode: CreativeCanvasNode = {
    ...node,
    review,
    data: {
      ...node.data,
      clientReview: {
        action,
        status: review.status,
        note: note || null,
        reviewedBy: actor.uid,
        reviewedByType: actor.type,
        reviewedAt,
      },
    },
  }

  const nodes = canvas.nodes.map((candidate) => (candidate.id === nodeId ? updatedNode : candidate))
  await updateCreativeCanvasGraph(
    id,
    orgId,
    { nodes, edges: canvas.edges },
    actor,
    {
      expectedActiveVersion: canvas.activeVersion,
      mergeOnConflict: true,
      baseGraphInput: { nodes: canvas.nodes, edges: canvas.edges },
      reason: 'client_review',
    },
  )

  return apiSuccess({ node: updatedNode })
})
