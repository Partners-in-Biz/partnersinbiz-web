import { VALID_AGENT_EFFORTS, type AgentEffort } from '@/lib/agents/runRouting'

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
  reasoningEffort?: string | null
  registryDefaultModel?: string
  staleRegistry: boolean
}

export type RuntimeFallbackEntry = {
  provider: string
  model: string
}

/** Editable Auto model / effort / fallback settings for a live Hermes profile. */
export type AgentRuntimeModelSettings = {
  primaryProvider: string
  primaryModel: string
  primaryBaseUrl: string
  /** Empty string = unset / provider default. */
  reasoningEffort: string
  fallbacks: RuntimeFallbackEntry[]
}

export const COMMON_RUNTIME_PROVIDERS = [
  'xai-oauth',
  'openai-codex',
  'anthropic',
  'xai',
  'gemini',
  'openrouter',
  'openai',
] as const

export const RUNTIME_EFFORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Unset (provider default)' },
  { value: 'none', label: 'None' },
  ...VALID_AGENT_EFFORTS.filter((value) => value !== 'none').map((value) => ({
    value,
    label: value === 'xhigh' ? 'XHigh' : value.charAt(0).toUpperCase() + value.slice(1),
  })),
]

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

function readFallbackEntries(config: Record<string, unknown>): unknown[] {
  if (Array.isArray(config.fallback_providers)) return config.fallback_providers
  if (Array.isArray(config.fallbackProviders)) return config.fallbackProviders
  return []
}

function normalizeFallbackEntry(entry: unknown): { provider?: string; model?: string } {
  const obj = asRecord(entry)
  if (obj) {
    return {
      provider: asString(obj.provider),
      model: asString(obj.model) ?? asString(obj.default) ?? asString(obj.name),
    }
  }
  const asText = asString(entry)
  return asText ? splitProviderModel(asText) : {}
}

