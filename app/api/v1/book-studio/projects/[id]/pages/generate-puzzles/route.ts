import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { actorFields, ensureBookStudioAccess } from '@/lib/book-studio/api'
import { getBookFormat } from '@/lib/book-studio/format-registry'
import { generatePuzzle, type PuzzleDifficulty, type PuzzleKind } from '@/lib/book-studio/puzzles'
import { BookStudioValidationError, sanitizeBookStudioRecordInput, serializeBookStudioRecord } from '@/lib/book-studio/sanitize'

export const dynamic = 'force-dynamic'

const PUZZLE_KINDS: PuzzleKind[] = ['sudoku', 'word_search', 'maze', 'crossword']
const DIFFICULTIES: PuzzleDifficulty[] = ['easy', 'medium', 'hard', 'expert']
const MAX_COUNT = 100

const KIND_LABELS: Record<PuzzleKind, string> = {
  sudoku: 'Sudoku',
  word_search: 'Word Search',
  maze: 'Maze',
  crossword: 'Crossword',
}

type RouteContext = { params: Promise<{ id: string }> }

function isPuzzleKind(value: unknown): value is PuzzleKind {
  return typeof value === 'string' && PUZZLE_KINDS.includes(value as PuzzleKind)
}

function isDifficulty(value: unknown): value is PuzzleDifficulty {
  return typeof value === 'string' && DIFFICULTIES.includes(value as PuzzleDifficulty)
}

// Only words/entries survive into the generator + stored puzzle params —
// everything else in body.params is dropped here (and the pages sanitizer
// whitelists again on write).
function pickPuzzleParams(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const params: Record<string, unknown> = {}
  if ('words' in source) params.words = source.words
  if ('entries' in source) params.entries = source.entries
  return Object.keys(params).length ? params : undefined
}

export const POST = withAuth('admin', async (req: NextRequest, user, context: RouteContext) => {
  const { id: projectId } = await context.params

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    const access = await ensureBookStudioAccess(req, user, undefined, 'write')
    if (access.error) return access.error
    return apiError('Malformed JSON body', 400)
  }
  const access = await ensureBookStudioAccess(req, user, body, 'write')
  if (access.error) return access.error
  const orgId = access.orgId

  // --- body validation (unknown keys are ignored) ---
  if (!isPuzzleKind(body.kind)) {
    return apiError(`kind must be one of: ${PUZZLE_KINDS.join(', ')}`, 400)
  }
  const kind = body.kind

  const count = body.count
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    return apiError(`count must be an integer between 1 and ${MAX_COUNT}`, 400)
  }

  if (!isDifficulty(body.difficulty)) {
    return apiError(`difficulty must be one of: ${DIFFICULTIES.join(', ')}`, 400)
  }
  const difficulty = body.difficulty

  let startOrder: number | undefined
  if (body.startOrder !== undefined && body.startOrder !== null) {
    if (typeof body.startOrder !== 'number' || !Number.isInteger(body.startOrder) || body.startOrder < 0) {
      return apiError('startOrder must be an integer >= 0', 400)
    }
    startOrder = body.startOrder
  }

  const params = pickPuzzleParams(body.params)

  // --- project (org-scoped; cross-org/deleted indistinguishable from missing) ---
  const projectSnap = await adminDb.collection('book_studio_projects').doc(projectId).get()
  const project = projectSnap.exists ? projectSnap.data() ?? {} : null
  if (!project || project.orgId !== orgId || project.deleted === true) {
    return apiError('book project not found', 404)
  }

  const format = typeof project.format === 'string' ? getBookFormat(project.format) : null
  if (!format || !format.puzzleKind) {
    return apiError('project format does not take puzzle pages', 400)
  }
  if (format.puzzleKind !== 'mixed' && format.puzzleKind !== kind) {
    return apiError(`kind '${kind}' does not match the project format's puzzle kind '${format.puzzleKind}'`, 400)
  }

  // --- generate + validate ALL puzzles before writing anything ---
  const seedBase = crypto.randomBytes(4).readUInt32LE(0)
  const seeds: number[] = []
  for (let i = 0; i < count; i++) {
    const seed = (seedBase + i) | 0
    try {
      generatePuzzle(kind, seed, difficulty, params)
    } catch (error) {
      return apiError(error instanceof Error ? error.message : 'puzzle generation failed', 400)
    }
    seeds.push(seed)
  }

  // --- orders: startOrder ?? max live order + 1, incrementing per page ---
  let nextOrder = startOrder
  if (nextOrder === undefined) {
    const pagesSnap = await adminDb.collection('book_studio_pages').where('orgId', '==', orgId).get()
    const maxOrder = pagesSnap.docs
      .map((doc) => doc.data())
      .filter((data) => data.projectId === projectId && data.deleted !== true)
      .reduce((max, data) => (typeof data.order === 'number' && Number.isFinite(data.order) ? Math.max(max, data.order) : max), -1)
    nextOrder = maxOrder + 1
  }

  // --- create pages through the same sanitize path as the pages POST route ---
  const pagesCollection = adminDb.collection('book_studio_pages')
  const created: Array<Record<string, unknown>> = []
  for (let i = 0; i < count; i++) {
    const order = nextOrder + i
    let data
    try {
      data = sanitizeBookStudioRecordInput('pages', {
        projectId,
        title: `${KIND_LABELS[kind]} — ${difficulty} #${order + 1}`,
        kind: 'puzzle',
        status: 'generated',
        order,
        puzzle: { kind, seed: seeds[i], difficulty, params },
      }, orgId)
    } catch (error) {
      if (error instanceof BookStudioValidationError) return apiError(error.message, error.status)
      throw error
    }
    const ref = await pagesCollection.add({ ...data, ...actorFields(user) })
    created.push(serializeBookStudioRecord(ref.id, data as Record<string, unknown>))
  }

  return apiSuccess({ pages: created }, 201)
})
