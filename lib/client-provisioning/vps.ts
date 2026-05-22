import { callAgentPath } from '@/lib/agents/team'
import type { AgentId } from '@/lib/agents/types'
import { buildClientProvisioningPayload, type ClientProvisioningInput } from './provisioner'

export type FullClientProvisioningResult = {
  profile: unknown
  workspace: unknown
  warnings?: string[]
}

function isConflict(response: Response, data: unknown) {
  if (response.status === 409) return true
  if (!data || typeof data !== 'object') return false
  const detail = (data as Record<string, unknown>).detail
  return typeof detail === 'string' && detail.toLowerCase().includes('already exists')
}

export async function provisionFullClientOnVps(input: ClientProvisioningInput): Promise<FullClientProvisioningResult> {
  const payload = buildClientProvisioningPayload(input)
  const warnings: string[] = []

  const workspaceResponse = await callAgentPath('pip' as AgentId, '/admin/client-workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!workspaceResponse.response.ok && !isConflict(workspaceResponse.response, workspaceResponse.data)) {
    throw new Error(`VPS workspace provisioning failed: ${JSON.stringify(workspaceResponse.data).slice(0, 500)}`)
  }

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

  const profileExists = isConflict(profileResponse.response, profileResponse.data)
  const profileProvisioned = profileResponse.response.ok || profileExists
  if (!profileProvisioned) {
    warnings.push(`VPS profile provisioning warning: ${JSON.stringify(profileResponse.data).slice(0, 500)}`)
  }

  return {
    profile: profileResponse.response.ok
      ? profileResponse.data
      : profileExists
        ? { existing: true, upstream: profileResponse.data }
        : { skipped: true, upstream: profileResponse.data },
    workspace: workspaceResponse.response.ok
      ? workspaceResponse.data
      : { existing: true, upstream: workspaceResponse.data },
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}