function extractFallback(config: Record<string, unknown>): { provider?: string; model?: string } {
  const rawFallbacks = readFallbackEntries(config)
  const first = normalizeFallbackEntry(rawFallbacks[0])
  if (first.provider || first.model) return first

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

function extractReasoningEffort(config: Record<string, unknown>): string {
  const agent = asRecord(config.agent)
  const raw = agent?.reasoning_effort ?? agent?.reasoningEffort
  if (raw === false || raw === 'false' || raw === 'off' || raw === 'no') return 'none'
  if (raw === true || raw === 'true') return 'medium'
  return asString(raw) ?? ''
}

function normalizeFallbackList(config: Record<string, unknown>): RuntimeFallbackEntry[] {
  const fromArray = readFallbackEntries(config)
    .map(normalizeFallbackEntry)
    .filter((entry): entry is RuntimeFallbackEntry => Boolean(entry.provider && entry.model))
    .map((entry) => ({ provider: entry.provider!, model: entry.model! }))

  if (fromArray.length > 0) return fromArray

  const legacy = extractFallback(config)
  if (legacy.provider && legacy.model) return [{ provider: legacy.provider, model: legacy.model }]
  return []
}

/** Primary + fallback providers/models declared on a live Hermes agent config. */
export function extractConfiguredRuntimeProviders(liveConfig: unknown): Array<{ provider?: string; model?: string; role: 'primary' | 'fallback' }> {
  const config = unwrapLiveConfig(liveConfig)
  if (!config) return []

  const entries: Array<{ provider?: string; model?: string; role: 'primary' | 'fallback' }> = []
  const primary = extractPrimary(config)
  if (primary.provider || primary.model) entries.push({ ...primary, role: 'primary' })

  for (const entry of normalizeFallbackList(config)) {
    entries.push({ ...entry, role: 'fallback' })
  }

  return entries
}

/** Read editable Auto model settings from live Hermes config (or null if unavailable). */
export function extractRuntimeModelSettings(liveConfig: unknown): AgentRuntimeModelSettings | null {
  const config = unwrapLiveConfig(liveConfig)
  if (!config) return null

  const primary = extractPrimary(config)
  const modelObj = asRecord(config.model)
  const baseUrl = asString(modelObj?.base_url) ?? asString(modelObj?.baseUrl) ?? ''

  return {
    primaryProvider: primary.provider ?? '',
    primaryModel: primary.model ?? '',
    primaryBaseUrl: baseUrl,
    reasoningEffort: extractReasoningEffort(config),
    fallbacks: normalizeFallbackList(config),
  }
}

export type ParseRuntimeModelSettingsResult =
  | { ok: true; settings: AgentRuntimeModelSettings }
  | { ok: false; error: string }

/** Validate and normalize a client payload for runtime model settings. */
export function parseRuntimeModelSettings(body: unknown): ParseRuntimeModelSettingsResult {
  const obj = asRecord(body)
  if (!obj) return { ok: false, error: 'Body must be a JSON object' }

  const primaryProvider = asString(obj.primaryProvider)
  const primaryModel = asString(obj.primaryModel)
  if (!primaryProvider) return { ok: false, error: 'primaryProvider is required' }
  if (!primaryModel) return { ok: false, error: 'primaryModel is required' }

  const primaryBaseUrl = asString(obj.primaryBaseUrl) ?? ''
  const effortRaw = obj.reasoningEffort
  let reasoningEffort = ''
  if (effortRaw !== undefined && effortRaw !== null && effortRaw !== '') {
    if (typeof effortRaw !== 'string') return { ok: false, error: 'reasoningEffort must be a string' }
    const cleaned = effortRaw.trim().toLowerCase()
    if (!VALID_AGENT_EFFORTS.includes(cleaned as AgentEffort)) {
      return {
        ok: false,
        error: `Invalid reasoningEffort; expected one of ${VALID_AGENT_EFFORTS.join(' | ')} or empty`,
      }
    }
    reasoningEffort = cleaned
  }

  const rawFallbacks = obj.fallbacks
  if (rawFallbacks !== undefined && !Array.isArray(rawFallbacks)) {
    return { ok: false, error: 'fallbacks must be an array' }
  }

  const fallbacks: RuntimeFallbackEntry[] = []
  for (const [index, entry] of (rawFallbacks ?? []).entries()) {
    const record = asRecord(entry)
    if (!record) return { ok: false, error: `fallbacks[${index}] must be an object` }
    const provider = asString(record.provider)
    const model = asString(record.model) ?? asString(record.default)
    if (!provider || !model) {
      return { ok: false, error: `fallbacks[${index}] requires provider and model` }
    }
    fallbacks.push({ provider, model })
  }

  return {
    ok: true,
    settings: {
      primaryProvider,
      primaryModel,
      primaryBaseUrl,
      reasoningEffort,
      fallbacks,
    },
  }
}

/**
 * Merge Auto model / effort / fallbacks into a Hermes config object.
 * Preserves unrelated keys (SOUL paths, tools, memory, etc.).
 */
export function applyAgentRuntimeModelSettings(
  config: Record<string, unknown>,
  settings: AgentRuntimeModelSettings,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config }
  const existingModel = asRecord(config.model) ?? {}
  const model: Record<string, unknown> = {
    ...existingModel,
    provider: settings.primaryProvider.trim(),
    default: settings.primaryModel.trim(),
  }

  if (settings.primaryBaseUrl.trim()) {
    model.base_url = settings.primaryBaseUrl.trim()
  } else {
    delete model.base_url
    delete model.baseUrl
  }

  next.model = model
  next.fallback_providers = settings.fallbacks.map((entry) => ({
    provider: entry.provider.trim(),
    model: entry.model.trim(),
  }))

  // Drop legacy singular keys so the list is authoritative.
  delete next.fallback_provider
  delete next.fallbackProvider
  delete next.fallback_model
  delete next.fallbackModel
  delete next.fallbackProviders

  const agent: Record<string, unknown> = { ...(asRecord(config.agent) ?? {}) }
  if (settings.reasoningEffort.trim()) {
    agent.reasoning_effort = settings.reasoningEffort.trim().toLowerCase()
  } else {
    agent.reasoning_effort = ''
  }
  next.agent = agent

  return next
}

/** Registry label written when syncing Firestore defaultModel after a live save. */
export function formatRegistryDefaultModel(settings: AgentRuntimeModelSettings): string {
  const primary = formatProviderModel(settings.primaryProvider, settings.primaryModel)
  const firstFallback = settings.fallbacks[0]
  const fallback = firstFallback
    ? formatProviderModel(firstFallback.provider, firstFallback.model)
    : undefined
  return [primary, fallback].filter(Boolean).join(' → ') || settings.primaryModel
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
  const reasoningEffort = extractReasoningEffort(config) || null
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
    reasoningEffort,
    registryDefaultModel,
    staleRegistry: isRegistryStale(registryDefaultModel, primaryLabel, label),
  }
}
