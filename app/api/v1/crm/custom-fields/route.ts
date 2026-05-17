/**
 * GET  /api/v1/crm/custom-fields?resource=contact|deal|company
 *   → viewer+  Returns definitions for the given resource.
 *
 * POST /api/v1/crm/custom-fields
 *   → admin+  Creates a new custom field definition.
 */
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  getDefinitionsForResource,
  assertKeyUnique,
  sanitizeDefinitionForWrite,
  CustomFieldKeyError,
} from '@/lib/customFields/store'
import type { CustomFieldResource, CustomFieldType, CustomFieldDefinition } from '@/lib/customFields/types'

const VALID_RESOURCES: CustomFieldResource[] = ['contact', 'deal', 'company']

const VALID_TYPES: CustomFieldType[] = [
  'text',
  'longtext',
  'number',
  'currency',
  'date',
  'datetime',
  'dropdown',
  'multi_select',
  'checkbox',
  'url',
  'email',
  'phone',
]

const OPTION_TYPES = new Set<CustomFieldType>(['dropdown', 'multi_select'])

// ── GET ──────────────────────────────────────────────────────────────────────

export const GET = withCrmAuth('viewer', async (req, ctx) => {
  const { searchParams } = new URL(req.url)
  const resource = searchParams.get('resource') as CustomFieldResource | null

  if (!resource || !VALID_RESOURCES.includes(resource)) {
    return apiError('resource query param is required and must be one of: contact, deal, company', 400)
  }

  const definitions = await getDefinitionsForResource(ctx.orgId, resource)
  return apiSuccess({ definitions })
})

// ── POST ─────────────────────────────────────────────────────────────────────

export const POST = withCrmAuth('admin', async (req, ctx) => {
  let body: Partial<CustomFieldDefinition>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON', 400)
  }

  if (Object.keys(body).length === 0) return apiError('Empty body', 400)

  // Required field validation
  if (!body.resource || !VALID_RESOURCES.includes(body.resource)) {
    return apiError('resource is required and must be one of: contact, deal, company', 400)
  }
  if (!body.label?.trim()) return apiError('label is required', 400)
  if (!body.type || !VALID_TYPES.includes(body.type)) {
    return apiError('type is required and must be a valid CustomFieldType', 400)
  }
  if (!body.key?.trim()) return apiError('key is required', 400)

  // options required for dropdown / multi_select
  if (OPTION_TYPES.has(body.type)) {
    if (!Array.isArray(body.options) || body.options.length === 0) {
      return apiError('options is required and must be non-empty for dropdown and multi_select fields', 400)
    }
    const values = body.options.map((o) => o.value)
    if (new Set(values).size !== values.length) {
      return apiError('options values must be unique', 400)
    }
  }

  // Sanitize (strips NEVER_FROM_BODY, validates key regex)
  let sanitized: Record<string, unknown>
  try {
    sanitized = sanitizeDefinitionForWrite(body)
  } catch (err) {
    if (err instanceof CustomFieldKeyError) return apiError(`Invalid key: ${err.message}`, 400)
    throw err
  }

  const resource = body.resource
  const key = sanitized.key as string

  // Key uniqueness
  const isUnique = await assertKeyUnique(ctx.orgId, resource, key)
  if (!isUnique) return apiError(`key "${key}" already exists for resource "${resource}" in this workspace`, 400)

  // Compute order
  const existingDefs = await getDefinitionsForResource(ctx.orgId, resource)
  const maxOrder = existingDefs.reduce((max, d) => Math.max(max, d.order ?? 0), -1)
  const order = typeof body.order === 'number' ? body.order : maxOrder + 1

  const now = Timestamp.now()
  const defData: Record<string, unknown> = {
    orgId: ctx.orgId,
    ...sanitized,
    order,
    required: body.required ?? false,
    deleted: false,
    createdBy: ctx.isAgent ? undefined : ctx.actor.uid,
    createdByRef: ctx.actor,
    updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
    updatedByRef: ctx.actor,
    createdAt: now,
    updatedAt: now,
  }

  // Strip undefined values
  const toWrite = Object.fromEntries(
    Object.entries(defData).filter(([, v]) => v !== undefined),
  )

  const ref = adminDb.collection('customFieldDefinitions').doc()
  await ref.set(toWrite)

  return apiSuccess({ definition: { ...toWrite, id: ref.id } }, 201)
})
