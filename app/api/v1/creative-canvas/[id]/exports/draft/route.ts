import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { buildCreativeCanvasDraftExport } from '@/lib/creative-canvas/exporters/drafts'
import { getCreativeCanvas } from '@/lib/creative-canvas/store'
import type { CreativeCanvas, CreativeCanvasActor, CreativeCanvasExport, CreativeCanvasNode } from '@/lib/creative-canvas/types'

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
    'blog_post',
    'research',
    'youtube_studio',
    'book_studio',
    'workspace_artifact',
  ]
  return allowed.includes(value as CreativeCanvasExport['target']) ? value as CreativeCanvasExport['target'] : null
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(cleanString).filter((item): item is string => Boolean(item))))
}

function collectUpstreamSourceNodeIds(canvas: CreativeCanvas, outputNodeId: string): string[] {
  const sourceNodeIds = new Set(canvas.nodes.filter((node) => node.type === 'source').map((node) => node.id))
  const byTarget = (canvas.edges ?? []).reduce<Record<string, string[]>>((acc, edge) => {
    acc[edge.targetNodeId] = [...(acc[edge.targetNodeId] ?? []), edge.sourceNodeId]
    return acc
  }, {})
  const lineage = new Set<string>()
  const visited = new Set<string>()
  const visit = (nodeId: string) => {
    for (const sourceNodeId of byTarget[nodeId] ?? []) {
      if (visited.has(sourceNodeId)) continue
      visited.add(sourceNodeId)
      if (sourceNodeIds.has(sourceNodeId)) lineage.add(sourceNodeId)
      visit(sourceNodeId)
    }
  }
  visit(outputNodeId)
  return Array.from(lineage)
}

function sourceLineageFrom(
  canvas: CreativeCanvas,
  node: CreativeCanvasNode,
  body: Record<string, unknown>,
): string[] {
  const sourceNodeIds = new Set(canvas.nodes.filter((candidate) => candidate.type === 'source').map((candidate) => candidate.id))
  const explicitLineage = cleanStringArray(body.lineageSourceNodeIds)
  const nodeLineage = cleanStringArray(node.data.lineageSourceNodeIds)
  const nodeSourceIds = cleanStringArray(node.data.sourceNodeIds)
  const requested = explicitLineage.length ? explicitLineage : nodeLineage.length ? nodeLineage : nodeSourceIds
  const lineage = requested.length ? requested.filter((nodeId) => sourceNodeIds.has(nodeId)) : collectUpstreamSourceNodeIds(canvas, node.id)
  return Array.from(new Set(lineage))
}

function linkedDownstreamDraftId(canvas: CreativeCanvas, target: CreativeCanvasExport['target']): string | undefined {
  switch (target) {
    case 'social_draft':
      return cleanString(canvas.linked?.socialPostId)
    case 'campaign_asset':
      return cleanString(canvas.linked?.campaignId)
    case 'client_document':
    case 'blog_post':
      return cleanString(canvas.linked?.clientDocumentId)
    case 'research':
      return cleanString(canvas.linked?.researchItemId)
    case 'youtube_studio':
      return cleanString(canvas.linked?.youtubeVideoProjectId)
    case 'book_studio':
      return cleanString(canvas.linked?.bookStudioProjectId)
    case 'workspace_artifact':
      return Array.isArray(canvas.linked?.workspaceArtifactIds)
        ? cleanString(canvas.linked.workspaceArtifactIds[0])
        : undefined
    default:
      return undefined
  }
}

function downstreamDraftIdFrom(
  canvas: CreativeCanvas & { id: string },
  node: CreativeCanvasNode,
  target: CreativeCanvasExport['target'],
  body: Record<string, unknown>,
): string | undefined {
  return cleanString(body.downstreamDraftId)
    ?? cleanString(node.data.downstreamDraftId)
    ?? cleanString(node.data.targetId)
    ?? linkedDownstreamDraftId(canvas, target)
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

  try {
    const draft = buildCreativeCanvasDraftExport({
      canvas,
      node,
      target,
      actor: actorFromUser(user),
      lineageSourceNodeIds: sourceLineageFrom(canvas, node, body),
      downstreamDraftId: downstreamDraftIdFrom(canvas, node, target, body) ?? '',
    })

    const storedRecord = {
      ...draft.exportRecord,
      payload: draft.payload,
    }
    const ref = await adminDb.collection('creative_canvas_exports').add(storedRecord)
    const exportRecord = { id: ref.id, ...storedRecord }

    return apiSuccess({ exportId: ref.id, export: exportRecord, draft: draft.payload }, 201)
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Creative canvas draft export failed', 400)
  }
})
