import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { actorFrom } from '@/lib/api/actor'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { actorFields } from '@/lib/book-studio/api'
import { getBookFormat, listBookFormats } from '@/lib/book-studio/format-registry'
import { sanitizeBookStudioRecordInput } from '@/lib/book-studio/sanitize'
import { createClientDocument } from '@/lib/client-documents/store'
import { createYouTubeVideoProject, listChannelWorkspaces } from '@/lib/youtube-studio/api'
import { buildCreativeCanvasDraftExport, resolveExportableNode } from '@/lib/creative-canvas/exporters/drafts'
import { getCreativeCanvas, CREATIVE_CANVAS_COLLECTION } from '@/lib/creative-canvas/store'
import { makeBlockId, type Block } from '@/lib/email-builder/types'
import type { CreativeCanvas, CreativeCanvasActor, CreativeCanvasExport, CreativeCanvasNode } from '@/lib/creative-canvas/types'
import { authorizeMarketingStudioMutation } from '@/lib/chat-context/marketingMutationAccess'

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
    'ads_creative',
    'email_block',
    'seo_content',
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
    case 'ads_creative':
      return cleanString(canvas.linked?.adCreativeId)
    case 'email_block':
      return cleanString(canvas.linked?.emailSnippetId)
    case 'seo_content':
      return cleanString(canvas.linked?.seoContentId)
    default:
      return undefined
  }
}

/**
 * Human-friendly base title for auto-created downstream drafts. Empty or
 * placeholder ("Untitled canvas") titles fall back to a generic label so
 * downstream modules never show blank/placeholder record names.
 */
function canvasBaseTitle(canvas: CreativeCanvas): string {
  const title = cleanString(canvas.title)
  return !title || title === 'Untitled canvas' ? 'Creative canvas draft' : title
}

async function linkCanvas(canvasId: string, field: string, value: string): Promise<void> {
  await adminDb.collection(CREATIVE_CANVAS_COLLECTION).doc(canvasId).update({
    [`linked.${field}`]: value,
    updatedAt: FieldValue.serverTimestamp(),
  })
}

/**
 * Publishing to Book Studio from an unlinked canvas auto-creates the book
 * project (the natural container for chapters/manuscripts) and links the
 * canvas to it, so 📤 works on a fresh board without manual setup.
 *
 * Requires `format` (validated against the book format registry — missing or
 * unknown values 400 with the list of valid ids) and accepts an optional
 * `seriesId` (must resolve to a live, same-org `book_studio_series` doc) and
 * `title` (falls back to the canvas title). Idempotent: if the canvas is
 * already linked to a live, same-org book project, that project is reused
 * instead of creating a duplicate — callers can tell the two cases apart via
 * the returned `created` flag.
 */
async function ensureBookStudioProject(
  canvas: CreativeCanvas & { id: string },
  user: ApiUser,
  body: Record<string, unknown>,
): Promise<{ projectId: string; created: boolean } | Response> {
  const existingProjectId = cleanString(canvas.linked?.bookStudioProjectId)
  if (existingProjectId) {
    const existingSnap = await adminDb.collection('book_studio_projects').doc(existingProjectId).get()
    const existingData = existingSnap.exists ? (existingSnap.data() as Record<string, unknown>) : undefined
    if (existingData && existingData.orgId === canvas.orgId && existingData.deleted !== true) {
      return { projectId: existingProjectId, created: false }
    }
  }

  const formatId = cleanString(body.format)
  const format = formatId ? getBookFormat(formatId) : null
  if (!format) {
    const validIds = listBookFormats().map((entry) => entry.id).join(', ')
    return apiError(`format is required and must be one of: ${validIds}`, 400)
  }

  const seriesId = cleanString(body.seriesId)
  if (seriesId) {
    const seriesSnap = await adminDb.collection('book_studio_series').doc(seriesId).get()
    const seriesData = seriesSnap.exists ? (seriesSnap.data() as Record<string, unknown>) : undefined
    if (!seriesData || seriesData.orgId !== canvas.orgId || seriesData.deleted === true) {
      return apiError('seriesId was not found', 400)
    }
  }

  const record = sanitizeBookStudioRecordInput('projects', {
    title: cleanString(body.title) ?? canvasBaseTitle(canvas),
    status: 'draft',
    stage: 'intake',
    format: format.id,
    trim: { presetId: format.defaultTrim },
    seriesId,
    creativeCanvasId: canvas.id,
    description: `Auto-created by Creative Canvas publish from canvas ${canvas.id}.`,
    safeSummary: 'Book project created automatically when publishing a canvas text node to Book Studio.',
  }, canvas.orgId)
  const ref = await adminDb.collection('book_studio_projects').add({
    ...record,
    ...actorFields(user),
  })
  await linkCanvas(canvas.id, 'bookStudioProjectId', ref.id)
  return { projectId: ref.id, created: true }
}

