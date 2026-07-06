import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import {
  createCreativeCanvas,
  getCreativeCanvas,
  updateCreativeCanvasGraph,
} from '@/lib/creative-canvas/store'
import type { CreativeCanvasActor } from '@/lib/creative-canvas/types'
import { ensureBookStudioAccess, updateActorFields } from '@/lib/book-studio/api'
import {
  buildCanvasGraphFromBookProject,
  type BookCanvasChapter,
  type BookCanvasPage,
} from '@/lib/book-studio/canvas-bridge'
import { getBookFormat } from '@/lib/book-studio/format-registry'
import { BOOK_STUDIO_RESOURCES, serializeBookStudioRecord } from '@/lib/book-studio/sanitize'
import type { BookStudioRecord } from '@/lib/book-studio/types'

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

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Live (non-deleted) content units for a project, org-scoped, order ascending.
 * Queries on orgId only and filters projectId/deleted in memory — the same
 * convention as the Book Studio resource GET routes (no composite index).
 */
async function loadContentUnits(collectionName: string, orgId: string, projectId: string) {
  const snap = await adminDb.collection(collectionName).where('orgId', '==', orgId).get()
  return snap.docs
    .map((doc) => serializeBookStudioRecord(doc.id, doc.data()) as BookStudioRecord & { id: string })
    .filter((record) => record.projectId === projectId && record.deleted !== true)
    .sort((a, b) => (optionalNumber(a.order) ?? 0) - (optionalNumber(b.order) ?? 0))
}

function toCanvasChapter(record: BookStudioRecord & { id: string }): BookCanvasChapter {
  return {
    id: record.id,
    title: optionalString(record.title),
    order: optionalNumber(record.order),
    status: optionalString(record.status),
  }
}

function toCanvasPage(record: BookStudioRecord & { id: string }): BookCanvasPage {
  return {
    id: record.id,
    title: optionalString(record.title),
    order: optionalNumber(record.order),
    prompt: optionalString(record.prompt),
    caption: optionalString(record.caption),
    imageUrl: optionalString(record.imageUrl),
  }
}

export const POST = withAuth('admin', async (req, user, ctx?: RouteContext) => {
  const access = await ensureBookStudioAccess(req, user, undefined, 'write')
  if (access.error) return access.error
  const orgId = access.orgId

  const id = await routeId(ctx)
  const projectRef = adminDb.collection(BOOK_STUDIO_RESOURCES.projects.collection).doc(id || 'missing')
  const snap = id ? await projectRef.get() : null
  const data = snap?.exists ? snap.data() ?? {} : null
  // Cross-org projects must be indistinguishable from missing ones.
  if (!data || data.orgId !== orgId || data.deleted === true) {
    return apiError('Book project not found', 404)
  }

  const project = serializeBookStudioRecord(id, data) as BookStudioRecord & { id: string }

  // Idempotent: an existing, live linked canvas short-circuits. A stale link
  // (canvas deleted/gone) falls through to re-create and overwrites the link.
  const existingCanvasId = typeof data.creativeCanvasId === 'string' ? data.creativeCanvasId.trim() : ''
  if (existingCanvasId) {
    const existing = await getCreativeCanvas(existingCanvasId, orgId)
    if (existing) {
      return apiSuccess({ canvasId: existing.id, created: false })
    }
  }

  const format = getBookFormat(typeof project.format === 'string' ? project.format : '')
  const [chapters, pages] = await Promise.all([
    loadContentUnits(BOOK_STUDIO_RESOURCES.chapters.collection, orgId, project.id),
    loadContentUnits(BOOK_STUDIO_RESOURCES.pages.collection, orgId, project.id),
  ])

  const graph = buildCanvasGraphFromBookProject({
    project,
    format,
    chapters: chapters.map(toCanvasChapter),
    pages: pages.map(toCanvasPage),
  })

  const actor = actorFromUser(user)
  const title = project.title?.trim() ? project.title.trim() : 'Book project'
  const canvas = await createCreativeCanvas(
    {
      title,
      purpose: `Production canvas for Book Studio project ${project.id}.`,
      linked: { bookStudioProjectId: project.id },
    },
    orgId,
    actor,
  )

  // createCreativeCanvas forces empty nodes/edges — seed the graph separately
  // via the graph updater (same pattern as the YouTube open-in-canvas route).
  await updateCreativeCanvasGraph(
    canvas.id,
    orgId,
    { nodes: graph.nodes, edges: graph.edges },
    actor,
    { expectedActiveVersion: 1, reason: 'book_open_in_canvas' },
  )

  // Stamp the back-link onto the project. creativeCanvasId is a whitelisted
  // project field (lib/book-studio/sanitize.ts contentModelFields).
  await projectRef.set({
    creativeCanvasId: canvas.id,
    ...updateActorFields(user),
  }, { merge: true })

  return apiSuccess({ canvasId: canvas.id, created: true }, 201)
})
