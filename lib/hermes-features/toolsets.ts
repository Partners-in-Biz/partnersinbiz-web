import {
  ALL_HERMES_TOOLSETS,
  DEFAULT_HERMES_TOOLSETS,
  type HermesToolsetId,
  type ToolsetPolicy,
} from './types'

export function normalizeToolsetId(value: string): HermesToolsetId | null {
  const cleaned = value.trim().toLowerCase().replace(/-/g, '_')
  return (ALL_HERMES_TOOLSETS as string[]).includes(cleaned)
    ? cleaned as HermesToolsetId
    : null
}

export function defaultToolsetPolicy(orgId: string, agentId: string, conversationId?: string): ToolsetPolicy {
  return {
    orgId,
    agentId,
    ...(conversationId ? { conversationId } : {}),
    enabled: [...DEFAULT_HERMES_TOOLSETS],
    updatedAt: new Date().toISOString(),
  }
}

export function enableToolset(policy: ToolsetPolicy, toolset: string): ToolsetPolicy {
  const id = normalizeToolsetId(toolset)
  if (!id) throw new Error(`Unknown toolset: ${toolset}`)
  if (policy.enabled.includes(id)) return policy
  return {
    ...policy,
    enabled: [...policy.enabled, id],
    updatedAt: new Date().toISOString(),
  }
}

export function disableToolset(policy: ToolsetPolicy, toolset: string): ToolsetPolicy {
  const id = normalizeToolsetId(toolset)
  if (!id) throw new Error(`Unknown toolset: ${toolset}`)
  return {
    ...policy,
    enabled: policy.enabled.filter((t) => t !== id),
    updatedAt: new Date().toISOString(),
  }
}

export function setToolsets(policy: ToolsetPolicy, toolsets: string[]): ToolsetPolicy {
  const enabled: HermesToolsetId[] = []
  for (const raw of toolsets) {
    const id = normalizeToolsetId(raw)
    if (!id) throw new Error(`Unknown toolset: ${raw}`)
    if (!enabled.includes(id)) enabled.push(id)
  }
  return { ...policy, enabled, updatedAt: new Date().toISOString() }
}

export function isToolsetEnabled(policy: ToolsetPolicy, toolset: string): boolean {
  const id = normalizeToolsetId(toolset)
  return Boolean(id && policy.enabled.includes(id))
}

export function toolsetDispatchBlock(policy: ToolsetPolicy): string {
  return [
    '[Hermes toolsets]',
    `agent: ${policy.agentId}`,
    `enabled: ${policy.enabled.join(', ') || '(none)'}`,
    'Only use tools that belong to enabled toolsets. If a needed toolset is disabled, say so and stop.',
    '',
  ].join('\n')
}
