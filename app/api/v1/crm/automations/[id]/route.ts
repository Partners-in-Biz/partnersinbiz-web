/**
 * PUT    /api/v1/crm/automations/:id — update automation rule (admin+)
 * DELETE /api/v1/crm/automations/:id — delete automation rule (admin+)
 */
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { updateRule, deleteRule } from '@/lib/automations/store'
import type { AutomationAction, AutomationRuleInput } from '@/lib/automations/types'
import { validateAutomationActionsForSave } from '@/lib/automations/validation'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

// ── PUT ─────────────────────────────────────────────────────────────────────────

export const PUT = withCrmAuth<RouteCtx>('admin', async (req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON', 400)
  }

  if (Object.keys(body).length === 0) return apiError('Empty body', 400)

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

  const patch: Partial<AutomationRuleInput> = {}
  if (rest.name !== undefined) patch.name = rest.name as string
  if (rest.trigger !== undefined) patch.trigger = rest.trigger as AutomationRuleInput['trigger']
  if (rest.actions !== undefined) {
    if (!Array.isArray(rest.actions)) return apiError('actions must be an array', 400)
    patch.actions = rest.actions as AutomationRuleInput['actions']
  }
  if (rest.enabled !== undefined) patch.enabled = rest.enabled as boolean
  if (rest.description !== undefined) patch.description = rest.description as string
  if (rest.conditions !== undefined) patch.conditions = rest.conditions as AutomationRuleInput['conditions']

  if (patch.actions !== undefined) {
    const actionError = await validateAutomationActionsForSave(ctx.orgId, patch.actions as AutomationAction[])
    if (actionError) return apiError(actionError, 400)
  }

  try {
    const rule = await updateRule(ctx.orgId, id, patch, ctx.actor)
    return apiSuccess({ rule })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/not found/i.test(message)) {
      return apiError('Not found', 404)
    }
    console.error('[automations-update-error]', err)
    return apiError('Internal Server Error', 500)
  }
})

// ── DELETE ──────────────────────────────────────────────────────────────────────

export const DELETE = withCrmAuth<RouteCtx>('admin', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params

  try {
    await deleteRule(ctx.orgId, id, ctx.actor)
    return apiSuccess({ deleted: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/not found/i.test(message)) {
      return apiError('Not found', 404)
    }
    console.error('[automations-delete-error]', err)
    return apiError('Internal Server Error', 500)
  }
})
