import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { clientCanAccessOrg, canWriteOrgLlmConnection } from '@/lib/llm-providers/org-guard'
import {
  getLlmProviderConnection,
  revokeLlmProviderConnection,
  canManageLlmConnection,
} from '@/lib/llm-providers/store'
import { syncLlmConnectionToHermes } from '@/lib/llm-providers/sync-hermes'
import { callAgentPath } from '@/lib/agents/team'
import type { AgentId } from '@/lib/agents/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

function resolveOrgId(req: NextRequest, user: ApiUser): string | null {
  const url = new URL(req.url)
  return url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.orgId ?? user.orgIds?.[0] ?? null
}

export const DELETE = withAuth('client', async (req: NextRequest, user: ApiUser, ctx) => {
  const { id } = await (ctx as Ctx).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  if (!clientCanAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const existing = await getLlmProviderConnection(id)
  if (!existing) return apiError('Connection not found', 404)
  if (!canManageLlmConnection(existing, { orgId, uid: user.uid })) return apiError('Forbidden', 403)
  if (existing.scope === 'org' && !(await canWriteOrgLlmConnection(user, orgId))) {
    return apiError('Only organisation admins can disconnect shared organisation VPS credentials.', 403)
  }

  // Best-effort unset on agents previously synced (org VPS and/or personal linked computers).
  if (existing.syncedAgentIds?.length && existing.authKind !== 'oauth_token') {
    const defEnv = existing.provider === 'copilot'
      ? 'COPILOT_GITHUB_TOKEN'
      : existing.provider === 'xai'
        ? 'XAI_API_KEY'
        : existing.provider === 'openai-api'
          ? 'OPENAI_API_KEY'
          : existing.provider === 'anthropic'
            ? 'ANTHROPIC_API_KEY'
            : existing.provider === 'gemini'
              ? 'GEMINI_API_KEY'
              : existing.provider === 'openrouter'
                ? 'OPENROUTER_API_KEY'
                : null
    if (defEnv) {
      await Promise.allSettled(
        existing.syncedAgentIds.map((agentId) =>
          callAgentPath(agentId as AgentId, '/admin/env', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ set: {}, unset: [defEnv] }),
          }),
        ),
      )
    }
  }
  if (existing.syncedAgentIds?.length && (existing.authKind === 'oauth_token' || existing.provider.includes('oauth') || existing.provider === 'openai-codex' || existing.provider === 'nous')) {
    await Promise.allSettled(
      existing.syncedAgentIds.map((agentId) =>
        callAgentPath(agentId as AgentId, `/admin/auth/providers/${existing.hermesProvider}`, {
          method: 'DELETE',
        }),
      ),
    )
  }

  const connection = await revokeLlmProviderConnection(id, { orgId, uid: user.uid })
  return apiSuccess({ connection })
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx) => {
  const { id } = await (ctx as Ctx).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  if (!clientCanAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const existing = await getLlmProviderConnection(id)
  if (!existing) return apiError('Connection not found', 404)
  if (!canManageLlmConnection(existing, { orgId, uid: user.uid })) return apiError('Forbidden', 403)
  if (existing.scope === 'org' && !(await canWriteOrgLlmConnection(user, orgId))) {
    return apiError('Only organisation admins can sync shared organisation VPS credentials.', 403)
  }
  const body = await req.json().catch(() => ({})) as { agentIds?: string[] }
  try {
    const sync = await syncLlmConnectionToHermes(id, {
      agentIds: Array.isArray(body.agentIds) ? body.agentIds : undefined,
      accessPolicy: user.memberAccessPolicy,
    })
    return apiSuccess({ sync })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Sync failed', 502)
  }
})
