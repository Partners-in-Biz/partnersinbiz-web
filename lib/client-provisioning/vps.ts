import { callAgentPath } from '@/lib/agents/team'
import type { AgentId } from '@/lib/agents/types'
import { buildClientProvisioningPayload, type ClientProvisioningInput } from './provisioner'

export type FullClientProvisioningResult = {
  profile: unknown
  workspace: unknown
}

function isConflict(response: Response, data: unknown) {
  if (response.status === 409) return true
  if (!data || typeof data !== 'object') return false
  const detail = (data as Record<string, unknown>).detail
  return typeof detail === 'string' && detail.toLowerCase().includes('already exists')
}

export async function provisionFullClientOnVps(input: ClientProvisioningInput): Promise<FullClientProvisioningResult> {
  const payload = buildClientProvisioningPayload(input)

  const profileResponse = await callAgentPath('pip' as AgentId, '/admin/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: payload.domain,
      name: payload.agentName,
      role: 'Client Agent',
      persona: `${payload.agentName} supports ${payload.clientName} client work in the Partners in Biz Cowork system.`,
      defaultModel: 'gpt-5.5',
      provider: 'openai-codex',
      soul: payload.soul,
    }),
  })

  if (!profileResponse.response.ok && !isConflict(profileResponse.response, profileResponse.data)) {
    throw new Error(`VPS profile provisioning failed: ${JSON.stringify(profileResponse.data).slice(0, 500)}`)
  }

  const workspaceResponse = await callAgentPath('pip' as AgentId, '/admin/client-workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!workspaceResponse.response.ok) {
    throw new Error(`VPS workspace provisioning failed: ${JSON.stringify(workspaceResponse.data).slice(0, 500)}`)
  }

  return {
    profile: profileResponse.response.ok ? profileResponse.data : { existing: true, upstream: profileResponse.data },
    workspace: workspaceResponse.data,
  }
}
