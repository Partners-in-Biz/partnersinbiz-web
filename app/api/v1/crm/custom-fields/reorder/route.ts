/**
 * POST /api/v1/crm/custom-fields/reorder
 *   → admin+  Reorders definitions for a resource by providing the full ordered list of IDs.
 *
 * Body: { resource: 'contact' | 'deal' | 'company', ids: string[] }
 *
 * Validates:
 *   - resource is valid
 *   - all ids belong to this org and the given resource
 *   - batch-updates `order` field (chunked at 30 for Firestore batch limits)
 */
import { Timestamp } from 'firebase-admin/firestore'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { loadDefinition } from '@/lib/customFields/store'
import type { CustomFieldResource } from '@/lib/customFields/types'

const VALID_RESOURCES: CustomFieldResource[] = ['contact', 'deal', 'company']

const CHUNK_SIZE = 30

export const POST = withCrmAuth('admin', async (req, ctx) => {
  let body: { resource?: unknown; ids?: unknown }
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON', 400)
  }

  const { resource, ids } = body as { resource: unknown; ids: unknown }

  if (!resource || !VALID_RESOURCES.includes(resource as CustomFieldResource)) {
    return apiError('resource is required and must be one of: contact, deal, company', 400)
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return apiError('ids must be a non-empty array of strings', 400)
  }

  if (ids.some((id) => typeof id !== 'string' || !id.trim())) {
    return apiError('ids must be an array of non-empty strings', 400)
  }

  // Validate all ids in parallel — each must exist, belong to org, and match resource
  const results = await Promise.all(
    ids.map((id: string) => loadDefinition(id, ctx.orgId)),
  )

  for (let i = 0; i < results.length; i++) {
    const loaded = results[i]
    if (!loaded) {
      return apiError(`id "${ids[i]}" not found or does not belong to this workspace`, 400)
    }
    if (loaded.data.resource !== (resource as CustomFieldResource)) {
      return apiError(
        `id "${ids[i]}" belongs to resource "${loaded.data.resource}", not "${resource}"`,
        400,
      )
    }
  }

  // Batch-update order in chunks of 30
  const now = Timestamp.now()
  const chunks: Array<Array<{ ref: FirebaseFirestore.DocumentReference; idx: number }>> = []

  for (let i = 0; i < results.length; i += CHUNK_SIZE) {
    chunks.push(
      results.slice(i, i + CHUNK_SIZE).map((r, j) => ({ ref: r!.ref, idx: i + j })),
    )
  }

  await Promise.all(
    chunks.map((chunk) =>
      Promise.all(
        chunk.map(({ ref, idx }) =>
          ref.update({
            order: idx,
            updatedAt: now,
            updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
            updatedByRef: ctx.actor,
          }),
        ),
      ),
    ),
  )

  return apiSuccess({ reordered: ids.length })
})
