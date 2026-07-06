import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { sanitizeYouTubeSourceAssetInput, sanitizeYouTubeRenderJobInput } from '@/lib/youtube-studio/sanitize'
import { getCreativeCanvas } from './store'
import type { CreativeCanvas, CreativeCanvasOutputKind, CreativeCanvasRun } from './types'

/**
 * Fire-and-forget sync-back from a completed creative-canvas run to the linked
 * YouTube Studio project. Called (never awaited into the critical path) from
 * `completeLoadedCreativeCanvasRun`, so any throw is swallowed by the caller's
 * `.catch(() => undefined)`.
 *
 * Scope (GOVERNANCE): only source assets + render-job rendered-completion. This
 * NEVER touches publishing packets, release plans, approval/QA state, or any
 * visibility beyond the sanitizer defaults for freshly-created docs.
 */

// Agent actor for system-initiated writes — mirrors the `agent` actor style used
// across creative-canvas runtimes (e.g. provider-runtime's `agent:maya`).
const AGENT_ACTOR = { uid: 'agent:pip', type: 'agent' as const }

// Render-job statuses that represent an editing job still awaiting its cut. A
// completed canvas render fulfils exactly one of these.
const OPEN_RENDER_JOB_STATUSES = new Set(['planning', 'ready_for_edit', 'rendering'])

function agentActorFields(options: { includeCreated?: boolean } = {}) {
  return {
    updatedBy: AGENT_ACTOR.uid,
    updatedByType: AGENT_ACTOR.type,
    updatedAt: FieldValue.serverTimestamp(),
    // createdAt/createdBy only on first write — idempotent replays of the same
    // run must not churn creation metadata.
    ...(options.includeCreated === false ? {} : {
      createdBy: AGENT_ACTOR.uid,
      createdByType: AGENT_ACTOR.type,
      createdAt: FieldValue.serverTimestamp(),
    }),
  }
}

function outputKindOf(run: CreativeCanvasRun): CreativeCanvasOutputKind | undefined {
  return (run.output as { kind?: CreativeCanvasOutputKind } | undefined)?.kind ?? run.input.outputKind
}

/**
 * The generate route stamps `run.input.outputKind` from the MODEL's registry
 * kind ('video' for every video model — no model is registered as
 * 'youtube_render'), so a run's kind alone can't carry render intent. The
 * intent lives on the generating NODE (`edit.outputKind` / `data.outputKind`
 * — how the seeded assembly node is authored), so treat a video run as a
 * render when its node declares youtube_render.
 */
function isYouTubeRenderIntent(
  run: CreativeCanvasRun & { id: string },
  nodes: CreativeCanvas['nodes'] | undefined,
  kind: CreativeCanvasOutputKind | undefined,
): boolean {
  if (kind === 'youtube_render') return true
  const node = nodes?.find((item) => item.id === run.nodeId)
  if (!node) return false
  const editKind = node.edit?.outputKind
  const dataKind = (node.data as { outputKind?: unknown } | undefined)?.outputKind
  return editKind === 'youtube_render' || dataKind === 'youtube_render'
}

