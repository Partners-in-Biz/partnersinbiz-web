import type { ExternalMemoryProviderId, MemoryProviderBinding } from './types'

export const EXTERNAL_MEMORY_PROVIDERS: ExternalMemoryProviderId[] = [
  'builtin',
  'honcho',
  'mem0',
  'openviking',
]

export function createMemoryProviderBinding(input: {
  orgId: string
  agentId: string
  provider: string
  enabled?: boolean
  config?: Record<string, string>
}): MemoryProviderBinding {
  const provider = input.provider.trim().toLowerCase() as ExternalMemoryProviderId
  if (!EXTERNAL_MEMORY_PROVIDERS.includes(provider)) {
    throw new Error(`Unknown memory provider: ${input.provider}`)
  }
  return {
    orgId: input.orgId,
    agentId: input.agentId,
    provider,
    enabled: input.enabled !== false,
    config: { ...(input.config || {}) },
    updatedAt: new Date().toISOString(),
  }
}

/** Adapter beyond MEMORY/USER: external provider lookup stub with concrete shape. */
export function externalMemoryLookup(
  binding: MemoryProviderBinding,
  query: string,
): { provider: ExternalMemoryProviderId; hits: Array<{ id: string; text: string }> } {
  if (!binding.enabled) {
    return { provider: binding.provider, hits: [] }
  }
  if (binding.provider === 'builtin') {
    return {
      provider: 'builtin',
      hits: query.trim()
        ? [{ id: 'builtin-1', text: `builtin recall for: ${query.trim().slice(0, 120)}` }]
        : [],
    }
  }
  // External backends return adapter-shaped hits without requiring live credentials in unit tests.
  return {
    provider: binding.provider,
    hits: [
      {
        id: `${binding.provider}-1`,
        text: `[${binding.provider}] recall: ${query.trim().slice(0, 120) || '(empty)'}`,
      },
    ],
  }
}
