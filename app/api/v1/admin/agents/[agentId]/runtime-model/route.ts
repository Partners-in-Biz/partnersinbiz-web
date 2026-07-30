/**
 * GET/PUT /api/v1/admin/agents/[agentId]/runtime-model
 *
 * Super-admin control for the agent’s live Hermes Auto model:
 * primary provider/model, default reasoning effort, and fallback_providers.
 * Writes through the admin sidecar `/admin/config` and syncs Firestore
 * `agent_team.defaultModel` so the registry label stays aligned.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { enforceAgentCapability } from '@/lib/api/capabilityGate'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { getAgent, callAgentPath, updateAgent } from '@/lib/agents/team'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'
import {
  applyAgentRuntimeModelSettings,
  extractRuntimeModelSettings,
  formatRegistryDefaultModel,
  parseRuntimeModelSettings,
} from '@/lib/agents/runtime-config'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ agentId: string }> }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function unwrapSidecarConfig(data: unknown): {
  config: Record<string, unknown>
  path?: string
  raw: unknown
} | null {
  const root = asRecord(data)
  if (!root) return null
  if (asRecord(root.config)) {
    return {
      config: asRecord(root.config)!,
      path: typeof root.path === 'string' ? root.path : undefined,
      raw: data,
    }
  }
  // Some sidecars return the YAML object at the top level.
  if ('model' in root || 'agent' in root || 'fallback_providers' in root) {
    return { config: root, raw: data }
  }
  return null
}

export const GET = withAuth('admin', async (_req: NextRequest, _user, ctx) => {
  const { agentId } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)

  const agent = await getAgent(agentId as AgentId)
  if (!agent) return apiError(`agent_team/${agentId} not found`, 404)

  try {
    const { response, data } = await callAgentPath(agentId as AgentId, '/admin/config')
    if (!response.ok) {
      return apiError('Failed to read live agent config', 502, { upstream: data })
    }
    const unwrapped = unwrapSidecarConfig(data)
    if (!unwrapped) {
      return apiError('Live agent config was empty or unrecognised', 502, { upstream: data })
    }
    const settings = extractRuntimeModelSettings({ config: unwrapped.config })
    return apiSuccess({
      agentId,
      path: unwrapped.path ?? null,
      settings,
      registryDefaultModel: agent.defaultModel ?? null,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to reach agent', 502)
  }
})

export const PUT = withAuth('admin', async (req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Only super admins can edit agent runtime model', 403)

  const { agentId } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const capabilityError = enforceAgentCapability(
    user,
    'access_secret',
    req,
    body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null,
  )
  if (capabilityError) return capabilityError

  const parsed = parseRuntimeModelSettings(body)
  if (!parsed.ok) return apiError(parsed.error, 400)

  const agent = await getAgent(agentId as AgentId)
  if (!agent) return apiError(`agent_team/${agentId} not found`, 404)

  try {
    const { response: getResponse, data: getData } = await callAgentPath(agentId as AgentId, '/admin/config')
    if (!getResponse.ok) {
      return apiError('Failed to read live agent config before update', 502, { upstream: getData })
    }

    const unwrapped = unwrapSidecarConfig(getData)
    if (!unwrapped) {
      return apiError('Live agent config was empty or unrecognised', 502, { upstream: getData })
    }

    const nextConfig = applyAgentRuntimeModelSettings(unwrapped.config, parsed.settings)
    const { response: putResponse, data: putData } = await callAgentPath(agentId as AgentId, '/admin/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: nextConfig }),
    })
    if (!putResponse.ok) {
      return apiError('Failed to update agent runtime model', 502, { upstream: putData })
    }

    const registryDefaultModel = formatRegistryDefaultModel(parsed.settings)
    let updatedAgent = agent
    try {
      updatedAgent = await updateAgent(agentId as AgentId, { defaultModel: registryDefaultModel })
    } catch (registryError) {
      // Live Hermes config already saved — surface registry sync failure without rolling back.
      return apiSuccess({
        agentId,
        settings: extractRuntimeModelSettings({ config: nextConfig }),
        registryDefaultModel,
        registrySyncError: registryError instanceof Error ? registryError.message : 'Failed to sync registry defaultModel',
        agent,
        liveWrite: putData,
      })
    }

    return apiSuccess({
      agentId,
      settings: extractRuntimeModelSettings({ config: nextConfig }),
      registryDefaultModel,
      agent: updatedAgent,
      liveWrite: putData,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to reach agent', 502)
  }
})
