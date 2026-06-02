/**
 * GET  /api/v1/crm/sequences — list workspace sequences (member+)
 * POST /api/v1/crm/sequences — create sequence (admin+)
 */
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { listSequences, createSequence } from '@/lib/sequences/store'
import type { SequenceInput } from '@/lib/sequences/types'
import { validateSequenceActivation } from '@/lib/sequences/validation'

export const dynamic = 'force-dynamic'

// ── GET ─────────────────────────────────────────────────────────────────────────

export const GET = withCrmAuth('member', async (_req, ctx) => {
  try {
    const sequences = await listSequences(ctx.orgId)
    return apiSuccess({ sequences })
  } catch (err) {
    console.error('[sequences-list-error]', err)
    return apiError('Internal Server Error', 500)
  }
})

// ── POST ────────────────────────────────────────────────────────────────────────

export const POST = withCrmAuth('admin', async (req, ctx) => {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON', 400)
  }

  if (Object.keys(body).length === 0) return apiError('Empty body', 400)

  // Validate required fields
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return apiError('name is required', 400)
  }
  if (!body.steps || !Array.isArray(body.steps) || body.steps.length === 0) {
    return apiError('steps is required and must be a non-empty array', 400)
  }

  // NEVER_FROM_BODY: id, orgId, createdAt, updatedAt, createdByRef, updatedByRef
  const {
    id: _id,
    orgId: _orgId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    createdByRef: _createdByRef,
    updatedByRef: _updatedByRef,
    ...rest
  } = body

  const input: Partial<SequenceInput> = {
    name: (rest.name as string).trim(),
    steps: rest.steps as SequenceInput['steps'],
    ...(rest.description !== undefined && { description: rest.description as string }),
    ...(rest.status !== undefined && { status: rest.status as SequenceInput['status'] }),
    ...(rest.topicId !== undefined && { topicId: rest.topicId as string }),
    ...(rest.goals !== undefined && { goals: rest.goals as SequenceInput['goals'] }),
    ...(rest.deleted !== undefined && { deleted: rest.deleted as boolean }),
  }

  // Ensure required SequenceInput fields have defaults
  if (!input.description) input.description = ''
  if (!input.status) input.status = 'draft'

  const activationError = validateSequenceActivation({
    status: input.status,
    steps: input.steps,
  })
  if (activationError) return apiError(activationError, 400)

  try {
    const sequence = await createSequence(ctx.orgId, input as SequenceInput, ctx.actor)
    return apiSuccess({ sequence }, 201)
  } catch (err) {
    console.error('[sequences-create-error]', err)
    return apiError('Internal Server Error', 500)
  }
})
