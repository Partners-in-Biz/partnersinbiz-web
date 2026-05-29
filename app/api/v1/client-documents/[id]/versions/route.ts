import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { assertClientDocumentDataAccess, getAccessibleClientDocument } from '@/lib/client-documents/access'
import { deserializeBlocksFromFirestore, serializeBlocksForFirestore } from '@/lib/client-documents/firestore-blocks'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import { CANONICAL_DOCUMENT_BLOCK_TYPES } from '@/lib/client-documents/types'
import type { ClientDocument, DocumentBlock, DocumentBlockType, DocumentTheme } from '@/lib/client-documents/types'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const BLOCK_TYPES = new Set<DocumentBlockType>(CANONICAL_DOCUMENT_BLOCK_TYPES)
const BLOCK_FIELDS = new Set(['id', 'type', 'title', 'content', 'required', 'locked', 'clientEditable', 'display'])
const MOTIONS = new Set(['none', 'reveal', 'sticky', 'counter', 'timeline'])

const DEFAULT_THEME: DocumentTheme = {
  palette: {
    bg: '#0A0A0B',
    text: '#F7F4EE',
    accent: '#F5A623',
    muted: '#A3A3A3',
  },
  typography: {
    heading: 'Instrument Serif',
    body: 'Geist',
  },
}

function actorType(user: ApiUser) {
  return user.role === 'ai' ? 'agent' : 'user'
}

function validateBlocks(value: unknown): { ok: true; value: DocumentBlock[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: 'blocks array is required' }

  for (const [index, block] of value.entries()) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      return { ok: false, error: `blocks[${index}] must be an object` }
    }

    const row = block as Record<string, unknown>
    const unknownFields = Object.keys(row).filter((field) => !BLOCK_FIELDS.has(field))
    if (unknownFields.length > 0) {
      return { ok: false, error: `blocks[${index}] contains unsupported field(s): ${unknownFields.join(', ')}` }
    }

    if (typeof row.id !== 'string' || row.id.trim().length === 0) {
      return { ok: false, error: `blocks[${index}].id must be a non-empty string` }
    }
    if (typeof row.type !== 'string' || !BLOCK_TYPES.has(row.type as DocumentBlockType)) {
      return { ok: false, error: `blocks[${index}].type is invalid` }
    }
    if (row.title !== undefined && typeof row.title !== 'string') {
      return { ok: false, error: `blocks[${index}].title must be a string` }
    }
    if (typeof row.required !== 'boolean') {
      return { ok: false, error: `blocks[${index}].required must be a boolean` }
    }
    if (row.locked !== undefined && typeof row.locked !== 'boolean') {
      return { ok: false, error: `blocks[${index}].locked must be a boolean` }
    }
    if (row.clientEditable !== undefined && typeof row.clientEditable !== 'boolean') {
      return { ok: false, error: `blocks[${index}].clientEditable must be a boolean` }
    }
    if (!row.display || typeof row.display !== 'object' || Array.isArray(row.display)) {
      return { ok: false, error: `blocks[${index}].display must be an object` }
    }

    const display = row.display as Record<string, unknown>
    if (display.variant !== undefined && typeof display.variant !== 'string') {
      return { ok: false, error: `blocks[${index}].display.variant must be a string` }
    }
    if (display.accent !== undefined && typeof display.accent !== 'string') {
      return { ok: false, error: `blocks[${index}].display.accent must be a string` }
    }
    if (display.motion !== undefined && (typeof display.motion !== 'string' || !MOTIONS.has(display.motion))) {
      return { ok: false, error: `blocks[${index}].display.motion is invalid` }
    }

    if (row.type === 'table') {
      if (!row.content || typeof row.content !== 'object' || Array.isArray(row.content)) {
        return { ok: false, error: `blocks[${index}].content must be an object` }
      }
      const content = row.content as Record<string, unknown>
      if (content.headers !== undefined) {
        if (!Array.isArray(content.headers) || !content.headers.every((h) => typeof h === 'string')) {
          return { ok: false, error: `blocks[${index}].content.headers must be an array of strings` }
        }
      }
      if (content.rows !== undefined) {
        if (!Array.isArray(content.rows)) {
          return { ok: false, error: `blocks[${index}].content.rows must be an array` }
        }
        for (const [rowIndex, tableRow] of content.rows.entries()) {
          if (!Array.isArray(tableRow) || !tableRow.every((cell) => typeof cell === 'string')) {
            return {
              ok: false,
              error: `blocks[${index}].content.rows[${rowIndex}] must be an array of strings`,
            }
          }
        }
      }
    }
  }

  return { ok: true, value: value as DocumentBlock[] }
}

