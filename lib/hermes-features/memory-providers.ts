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

export interface ExternalMemoryLookupResult {
  provider: ExternalMemoryProviderId
  ready: boolean
  hits: Array<{ id: string; text: string }>
  detail?: string
}

export interface ExternalMemoryLookupDeps {
  /** Real PiB agent-memory hybrid retrieval for builtin. */
  builtinLookup?: (query: string, orgId: string, agentId: string) => Promise<Array<{ id: string; text: string }>>
  /** Optional live Mem0 HTTP call when MEM0_API_KEY / config.apiKey present. */
  mem0Lookup?: (query: string, config: Record<string, string>) => Promise<Array<{ id: string; text: string }>>
  fetchImpl?: typeof fetch
}

function providerReady(binding: MemoryProviderBinding): { ready: boolean; detail?: string } {
  if (!binding.enabled) return { ready: false, detail: 'provider binding disabled' }
  if (binding.provider === 'builtin') return { ready: true, detail: 'uses PiB agent_memory / curated MEMORY' }
  if (binding.provider === 'mem0') {
    const key = binding.config.apiKey || process.env.MEM0_API_KEY
    if (!key) return { ready: false, detail: 'MEM0_API_KEY or binding config.apiKey required' }
    return { ready: true, detail: 'mem0 credentials present' }
  }
  if (binding.provider === 'honcho') {
    if (!binding.config.apiKey && !process.env.HONCHO_API_KEY) {
      return { ready: false, detail: 'HONCHO_API_KEY or binding config.apiKey required' }
    }
    return { ready: true }
  }
  if (binding.provider === 'openviking') {
    if (!binding.config.endpoint) {
      return { ready: false, detail: 'config.endpoint required for openviking' }
    }
    return { ready: true }
  }
  return { ready: false, detail: 'unknown provider' }
}

/**
 * External memory lookup — only returns fabricated-looking hits when a real adapter
 * path is ready. Otherwise ready=false and empty hits (no fake recall).
 */
export async function externalMemoryLookup(
  binding: MemoryProviderBinding,
  query: string,
  deps: ExternalMemoryLookupDeps = {},
): Promise<ExternalMemoryLookupResult> {
  const readiness = providerReady(binding)
  if (!readiness.ready) {
    return {
      provider: binding.provider,
      ready: false,
      hits: [],
      detail: readiness.detail,
    }
  }

  const q = query.trim()
  if (!q) {
    return { provider: binding.provider, ready: true, hits: [], detail: 'empty query' }
  }

  if (binding.provider === 'builtin') {
    if (deps.builtinLookup) {
      const hits = await deps.builtinLookup(q, binding.orgId, binding.agentId)
      return { provider: 'builtin', ready: true, hits, detail: 'builtin agent_memory path' }
    }
    // Without inject, return not_ready for fake-free honesty (tests inject builtinLookup).
    return {
      provider: 'builtin',
      ready: false,
      hits: [],
      detail: 'builtinLookup adapter not configured in this process',
    }
  }

  if (binding.provider === 'mem0') {
    if (deps.mem0Lookup) {
      const hits = await deps.mem0Lookup(q, binding.config)
      return { provider: 'mem0', ready: true, hits }
    }
    const apiKey = binding.config.apiKey || process.env.MEM0_API_KEY
    const base = binding.config.endpoint || process.env.MEM0_BASE_URL || 'https://api.mem0.ai'
    const fetchImpl = deps.fetchImpl || fetch
    try {
      const res = await fetchImpl(`${base.replace(/\/$/, '')}/v1/memories/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: q, user_id: binding.agentId, limit: 5 }),
      })
      if (!res.ok) {
        return {
          provider: 'mem0',
          ready: false,
          hits: [],
          detail: `mem0 search failed: ${res.status}`,
        }
      }
      const data = (await res.json()) as { results?: Array<{ id?: string; memory?: string; text?: string }> }
      const hits = (data.results || []).map((r, i) => ({
        id: r.id || `mem0-${i}`,
        text: r.memory || r.text || '',
      })).filter((h) => h.text)
      return { provider: 'mem0', ready: true, hits, detail: 'mem0 HTTP search' }
    } catch (err) {
      return {
        provider: 'mem0',
        ready: false,
        hits: [],
        detail: err instanceof Error ? err.message : String(err),
      }
    }
  }

  // honcho / openviking: require custom endpoint call — not silently fabricated
  return {
    provider: binding.provider,
    ready: false,
    hits: [],
    detail: `${binding.provider} adapter requires runtime client wiring (credentials present but HTTP client not enabled)`,
  }
}