/**
 * Publishing to client_document / blog_post from an unlinked canvas
 * auto-creates a minimal `canvas_draft` client document (title + body
 * template, internal_draft, never client-shared) and links the canvas to it,
 * mirroring the Book Studio behaviour.
 */
async function ensureClientDocumentDraft(
  canvas: CreativeCanvas & { id: string },
  user: ApiUser,
): Promise<string> {
  const { id } = await createClientDocument({
    title: `Canvas draft: ${canvasBaseTitle(canvas)}`,
    type: 'canvas_draft',
    orgId: canvas.orgId,
    user,
  })
  await linkCanvas(canvas.id, 'clientDocumentId', id)
  return id
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Publishing to email_block from an unlinked canvas auto-creates a reusable
 * email snippet (email_snippets, category `custom`) holding the node's text
 * and/or image, and links the canvas to it. Snippets are internal building
 * blocks — creating one never sends or schedules email.
 */
async function ensureEmailSnippet(
  canvas: CreativeCanvas & { id: string },
  node: CreativeCanvasNode,
  user: ApiUser,
): Promise<string> {
  const output = resolveExportableNode(node).output
  const blocks: Block[] = []
  if (cleanString(output?.textPreview)) {
    blocks.push({
      id: makeBlockId(),
      type: 'paragraph',
      props: { html: escapeHtml(String(output?.textPreview).trim()), align: 'left' },
    })
  }
  if (cleanString(output?.url)) {
    blocks.push({
      id: makeBlockId(),
      type: 'image',
      props: { src: String(output?.url), alt: node.title || 'Creative canvas asset', align: 'center' },
    })
  }
  const ref = await adminDb.collection('email_snippets').add({
    orgId: canvas.orgId,
    name: `Canvas draft: ${canvasBaseTitle(canvas)}`,
    description: `Auto-created by Creative Canvas publish from canvas ${canvas.id}. Internal draft — review before use.`,
    category: 'custom',
    blocks,
    isStarter: false,
    deleted: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...actorFrom(user),
  })
  await linkCanvas(canvas.id, 'emailSnippetId', ref.id)
  return ref.id
}

/**
 * Publishing to YouTube Studio from an unlinked canvas auto-creates a
 * `YouTubeVideoProject` in one of the org's channel workspaces (resolving the
 * workspace from an explicit `channelWorkspaceId` or the sole workspace when
 * there is exactly one), stamps `creativeCanvasId` for two-way linking, and
 * links the canvas to it. Returns the new video project id, or an `apiError`
 * Response when the workspace can't be resolved (caller returns it directly).
 */
async function ensureYouTubeVideoProject(
  canvas: CreativeCanvas & { id: string },
  user: ApiUser,
  channelWorkspaceId: string | undefined,
): Promise<string | Response> {
  const workspaces = await listChannelWorkspaces(canvas.orgId)

  let workspaceId: string
  if (channelWorkspaceId) {
    const match = workspaces.find((workspace) => workspace.id === channelWorkspaceId)
    if (!match) return apiError('Channel workspace not found', 400)
    workspaceId = match.id
  } else if (workspaces.length === 0) {
    return apiError('Create a YouTube channel workspace first — YouTube Studio → Channels.', 400)
  } else if (workspaces.length === 1) {
    workspaceId = workspaces[0].id
  } else {
    const options = workspaces.map((workspace) => `${workspace.id} (${workspace.title})`).join(', ')
    return apiError(`Multiple channel workspaces — pass channelWorkspaceId: ${options}`, 400)
  }

  const videoProjectId = await createYouTubeVideoProject({
    orgId: canvas.orgId,
    channelWorkspaceId: workspaceId,
    title: cleanString(canvas.title) ?? 'Canvas export',
    creativeCanvasId: canvas.id,
  }, user)
  await linkCanvas(canvas.id, 'youtubeVideoProjectId', videoProjectId)
  return videoProjectId
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
  const policyAccess = await authorizeMarketingStudioMutation(user, orgId, 'approvePublish')
  if (!policyAccess.ok) return apiError(policyAccess.error, policyAccess.status)

  const canvas = await getCreativeCanvas(id, orgId)
  if (!canvas) return apiError('Creative canvas not found', 404)

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return apiError('Malformed JSON body', 400)

  const nodeId = typeof body.nodeId === 'string' ? body.nodeId : ''
  const channelWorkspaceId = cleanString(body.channelWorkspaceId)
  const target = cleanTarget(body.target)
  if (!target) return apiError('Unsupported creative canvas export target', 400)

  const node = canvas.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return apiError('Creative canvas output node not found', 404)

  try {
    let downstreamDraftId = target === 'book_studio' ? undefined : downstreamDraftIdFrom(canvas, node, target, body)
    let bookStudioProjectCreated: boolean | undefined
    if (!downstreamDraftId) {
      if (target === 'book_studio') {
        // Always resolved through ensureBookStudioProject (rather than the
        // generic downstreamDraftIdFrom shortcut) so a stale/soft-deleted
        // link doesn't bypass the liveness + org check — see idempotency
        // semantics in ensureBookStudioProject's doc comment above.
        const ensured = await ensureBookStudioProject(canvas, user, body)
        if (ensured instanceof Response) return ensured
        downstreamDraftId = ensured.projectId
        bookStudioProjectCreated = ensured.created
      } else if (target === 'client_document' || target === 'blog_post') {
        downstreamDraftId = await ensureClientDocumentDraft(canvas, user)
      } else if (target === 'email_block') {
        downstreamDraftId = await ensureEmailSnippet(canvas, node, user)
      } else if (target === 'ads_creative') {
        // Ad creatives carry required upload metadata (storage path, file
        // size, mime type) we cannot synthesize here — no auto-create.
        return apiError('Link an ad creative first — upload the asset in Ads Studio, then link it to this canvas (linked.adCreativeId).', 400)
      } else if (target === 'youtube_studio') {
        // Auto-create a linked YouTube video project in the org's channel
        // workspace (resolved from an explicit channelWorkspaceId or the sole
        // workspace), stamping creativeCanvasId for two-way linking.
        const ensured = await ensureYouTubeVideoProject(canvas, user, channelWorkspaceId)
        if (ensured instanceof Response) return ensured
        downstreamDraftId = ensured
      } else if (target === 'seo_content') {
        // SEO content items belong to a sprint; creating one without a
        // sprint would orphan it from every sprint view — no auto-create.
        return apiError('Link an SEO content item first — create it in the SEO sprint content plan, then link it to this canvas (linked.seoContentId).', 400)
      }
    }
    const draft = buildCreativeCanvasDraftExport({
      canvas,
      node,
      target,
      actor: actorFromUser(user),
      lineageSourceNodeIds: sourceLineageFrom(canvas, node, body),
      downstreamDraftId: downstreamDraftId ?? '',
    })

    const storedRecord = {
      ...draft.exportRecord,
      payload: draft.payload,
    }
    const ref = await adminDb.collection('creative_canvas_exports').add(storedRecord)
    const exportRecord = { id: ref.id, ...storedRecord }

    return apiSuccess({
      exportId: ref.id,
      export: exportRecord,
      draft: draft.payload,
      ...(target === 'book_studio' ? { projectId: downstreamDraftId, created: bookStudioProjectCreated } : {}),
    }, 201)
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Creative canvas draft export failed', 400)
  }
})
