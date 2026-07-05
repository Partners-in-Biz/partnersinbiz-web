import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  createCreativeCanvas,
  getCreativeCanvas,
  updateCreativeCanvasGraph,
} from '@/lib/creative-canvas/store'
import type { CreativeCanvasActor } from '@/lib/creative-canvas/types'
import { buildCanvasGraphFromVideoProject } from '@/lib/youtube-studio/canvas-bridge'
import {
  ensureOrgAccess,
  listByOrg,
  loadScopedRecord,
  mergePatchForSanitizer,
  updateActorFields,
  YOUTUBE_COLLECTIONS,
} from '@/lib/youtube-studio/api'
import { sanitizeYouTubeVideoProjectInput, serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import type { YouTubeProductionDraft, YouTubeVideoProject } from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params?: Promise<{ id?: string }> | { id?: string } }

async function routeId(ctx?: RouteContext) {
  const params = await ctx?.params
  return typeof params?.id === 'string' ? params.id.trim() : ''
}

function actorFromUser(user: ApiUser): CreativeCanvasActor {
  return {
    uid: user.uid,
    type: user.role === 'ai' ? 'agent' : 'user',
  }
}

/**
 * Latest production draft for a video project = the non-deleted draft with the
 * highest versionNumber (matches the production-drafts route's `versionNumber`
 * descending ordering convention). Returns null when none exist.
 */
async function loadLatestProductionDraft(
  orgId: string,
  videoProjectId: string,
): Promise<(YouTubeProductionDraft & { id: string }) | null> {
  const docs = await listByOrg(YOUTUBE_COLLECTIONS.productionDrafts, orgId)
  const drafts = docs
    .map((doc) => serializeYouTubeRecord<YouTubeProductionDraft>(doc.id, doc.data()))
    .filter((draft) => draft.videoProjectId === videoProjectId)
    .sort((a, b) => (b.versionNumber ?? 0) - (a.versionNumber ?? 0))
  return drafts[0] ?? null
}

export const POST = withAuth('client', async (_req, user, ctx?: RouteContext) => {
  const id = await routeId(ctx)
  const loaded = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Video project not found', 404)

  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const project = serializeYouTubeRecord<YouTubeVideoProject>(loaded.id, loaded.data)

  // Idempotent: an existing, live linked canvas short-circuits. A stale link
  // (canvas deleted/gone) falls through to re-create and overwrites the link.
  const existingCanvasId = typeof loaded.data.creativeCanvasId === 'string'
    ? loaded.data.creativeCanvasId.trim()
    : ''
  if (existingCanvasId) {
    const existing = await getCreativeCanvas(existingCanvasId, orgId)
    if (existing) {
      return apiSuccess({ canvasId: existing.id, created: false })
    }
  }

  const latestDraft = await loadLatestProductionDraft(orgId, project.id)
  const graph = buildCanvasGraphFromVideoProject({ project, latestDraft })

  const actor = actorFromUser(user)
  const title = project.title?.trim() ? `YT: ${project.title.trim()}` : 'YT: Video project'
  const canvas = await createCreativeCanvas(
    {
      title,
      purpose: `Production canvas for YouTube video project ${project.id}.`,
      linked: { youtubeVideoProjectId: project.id },
    },
    orgId,
    actor,
  )

  // createCreativeCanvas forces empty nodes/edges — seed the graph separately
  // via the graph updater (same pattern as the campaign-import route).
  await updateCreativeCanvasGraph(
    canvas.id,
    orgId,
    { nodes: graph.nodes, edges: graph.edges },
    actor,
    { expectedActiveVersion: 1, reason: 'youtube_open_in_canvas' },
  )

  // Write the canvas id back onto the video project through the sanitizer path
  // (never raw Firestore) so the two-way link is persisted + whitelisted.
  const merged = mergePatchForSanitizer(loaded.data, { creativeCanvasId: canvas.id }, {
    orgId,
    deleted: loaded.data.deleted === true,
  })
  const updates = sanitizeYouTubeVideoProjectInput(merged)
  await loaded.ref.set({
    ...updates,
    orgId,
    ...updateActorFields(user),
  }, { merge: true })

  return apiSuccess({ canvasId: canvas.id, created: true }, 201)
})