function validateTheme(value: unknown): { ok: true; value: DocumentTheme } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: DEFAULT_THEME }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'theme must be an object' }
  }

  const theme = value as Record<string, unknown>
  if (theme.brandName !== undefined && typeof theme.brandName !== 'string') {
    return { ok: false, error: 'theme.brandName must be a string' }
  }
  if (theme.logoUrl !== undefined && typeof theme.logoUrl !== 'string') {
    return { ok: false, error: 'theme.logoUrl must be a string' }
  }
  if (!theme.palette || typeof theme.palette !== 'object' || Array.isArray(theme.palette)) {
    return { ok: false, error: 'theme.palette is required' }
  }
  if (!theme.typography || typeof theme.typography !== 'object' || Array.isArray(theme.typography)) {
    return { ok: false, error: 'theme.typography is required' }
  }

  const palette = theme.palette as Record<string, unknown>
  for (const field of ['bg', 'text', 'accent']) {
    if (typeof palette[field] !== 'string' || !palette[field]) {
      return { ok: false, error: `theme.palette.${field} must be a non-empty string` }
    }
  }
  if (palette.muted !== undefined && typeof palette.muted !== 'string') {
    return { ok: false, error: 'theme.palette.muted must be a string' }
  }

  const typography = theme.typography as Record<string, unknown>
  for (const field of ['heading', 'body']) {
    if (typeof typography[field] !== 'string' || !typography[field]) {
      return { ok: false, error: `theme.typography.${field} must be a non-empty string` }
    }
  }

  return { ok: true, value: theme as unknown as DocumentTheme }
}

export const GET = withAuth('client', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await getAccessibleClientDocument(id, user)
  if (!access.ok) return access.response

  const snap = await adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id).collection('versions').get()
  const versions = snap.docs.map((doc) => {
    const data = doc.data()
    return { id: doc.id, ...data, blocks: deserializeBlocksFromFirestore(data.blocks) }
  })

  return apiSuccess(versions)
})

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)

  const blocks = validateBlocks(body.blocks)
  if (!blocks.ok) return apiError(blocks.error, 400)

  const theme = validateTheme(body.theme)
  if (!theme.ok) return apiError(theme.error, 400)

  if (body.versionNumber !== undefined && (!Number.isInteger(body.versionNumber) || body.versionNumber < 1)) {
    return apiError('versionNumber must be a positive integer', 400)
  }

  if (body.changeSummary !== undefined && typeof body.changeSummary !== 'string') {
    return apiError('changeSummary must be a string', 400)
  }

  const documentRef = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id)
  const versionRef = documentRef.collection('versions').doc()
  const inputActorType = actorType(user)

  const storedBlocks = serializeBlocksForFirestore(blocks.value)

  let result: { ok: true } | { ok: false; response: ReturnType<typeof apiError> }
  try {
    result = await adminDb.runTransaction(async (transaction) => {
      const snap = await transaction.get(documentRef)
      if (!snap.exists || snap.data()?.deleted === true) {
        return { ok: false as const, response: apiError('Document not found', 404) }
      }

      const access = assertClientDocumentDataAccess(snap.data() as Partial<ClientDocument>, user)
      if (!access.ok) return access

      transaction.set(versionRef, {
        documentId: id,
        versionNumber: body.versionNumber ?? Date.now(),
        status: 'draft',
        blocks: storedBlocks,
        theme: theme.value,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: user.uid,
        createdByType: inputActorType,
        changeSummary: typeof body.changeSummary === 'string' ? body.changeSummary.trim() || 'Draft update' : 'Draft update',
      })
      transaction.update(documentRef, {
        currentVersionId: versionRef.id,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: user.uid,
        updatedByType: inputActorType,
      })

      return { ok: true as const }
    })
  } catch (err) {
    console.error('[client-documents/versions] POST failed', { documentId: id, error: err })
    return apiError('Internal Server Error', 500)
  }

  if (!result.ok) return result.response

  return apiSuccess({ id: versionRef.id }, 201)
})
