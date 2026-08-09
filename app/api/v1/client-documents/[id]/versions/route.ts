import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'

import { actorFrom, lastActorFrom } from '@/lib/api/actor'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  assertClientDocumentDataAccess,
  canManageClientDocument,
  getAccessibleClientDocument,
} from '@/lib/client-documents/access'
import { deserializeBlocksFromFirestore, serializeBlocksForFirestore } from '@/lib/client-documents/firestore-blocks'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import { CANONICAL_DOCUMENT_BLOCK_TYPES } from '@/lib/client-documents/types'
import type {
  ClientDocument,
  DocumentBlock,
  DocumentBlockType,
  DocumentBlockVisibility,
  DocumentTheme,
} from '@/lib/client-documents/types'
import { adminDb } from '@/lib/firebase/admin'
import { contextReferenceKey, sanitizeContextReferenceSeeds } from '@/lib/context-references/types'
import type { ContextReference } from '@/lib/context-references/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const BLOCK_TYPES = new Set<DocumentBlockType>(CANONICAL_DOCUMENT_BLOCK_TYPES)
const BLOCK_FIELDS = new Set([
  'id',
  'type',
  'title',
  'content',
  'required',
  'locked',
  'clientEditable',
  'visibility',
  'contextRefs',
  'display',
])
const MOTIONS = new Set(['none', 'reveal', 'sticky', 'counter', 'timeline'])
const VISIBILITIES = new Set<DocumentBlockVisibility>(['hidden', 'internal-only', 'client-visible'])

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
  return actorFrom(user).createdByType === 'agent' ? 'agent' : 'user'
}

function sanitizeBlockContextRefs(value: unknown): ContextReference[] {
  const seeds = sanitizeContextReferenceSeeds(value)
  const byKey = new Map<string, ContextReference>()

  for (const ref of seeds) {
    if (!ref.orgId) continue
    const normalized: ContextReference = {
      type: ref.type,
      id: ref.id,
      orgId: ref.orgId,
      label: ref.label || `${ref.type}:${ref.id}`,
      origin: ref.origin ?? 'manual',
      ...(ref.href ? { href: ref.href } : {}),
      ...(ref.summary ? { summary: ref.summary } : {}),
      ...(ref.metadata ? { metadata: ref.metadata } : {}),
    }
    byKey.set(contextReferenceKey(normalized), normalized)
  }

  return Array.from(byKey.values())
}

function validateBlocks(value: unknown): { ok: true; value: DocumentBlock[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: 'blocks array is required' }

  const blocks: DocumentBlock[] = []

  for (const [index, block] of value.entries()) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      return { ok: false, error: `blocks[${index}] must be an object` }
    }

    const row = block as Record<string, unknown>
    // Agent-friendly: accept top-level `motion` as an alias for `display.motion`.
    // Agents commonly omit `required` / `display` or hoist motion; reject only real unknowns.
    const unknownFields = Object.keys(row).filter(
      (field) => !BLOCK_FIELDS.has(field) && field !== 'motion',
    )
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
    // Default missing `required` to false — agents often send content-only blocks.
    if (row.required !== undefined && typeof row.required !== 'boolean') {
      return { ok: false, error: `blocks[${index}].required must be a boolean` }
    }
    const required = typeof row.required === 'boolean' ? row.required : false
    if (row.locked !== undefined && typeof row.locked !== 'boolean') {
      return { ok: false, error: `blocks[${index}].locked must be a boolean` }
    }
    if (row.clientEditable !== undefined && typeof row.clientEditable !== 'boolean') {
      return { ok: false, error: `blocks[${index}].clientEditable must be a boolean` }
    }
    if (row.visibility !== undefined && (typeof row.visibility !== 'string' || !VISIBILITIES.has(row.visibility as DocumentBlockVisibility))) {
      return { ok: false, error: `blocks[${index}].visibility is invalid` }
    }
    if (row.contextRefs !== undefined && !Array.isArray(row.contextRefs)) {
      return { ok: false, error: `blocks[${index}].contextRefs must be an array` }
    }

    let displayInput: unknown = row.display
    if (displayInput === undefined || displayInput === null) {
      displayInput = typeof row.motion === 'string' ? { motion: row.motion } : {}
    } else if (
      typeof displayInput === 'object' &&
      !Array.isArray(displayInput) &&
      typeof row.motion === 'string' &&
      (displayInput as Record<string, unknown>).motion === undefined
    ) {
      displayInput = { ...(displayInput as Record<string, unknown>), motion: row.motion }
    }
    if (!displayInput || typeof displayInput !== 'object' || Array.isArray(displayInput)) {
      return { ok: false, error: `blocks[${index}].display must be an object` }
    }

    const display = displayInput as Record<string, unknown>
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

    blocks.push({
      id: row.id.trim(),
      type: row.type as DocumentBlockType,
      ...(typeof row.title === 'string' ? { title: row.title.trim() } : {}),
      content: row.content,
      required,
      ...(typeof row.locked === 'boolean' ? { locked: row.locked } : {}),
      ...(typeof row.clientEditable === 'boolean' ? { clientEditable: row.clientEditable } : {}),
      ...(typeof row.visibility === 'string' ? { visibility: row.visibility as DocumentBlockVisibility } : {}),
      ...(row.contextRefs !== undefined ? { contextRefs: sanitizeBlockContextRefs(row.contextRefs) } : {}),
      display: {
        ...(typeof display.variant === 'string' ? { variant: display.variant.trim() } : {}),
        ...(typeof display.accent === 'string' ? { accent: display.accent.trim() } : {}),
        ...(typeof display.motion === 'string' ? { motion: display.motion as DocumentBlock['display']['motion'] } : {}),
      },
    })
  }

  return { ok: true, value: blocks }
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

  const palette = theme.palette as Record<string, unknown>
  for (const field of ['bg', 'text', 'accent']) {
    if (typeof palette[field] !== 'string' || !palette[field]) {
      return { ok: false, error: `theme.palette.${field} must be a non-empty string` }
    }
  }
  for (const optional of ['muted', 'border', 'surface'] as const) {
    if (palette[optional] !== undefined && typeof palette[optional] !== 'string') {
      return { ok: false, error: `theme.palette.${optional} must be a string` }
    }
  }

  // Default typography when agents only send palette (common incomplete theme).
  const typographySource =
    theme.typography && typeof theme.typography === 'object' && !Array.isArray(theme.typography)
      ? (theme.typography as Record<string, unknown>)
      : DEFAULT_THEME.typography
  const typography = {
    heading:
      typeof typographySource.heading === 'string' && typographySource.heading
        ? typographySource.heading
        : DEFAULT_THEME.typography.heading,
    body:
      typeof typographySource.body === 'string' && typographySource.body
        ? typographySource.body
        : DEFAULT_THEME.typography.body,
  }

  return {
    ok: true,
    value: {
      ...(typeof theme.brandName === 'string' ? { brandName: theme.brandName } : {}),
      ...(typeof theme.logoUrl === 'string' ? { logoUrl: theme.logoUrl } : {}),
      palette: {
        bg: palette.bg as string,
        text: palette.text as string,
        accent: palette.accent as string,
        ...(typeof palette.muted === 'string' ? { muted: palette.muted } : {}),
        ...(typeof palette.border === 'string' ? { border: palette.border } : {}),
        ...(typeof palette.surface === 'string' ? { surface: palette.surface } : {}),
      },
      typography,
    },
  }
}

