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
import { isSuperAdmin } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async () => {
  const agents = await listAgents()
  return apiSuccess(agents)
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
  const defaultModel = String(body.defaultModel ?? 'gpt-5.5').trim()
  const iconKey = String(body.iconKey ?? 'smart_toy').trim()
  const colorKey = String(body.colorKey ?? 'sky').trim()
  const registry = normalizeAgentRegistryInput(body)

  try {
    const { response, data } = await callAgentPath('pip', '/admin/profiles', {
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
    if (!response.ok) return apiError('Pip could not provision the VPS profile', 502, { upstream: data })

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
    const safeProvisioned = { ...result }
    delete safeProvisioned.apiKey
    return apiSuccess({ agent, provisioned: safeProvisioned })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to create agent', 500)
  }
})
