import { callAgentPath } from '@/lib/agents/team'
import type { AgentId } from '@/lib/agents/types'
import { buildClientProvisioningPayload, type ClientProvisioningInput } from './provisioner'

export type FullClientProvisioningResult = {
  profile: { skipped: true; reason: string }
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

  const workspaceResponse = await callAgentPath('pip' as AgentId, '/admin/client-workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!workspaceResponse.response.ok && !isConflict(workspaceResponse.response, workspaceResponse.data)) {
    throw new Error(`VPS workspace provisioning failed: ${JSON.stringify(workspaceResponse.data).slice(0, 500)}`)
  }

  return {
    profile: {
      skipped: true,
      reason: 'Partners in Biz agents now work inside client spaces; no per-client Hermes profile is created.',
    },
    workspace: workspaceResponse.response.ok
      ? workspaceResponse.data
      : { existing: true, upstream: workspaceResponse.data },
  }
}
