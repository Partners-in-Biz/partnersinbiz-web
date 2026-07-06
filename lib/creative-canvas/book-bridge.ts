import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { getCreativeCanvas } from './store'
import type { CreativeCanvas, CreativeCanvasRun } from './types'

/**
 * Fire-and-forget sync-back from a completed creative-canvas run to the
 * linked Book Studio project. Called (never awaited into the critical path)
 * from `completeLoadedCreativeCanvasRun`, so any throw is swallowed by the
 * caller's `.catch(() => undefined)`.
 *
 * Scope (GOVERNANCE): only the three content-model fields the canvas graph is
 * allowed to drive — project cover image, page image, and chapter body/status
 * (never past 'edited'/'approved'). This NEVER touches publishing packets,
 * rights ledgers, approval/QA gates, or any Book Studio field beyond what's
 * listed here.
 */

const BOOK_STUDIO_PROJECTS_COLLECTION = 'book_studio_projects'
const BOOK_STUDIO_CHAPTERS_COLLECTION = 'book_studio_chapters'
const BOOK_STUDIO_PAGES_COLLECTION = 'book_studio_pages'
const BOOK_STUDIO_ARTIFACT_LINKS_COLLECTION = 'book_studio_artifact_links'

// Agent actor for system-initiated writes — mirrors the `agent` actor style used
// across creative-canvas runtimes (e.g. youtube-bridge's `agent:pip`).
const AGENT_ACTOR = { uid: 'agent:pip', type: 'agent' as const }

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

function countWords(body: string): number {
  return body.trim().split(/\s+/).filter(Boolean).length
}

/**
 * The generate route stamps `run.input.outputKind` from the MODEL's registry
 * kind ('image'/'copy' — no model is registered as 'book_artifact'), so a
 * run's kind alone can't carry book-sync intent. The intent lives on the
 * generating NODE (`data.bookRole` — how the outbound bridge seeds nodes),
 * so intent must always be resolved by finding the generating node.
 */
export async function syncCanvasRunOutputToBookStudio(
  run: CreativeCanvasRun & { id: string },
  canvas?: (Pick<CreativeCanvas, 'id' | 'orgId' | 'linked'> & { nodes?: CreativeCanvas['nodes'] }) | null,
): Promise<'skipped' | 'cover_set' | 'page_set' | 'chapter_set'> {
  const resolvedCanvas = canvas ?? (await getCreativeCanvas(run.canvasId, run.orgId))
  if (!resolvedCanvas) return 'skipped'

  const projectId = resolvedCanvas.linked?.bookStudioProjectId
  if (!projectId) return 'skipped'

  if (run.status !== 'completed') return 'skipped'

  const projectSnap = await adminDb.collection(BOOK_STUDIO_PROJECTS_COLLECTION).doc(projectId).get()
  const projectData = projectSnap.exists ? (projectSnap.data() as Record<string, unknown>) : undefined
  // Tenant isolation, defense-in-depth: never write into a project owned by a
  // different org than the run's, no matter what the canvas link claims
  // (mislinked doc, bad migration, manual edit). Linking routes are org-scoped
  // today, but the bridge must not rely on caller discipline.
  if (!projectData || projectData.orgId !== run.orgId || projectData.deleted === true) return 'skipped'

  const node = resolvedCanvas.nodes?.find((item) => item.id === run.nodeId)
  const bookRole = (node?.data as { bookRole?: unknown } | undefined)?.bookRole
  if (!node || typeof bookRole !== 'string') return 'skipped'

  if (bookRole === 'cover') {
    const url = run.output?.url
    if (!url) return 'skipped'

    await adminDb.collection(BOOK_STUDIO_PROJECTS_COLLECTION).doc(projectId).update({
      coverImageUrl: url,
      updatedBy: AGENT_ACTOR.uid,
      updatedByType: AGENT_ACTOR.type,
      updatedAt: FieldValue.serverTimestamp(),
    })

    const artifactLinkId = `canvas-run-${run.id}`
    const artifactLinkRef = adminDb.collection(BOOK_STUDIO_ARTIFACT_LINKS_COLLECTION).doc(artifactLinkId)
    const existingArtifactLink = await artifactLinkRef.get()
    await artifactLinkRef.set({
      orgId: run.orgId,
      projectId,
      label: `Canvas: ${run.model ?? 'render'} cover`,
      href: url,
      type: 'canvas_output',
      deleted: false,
      ...agentActorFields({ includeCreated: !existingArtifactLink.exists }),
    }, { merge: true })

    return 'cover_set'
  }

  if (bookRole === 'page_illustration') {
    const url = run.output?.url
    const bookPageId = (node.data as { bookPageId?: unknown }).bookPageId
    if (!url || typeof bookPageId !== 'string' || !bookPageId) return 'skipped'

    const pageSnap = await adminDb.collection(BOOK_STUDIO_PAGES_COLLECTION).doc(bookPageId).get()
    const pageData = pageSnap.exists ? (pageSnap.data() as Record<string, unknown>) : undefined
    if (!pageData || pageData.orgId !== run.orgId || pageData.projectId !== projectId || pageData.deleted === true) {
      return 'skipped'
    }

    await adminDb.collection(BOOK_STUDIO_PAGES_COLLECTION).doc(bookPageId).update({
      imageUrl: url,
      canvasRunId: run.id,
      status: 'generated',
      updatedBy: AGENT_ACTOR.uid,
      updatedByType: AGENT_ACTOR.type,
      updatedAt: FieldValue.serverTimestamp(),
    })

    return 'page_set'
  }

  if (bookRole === 'chapter_text') {
    const text = run.output?.textPreview
    const bookChapterId = (node.data as { bookChapterId?: unknown }).bookChapterId
    if (!text || typeof bookChapterId !== 'string' || !bookChapterId) return 'skipped'

    const chapterSnap = await adminDb.collection(BOOK_STUDIO_CHAPTERS_COLLECTION).doc(bookChapterId).get()
    const chapterData = chapterSnap.exists ? (chapterSnap.data() as Record<string, unknown>) : undefined
    if (!chapterData || chapterData.orgId !== run.orgId || chapterData.projectId !== projectId || chapterData.deleted === true) {
      return 'skipped'
    }

    // Never clobber a chapter a human has already edited or approved.
    const currentStatus = chapterData.status
    if (currentStatus !== 'draft' && currentStatus !== 'generated') return 'skipped'

    await adminDb.collection(BOOK_STUDIO_CHAPTERS_COLLECTION).doc(bookChapterId).update({
      body: text,
      wordCount: countWords(text),
      canvasRunId: run.id,
      status: 'generated',
      updatedBy: AGENT_ACTOR.uid,
      updatedByType: AGENT_ACTOR.type,
      updatedAt: FieldValue.serverTimestamp(),
    })

    return 'chapter_set'
  }

  return 'skipped'
}
