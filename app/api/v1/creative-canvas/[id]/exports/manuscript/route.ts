import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { actorFields } from '@/lib/book-studio/api'
import { sanitizeBookStudioRecordInput } from '@/lib/book-studio/sanitize'
import { buildCreativeCanvasManuscript } from '@/lib/creative-canvas/exporters/manuscript'
import { getCreativeCanvas, CREATIVE_CANVAS_COLLECTION } from '@/lib/creative-canvas/store'
import type { CreativeCanvas, CreativeCanvasActor } from '@/lib/creative-canvas/types'

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

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

async function ensureBookStudioProject(
  canvas: CreativeCanvas & { id: string },
  user: ApiUser,
): Promise<string> {
  const linkedId = cleanString(canvas.linked?.bookStudioProjectId)
  if (linkedId) return linkedId
  const record = sanitizeBookStudioRecordInput('projects', {
    title: canvas.title && canvas.title.trim() && canvas.title.trim() !== 'Untitled canvas'
      ? `Book: ${canvas.title.trim()}`
      : 'Book: Creative canvas manuscript',
    description: `Auto-created by Creative Canvas manuscript compile from canvas ${canvas.id}.`,
    safeSummary: 'Book project created automatically when compiling a book board into a manuscript.',
  }, canvas.orgId)
  const ref = await adminDb.collection('book_studio_projects').add({
    ...record,
    ...actorFields(user),
  })
  await adminDb.collection(CREATIVE_CANVAS_COLLECTION).doc(canvas.id).update({
    'linked.bookStudioProjectId': ref.id,
    updatedAt: FieldValue.serverTimestamp(),
  })
  return ref.id
}

/**
 * Compile a book board into a single Book Studio manuscript draft: walks the
 * chapter chain in edge order, assembles the manuscript, writes ONE
 * book_studio_briefs record (the manuscript draft) plus one
 * creative_canvas_exports record. Internal draft only — nothing is published.
 */
export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as RouteContext).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)

  const canvas = await getCreativeCanvas(id, orgId)
  if (!canvas) return apiError('Creative canvas not found', 404)

  try {
    const manuscript = buildCreativeCanvasManuscript(canvas)
    const projectId = await ensureBookStudioProject(canvas, user)

    const brief = sanitizeBookStudioRecordInput('briefs', {
      title: `Manuscript: ${manuscript.title}`,
      projectId,
      description: manuscript.manuscriptText,
      safeSummary: `Compiled from canvas ${canvas.id}: ${manuscript.chapterCount} chapters, ${manuscript.wordCount} words.`,
      status: 'draft',
    }, orgId)
    const briefRef = await adminDb.collection('book_studio_briefs').add({
      ...brief,
      ...actorFields(user),
      manuscript: {
        sourceCanvasId: canvas.id,
        chapterCount: manuscript.chapterCount,
        characterCount: manuscript.characterCount,
        wordCount: manuscript.wordCount,
        orderingFallback: manuscript.orderingFallback,
        chapters: manuscript.chapters.map((chapter) => ({ nodeId: chapter.nodeId, title: chapter.title })),
        characters: manuscript.characters.map((character) => ({ nodeId: character.nodeId, title: character.title })),
      },
    })

    const actor = actorFromUser(user)
    const exportRecord = {
      orgId,
      canvasId: canvas.id,
      nodeId: manuscript.chapters[0]?.nodeId ?? '',
      target: 'book_studio' as const,
      targetId: briefRef.id,
      categoryKey: 'book' as const,
      downstreamDraftId: briefRef.id,
      lineageSourceNodeIds: manuscript.chapters.map((chapter) => chapter.nodeId),
      outputNodeId: manuscript.chapters[0]?.nodeId ?? '',
      outputKind: 'book_artifact' as const,
      reviewStatus: 'warning' as const,
      status: 'drafted' as const,
      createdAt: new Date().toISOString(),
      createdBy: actor.uid,
      createdByType: actor.type,
      payload: {
        source: 'creative_canvas' as const,
        status: 'internal_draft' as const,
        target: 'book_studio' as const,
        orgId,
        sourceCanvasId: canvas.id,
        title: `Manuscript: ${manuscript.title}`,
        textPreview: manuscript.manuscriptText.slice(0, 2000),
        outputKind: 'book_artifact',
        chapterCount: manuscript.chapterCount,
        characterCount: manuscript.characterCount,
        wordCount: manuscript.wordCount,
        clientVisible: false as const,
        publishEnabled: false as const,
        linked: { ...(canvas.linked ?? {}), bookStudioProjectId: projectId },
        moduleHint: 'Create an internal Book Studio manuscript draft; do not publish to stores.',
      },
    }
    const exportRef = await adminDb.collection('creative_canvas_exports').add(exportRecord)

    return apiSuccess({
      exportId: exportRef.id,
      briefId: briefRef.id,
      projectId,
      chapterCount: manuscript.chapterCount,
      characterCount: manuscript.characterCount,
      wordCount: manuscript.wordCount,
      orderingFallback: manuscript.orderingFallback,
      warnings: manuscript.warnings,
    }, 201)
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Creative canvas manuscript export failed', 400)
  }
})