export async function syncCanvasRunOutputToYouTube(
  run: CreativeCanvasRun & { id: string },
  canvas?: (Pick<CreativeCanvas, 'id' | 'orgId' | 'linked'> & { nodes?: CreativeCanvas['nodes'] }) | null,
): Promise<'skipped' | 'asset_only' | 'render_completed' | 'render_created'> {
  const resolvedCanvas = canvas ?? (await getCreativeCanvas(run.canvasId, run.orgId))
  if (!resolvedCanvas) return 'skipped'

  const videoProjectId = resolvedCanvas.linked?.youtubeVideoProjectId
  if (!videoProjectId) return 'skipped'

  if (run.status !== 'completed') return 'skipped'

  const outputUrl = run.output?.url
  if (!outputUrl) return 'skipped'

  const kind = outputKindOf(run)
  if (kind !== 'video' && kind !== 'youtube_render') return 'skipped'
  const renderIntent = isYouTubeRenderIntent(run, resolvedCanvas.nodes, kind)

  // Resolve the channelWorkspaceId from the video project — required on source
  // assets and needed for created render jobs.
  const projectSnap = await adminDb.collection(YOUTUBE_COLLECTIONS.videos).doc(videoProjectId).get()
  const projectData = projectSnap.exists ? (projectSnap.data() as Record<string, unknown>) : undefined
  // Tenant isolation, defense-in-depth: never write into a project owned by a
  // different org than the run's, no matter what the canvas link claims
  // (mislinked doc, bad migration, manual edit). Linking routes are org-scoped
  // today, but the bridge must not rely on caller discipline.
  if (!projectData || projectData.orgId !== run.orgId || projectData.deleted === true) return 'skipped'
  const channelWorkspaceId = typeof projectData?.channelWorkspaceId === 'string' ? projectData.channelWorkspaceId : ''
  const projectTitle = typeof projectData?.title === 'string' ? projectData.title : undefined

  const provenanceNote = `canvas run ${run.id}, model ${run.model ?? 'render'}, provider ${run.providerKey}`

  // (1) Source asset upsert — idempotent, deterministic id, for BOTH kinds.
  const assetId = `canvas-run-${run.id}`
  const assetData = sanitizeYouTubeSourceAssetInput({
    orgId: run.orgId,
    channelWorkspaceId,
    videoProjectId,
    title: `Canvas: ${run.model ?? 'render'} output`,
    assetType: 'rendered_video',
    status: 'ready',
    mediaFormat: 'horizontal',
    sourceUrl: outputUrl,
    internalNotes: provenanceNote,
  })
  const assetRef = adminDb.collection(YOUTUBE_COLLECTIONS.sourceAssets).doc(assetId)
  const existingAsset = await assetRef.get()
  await assetRef.set({
    ...assetData,
    deleted: false,
    ...agentActorFields({ includeCreated: !existingAsset.exists }),
  }, { merge: true })

  if (!renderIntent) return 'asset_only'

  // (2) Render-job completion — youtube_render only.
  const jobSnap = await adminDb.collection(YOUTUBE_COLLECTIONS.renderJobs)
    .where('orgId', '==', run.orgId)
    .where('videoProjectId', '==', videoProjectId)
    .get()

  const liveJobs = jobSnap.docs
    .map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> }))
    .filter((entry) => entry.data.deleted !== true)

  // Idempotency: if any job is already stamped with this run id, do nothing.
  const alreadyStamped = liveJobs.some(
    (entry) => (entry.data.renderEngine as { jobId?: string } | undefined)?.jobId === run.id,
  )
  if (alreadyStamped) return 'render_completed'

  const openJobs = liveJobs
    .filter((entry) => OPEN_RENDER_JOB_STATUSES.has(String(entry.data.status)))
    .sort((a, b) => {
      const aAt = typeof a.data.createdAt === 'number' ? a.data.createdAt : Number.MAX_SAFE_INTEGER
      const bAt = typeof b.data.createdAt === 'number' ? b.data.createdAt : Number.MAX_SAFE_INTEGER
      return aAt - bAt
    })

  const target = openJobs[0]
  if (target) {
    const existingOutput = (target.data.output as Record<string, unknown> | undefined) ?? {}
    await adminDb.collection(YOUTUBE_COLLECTIONS.renderJobs).doc(target.id).update({
      status: 'rendered',
      output: { ...existingOutput, previewUrl: outputUrl, downloadUrl: outputUrl },
      renderEngine: { provider: 'creative_canvas', jobId: run.id, status: 'completed' },
      updatedBy: AGENT_ACTOR.uid,
      updatedByType: AGENT_ACTOR.type,
      updatedAt: FieldValue.serverTimestamp(),
    })
    return 'render_completed'
  }

  // No open job — create one directly in `rendered`.
  const maxVersion = jobSnap.docs.reduce((max, doc) => {
    const version = (doc.data() as Record<string, unknown>).versionNumber
    return typeof version === 'number' && version > max ? version : max
  }, 0)

  const jobData = sanitizeYouTubeRenderJobInput({
    orgId: run.orgId,
    channelWorkspaceId,
    videoProjectId,
    title: `Canvas render: ${projectTitle ?? run.model ?? 'output'}`,
    status: 'rendered',
    versionNumber: maxVersion + 1,
    output: { previewUrl: outputUrl, downloadUrl: outputUrl },
    renderEngine: { provider: 'creative_canvas', jobId: run.id, status: 'completed' },
    internalNotes: provenanceNote,
  })
  await adminDb.collection(YOUTUBE_COLLECTIONS.renderJobs).add({
    ...jobData,
    deleted: false,
    ...agentActorFields(),
  })
  return 'render_created'
}
