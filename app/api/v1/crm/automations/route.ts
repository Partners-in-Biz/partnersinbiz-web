/**
 * GET  /api/v1/crm/automations — list automation rules (member+)
 * POST /api/v1/crm/automations — create automation rule (admin+)
 */
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { listRules, createRule } from '@/lib/automations/store'
import type { AutomationRuleInput, TriggerEvent } from '@/lib/automations/types'

export const dynamic = 'force-dynamic'

const VALID_TRIGGER_EVENTS: TriggerEvent[] = [
  'deal.created',
  'deal.stage_changed',
  'deal.won',
  'deal.lost',
  'contact.created',
  'contact.lifecycle_changed',
]

// ── GET ─────────────────────────────────────────────────────────────────────────

export const GET = withCrmAuth('member', async (_req, ctx) => {
  try {
    const rules = await listRules(ctx.orgId)
    return apiSuccess({ rules })
  } catch (err) {
    console.error('[automations-list-error]', err)
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

  if (!body.trigger || typeof body.trigger !== 'object' || Array.isArray(body.trigger)) {
    return apiError('trigger is required and must be an object', 400)
  }

  const trigger = body.trigger as Record<string, unknown>
  if (!trigger.event || typeof trigger.event !== 'string') {
    return apiError('trigger.event is required', 400)
  }

  if (!VALID_TRIGGER_EVENTS.includes(trigger.event as TriggerEvent)) {
    return apiError(
      `trigger.event must be one of: ${VALID_TRIGGER_EVENTS.join(', ')}`,
      400,
    )
  }

  if (!Array.isArray(body.actions) || body.actions.length === 0) {
    return apiError('actions must be a non-empty array', 400)
  }

  const actions = body.actions as Record<string, unknown>[]
  for (const action of actions) {
    if (!action.type) {
      return apiError('each action must have a type field', 400)
    }
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

  const input: AutomationRuleInput = {
    name: (rest.name as string).trim(),
    trigger: rest.trigger as AutomationRuleInput['trigger'],
    actions: rest.actions as AutomationRuleInput['actions'],
    enabled: rest.enabled !== undefined ? (rest.enabled as boolean) : true,
    ...(rest.description !== undefined && { description: rest.description as string }),
    ...(rest.conditions !== undefined && { conditions: rest.conditions as AutomationRuleInput['conditions'] }),
  }

  try {
    const rule = await createRule(ctx.orgId, input, ctx.actor)
    return apiSuccess({ rule }, 201)
  } catch (err) {
    console.error('[automations-create-error]', err)
    return apiError('Internal Server Error', 500)
  }
})
