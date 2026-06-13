type RuntimeAgentInput = {
  agentId: string
  defaultModel?: string | null
}

export type RuntimeModelSummarySource = 'live_config' | 'registry'

export type RuntimeModelSummary = {
  source: RuntimeModelSummarySource
  label: string
  primaryProvider?: string
  primaryModel?: string
  fallbackProvider?: string
  fallbackModel?: string
  registryDefaultModel?: string
  staleRegistry: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function splitProviderModel(value: string): { provider?: string; model?: string } {
  const trimmed = value.trim()
  const slash = trimmed.indexOf('/')
  if (slash <= 0 || slash === trimmed.length - 1) return { model: trimmed }
  return {
    provider: trimmed.slice(0, slash).trim(),
    model: trimmed.slice(slash + 1).trim(),
  }
}

function normalizeComparable(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/\s+/g, '').replace(/→/g, '/').trim()
}

function formatProviderModel(provider?: string, model?: string): string | undefined {
  if (provider && model) return `${provider} / ${model}`
  return model || provider
}

function unwrapLiveConfig(liveConfig: unknown): Record<string, unknown> | null {
  const liveObj = asRecord(liveConfig)
  if (!liveObj) return null
  return asRecord(liveObj.config) ?? liveObj
}

function extractPrimary(config: Record<string, unknown>): { provider?: string; model?: string } {
  const modelObj = asRecord(config.model)
  if (modelObj) {
    const provider = asString(modelObj.provider) ?? asString(config.provider)
    const model = asString(modelObj.default) ?? asString(modelObj.model) ?? asString(modelObj.name)
    return { provider, model }
  }

  const modelString = asString(config.model) ?? asString(config.defaultModel) ?? asString(config.default_model)
  const split = modelString ? splitProviderModel(modelString) : {}
  return {
    provider: split.provider ?? asString(config.provider),
    model: split.model,
  }
}

function extractFallback(config: Record<string, unknown>): { provider?: string; model?: string } {
  const rawFallbacks = Array.isArray(config.fallback_providers)
    ? config.fallback_providers
    : Array.isArray(config.fallbackProviders)
      ? config.fallbackProviders
      : []
  const first = rawFallbacks[0]
  const firstObj = asRecord(first)
  if (firstObj) {
    return {
      provider: asString(firstObj.provider),
      model: asString(firstObj.model) ?? asString(firstObj.default) ?? asString(firstObj.name),
    }
  }

  const firstString = asString(first)
  if (firstString) return splitProviderModel(firstString)

  const fallbackModel = asString(config.fallback_model) ?? asString(config.fallbackModel)
  const fallbackProvider = asString(config.fallback_provider) ?? asString(config.fallbackProvider)
  if (fallbackModel || fallbackProvider) {
    const split = fallbackModel ? splitProviderModel(fallbackModel) : {}
    return {
      provider: fallbackProvider ?? split.provider,
      model: split.model ?? fallbackModel,
    }
  }

  return {}
}

function isRegistryStale(registryDefault: string | undefined, primaryLabel: string | undefined, liveLabel: string): boolean {
  if (!registryDefault || !primaryLabel) return false
  const registry = normalizeComparable(registryDefault)
  return registry !== normalizeComparable(primaryLabel) && registry !== normalizeComparable(liveLabel)
}

export function buildRuntimeModelSummary(agent: RuntimeAgentInput, liveConfig: unknown): RuntimeModelSummary {
  const registryDefaultModel = asString(agent.defaultModel)
  const config = unwrapLiveConfig(liveConfig)

  if (!config) {
    return {
      source: 'registry',
      label: registryDefaultModel ?? 'Not configured',
      primaryModel: registryDefaultModel,
      registryDefaultModel,
      staleRegistry: false,
    }
  }

  const primary = extractPrimary(config)
  const fallback = extractFallback(config)
  const primaryLabel = formatProviderModel(primary.provider, primary.model)
  const fallbackLabel = formatProviderModel(fallback.provider, fallback.model)
  const label = [primaryLabel, fallbackLabel].filter(Boolean).join(' → ') || registryDefaultModel || 'Not configured'

  return {
    source: 'live_config',
    label,
    primaryProvider: primary.provider,
    primaryModel: primary.model,
    fallbackProvider: fallback.provider,
    fallbackModel: fallback.model,
    registryDefaultModel,
    staleRegistry: isRegistryStale(registryDefaultModel, primaryLabel, label),
  }
}
