/**
 * GET /api/v1/admin/agents
 *
 * Returns all agent team docs. The apiKey field is always masked
 * (last 6 chars visible, rest replaced with ●). Auth: admin.
 */

import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { callAgentPath, createAgent, listAgents } from '@/lib/agents/team'
import { isValidAgentId } from '@/lib/agents/types'
import { normalizeAgentRegistryInput } from '@/lib/agents/registry'
import { buildRuntimeModelSummary } from '@/lib/agents/runtime-config'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async () => {
  const agents = await listAgents()
  const enriched = await Promise.all(agents.map(async (agent) => {
    let liveConfig: unknown = null
    try {
      const { response, data } = await callAgentPath(agent.agentId, '/admin/config')
      if (response.ok) liveConfig = data
    } catch {
      // Live config is best-effort on the grid. Fall back to registry labels
      // rather than failing the whole admin Agents page when one sidecar is down.
    }

    return {
      ...agent,
      runtimeModel: buildRuntimeModelSummary(agent, liveConfig),
    }
  }))
  return apiSuccess(enriched)
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  if (!isSuperAdmin(user)) return apiError('Only super admins can create agents', 403)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const agentId = String(body.agentId ?? '').trim().toLowerCase()
  if (!isValidAgentId(agentId)) return apiError('agentId must start with a letter and contain only lowercase letters, numbers, dot, dash, or underscore', 400)

  const name = String(body.name ?? agentId).trim()
  const role = String(body.role ?? 'Specialist').trim()
  const persona = String(body.persona ?? `${name} supports Partners in Biz with focused specialist work.`).trim()
  const defaultModel = String(body.defaultModel ?? 'xai-oauth/grok-4.5').trim()
  const iconKey = String(body.iconKey ?? 'smart_toy').trim()
  const colorKey = String(body.colorKey ?? 'sky').trim()
  let adoptedExisting = body.adoptExisting === true
  const registry = normalizeAgentRegistryInput(body)

  try {
    let { response, data } = adoptedExisting
      ? await callAgentPath('pip', `/admin/profiles/${encodeURIComponent(agentId)}/registration`)
      : await callAgentPath('pip', '/admin/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          name,
          role,
          persona,
          defaultModel,
          provider: body.provider ?? 'openai-codex',
          soul: body.soul,
        }),
      })

    const upstreamDetail = String((data as Record<string, unknown>)?.detail ?? '')
    if (!adoptedExisting && response.status === 409 && upstreamDetail === 'profile already exists') {
      adoptedExisting = true
      ;({ response, data } = await callAgentPath(
        'pip',
        `/admin/profiles/${encodeURIComponent(agentId)}/registration`,
      ))
    }

    if (!response.ok) {
      return apiError(
        adoptedExisting ? 'Pip could not register the existing VPS profile' : 'Pip could not provision the VPS profile',
        502,
        { upstream: data },
      )
    }

    const result = data as Record<string, unknown>
    const baseUrl = String(result.baseUrl ?? '')
    const apiKey = String(result.apiKey ?? '')
    if (!baseUrl || !apiKey) return apiError('Provisioning response did not include baseUrl/apiKey', 502, { upstream: data })

    const agent = await createAgent({
      agentId,
      name,
      role,
      persona,
      defaultModel,
      iconKey,
      colorKey,
      enabled: true,
      baseUrl,
      apiKey,
      ...registry,
    })
    const { resolvePreferredAgentPort } = await import('@/lib/linked-computers/agent-host-ports')
    const safeProvisioned = { ...result }
    delete safeProvisioned.apiKey
    return apiSuccess({
      agent,
      provisioned: safeProvisioned,
      adoptedExisting,
      linkedComputerPull: {
        preferredPort: resolvePreferredAgentPort(agentId),
        catalogIncluded: true,
        note: 'Custom agents appear in Linked Computers → Agents and can be pulled with keep-in-sync (empty skill stamp until a managed policy exists).',
      },
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to create agent', 500)
  }
})