export const GET = withAuth('client', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await getAccessibleClientDocument(id, user, 'versions')
  if (!access.ok) return access.response

  const snap = await adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id).collection('versions').get()
  const versions = snap.docs.map((doc) => {
    const data = doc.data()
    return { id: doc.id, ...data, blocks: deserializeBlocksFromFirestore(data.blocks) }
  })

  return apiSuccess(versions)
})

// Draft version writes must match document create/PATCH: holder creators and
// admins/agents can land content. withAuth('admin') alone 403s user-delegation
// sessions for client-role members (e.g. Stean-owned Saaiman proposal) even
// when GET versions succeeds via creator/share access.
export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
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

  const storedBlocks = serializeBlocksForFirestore(blocks.value)

  let result:
    | { ok: true; orgId?: string; title?: string }
    | { ok: false; response: ReturnType<typeof apiError> }
  try {
    result = await adminDb.runTransaction(async (transaction) => {
      const snap = await transaction.get(documentRef)
      if (!snap.exists || snap.data()?.deleted === true) {
        return { ok: false as const, response: apiError('Document not found', 404) }
      }

      const docData = snap.data() as Partial<ClientDocument>
      const access = assertClientDocumentDataAccess(docData, user)
      if (!access.ok) return access
      if (!canManageClientDocument(docData, user)) {
        return {
          ok: false as const,
          response: apiError('Only the document creator or platform staff can create versions', 403),
        }
      }

      const created = actorFrom(user)
      const updated = lastActorFrom(user)
      transaction.set(versionRef, {
        documentId: id,
        versionNumber: body.versionNumber ?? Date.now(),
        status: 'draft',
        blocks: storedBlocks,
        theme: theme.value,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: created.createdBy,
        createdByType: created.createdByType,
        ...(created.createdByAgentId ? { createdByAgentId: created.createdByAgentId } : {}),
        changeSummary: typeof body.changeSummary === 'string' ? body.changeSummary.trim() || 'Draft update' : 'Draft update',
      })
      transaction.update(documentRef, {
        currentVersionId: versionRef.id,
        updatedBy: updated.updatedBy,
        updatedByType: updated.updatedByType,
        updatedAt: updated.updatedAt,
        ...(updated.updatedByAgentId ? { updatedByAgentId: updated.updatedByAgentId } : {}),
      })

      return {
        ok: true as const,
        orgId: typeof docData.orgId === 'string' ? docData.orgId : undefined,
        title: typeof docData.title === 'string' ? docData.title : undefined,
      }
    })
  } catch (err) {
    console.error('[client-documents/versions] POST failed', { documentId: id, error: err })
    return apiError('Internal Server Error', 500)
  }

  if (!result.ok) return result.response

  // Re-open Context Dock after content lands (create shell may have opened empty).
  const handoffIds = result.orgId
    ? (await import('@/lib/messages/openContextHandoff')).parseMessagesHandoffIds(body as Record<string, unknown>)
    : { conversationId: null, responseMessageId: null }
  const handoff = result.orgId && handoffIds.conversationId && handoffIds.responseMessageId
    ? await import('@/lib/messages/openContextHandoff')
      .then((mod) => mod.handoffOpenContextFromCreate({
        orgId: result.orgId as string,
        body: body as Record<string, unknown>,
        kind: 'document',
        id,
        label: result.title || id,
        summary: `version: ${versionRef.id} | draft content updated`,
      }))
      .catch(() => null)
    : null

  return apiSuccess({
    id: versionRef.id,
    ...(handoff ? {
      documentId: id,
      contextRef: handoff.contextRef,
      uiActions: handoff.uiActions,
      messagesAttach: handoff.messagesAttach,
    } : {}),
  }, 201)
})
