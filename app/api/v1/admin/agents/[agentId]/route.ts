/**
 * PUT /api/v1/admin/agents/[agentId]
 *
 * Updates a single agent doc. Accepts any combination of:
 *   enabled, name, persona, baseUrl, apiKey, defaultModel
 *
 * If apiKey is supplied it is re-encrypted before write.
 * Side-effect: also syncs agent_dispatch_configs/{agentId} so the
 * watcher daemon picks up endpoint/key changes immediately.
 *
 * Auth: admin.
 */

import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { updateAgent } from '@/lib/agents/team'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

export const PUT = withAuth(
  'admin',
  async (req: NextRequest, user, context?: { params?: Promise<{ agentId?: string }> | { agentId?: string } }) => {
    if (!isSuperAdmin(user)) return apiError('Only super admins can edit agents', 403)

    const params = context?.params ? await context.params : {}
    const agentId = (params as { agentId?: string }).agentId as string | undefined
    if (!agentId || !isValidAgentId(agentId)) {
      return apiError('Invalid agentId', 400)
    }

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return apiError('Invalid JSON body', 400)
    }

    const ALLOWED_FIELDS = [
      'enabled',
      'name',
      'persona',
      'baseUrl',
      'apiKey',
      'defaultModel',
      'responsibilities',
      'skills',
      'cronWatchLoops',
      'allowedScopes',
      'exampleTaskTypes',
    ] as const
    type AllowedField = (typeof ALLOWED_FIELDS)[number]

    const patch: Partial<Record<AllowedField, unknown>> = {}
    for (const field of ALLOWED_FIELDS) {
      if (field in body) patch[field] = body[field]
    }

    if (Object.keys(patch).length === 0) {
      return apiError('No updatable fields provided', 400)
    }

    // Basic type validation
    if ('enabled' in patch && typeof patch.enabled !== 'boolean') {
      return apiError('enabled must be a boolean', 400)
    }
    for (const strField of ['name', 'persona', 'baseUrl', 'apiKey', 'defaultModel'] as const) {
      if (strField in patch && typeof patch[strField] !== 'string') {
        return apiError(`${strField} must be a string`, 400)
      }
    }
    for (const arrayField of ['responsibilities', 'skills', 'cronWatchLoops', 'allowedScopes', 'exampleTaskTypes'] as const) {
      if (arrayField in patch && (!Array.isArray(patch[arrayField]) || !(patch[arrayField] as unknown[]).every((item) => typeof item === 'string'))) {
        return apiError(`${arrayField} must be an array of strings`, 400)
      }
    }

    const updated = await updateAgent(agentId as AgentId, patch as Parameters<typeof updateAgent>[1])
    return apiSuccess({ agent: updated })
  },
)
