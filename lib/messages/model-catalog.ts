import { adminDb } from '@/lib/firebase/admin'
import { callAgentPath } from '@/lib/agents/team'
import {
  buildRuntimeModelSummary,
  extractConfiguredRuntimeProviders,
} from '@/lib/agents/runtime-config'
import { isValidAgentId, type AgentId, type AgentTeamDoc } from '@/lib/agents/types'
import type { ApiUser } from '@/lib/api/types'
import type { Conversation } from '@/lib/conversations/types'
import { listLlmProviderConnections } from '@/lib/llm-providers/store'
import { getLlmProvider, listLlmProviders } from '@/lib/llm-providers/providers'
import {
  isOrgVpsConversationRuntime,
  runtimeBelongsToUserComputer,
} from '@/lib/llm-providers/sync-targets'
import { memberMayUsePersonalLlmOnOrgVps } from '@/lib/orgMembers/access-policy'
import {
  expandProviderAliases,
  normalizeProviderId,
  providersShareCredentialFamily,
} from '@/lib/messages/model-provider-aliases'

const SAFE_MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+~=-]{0,191}$/
const SAFE_PROVIDER_ID_RE = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/

/** OAuth-only Hermes provider ids that require nested auth.json tokens. */
const OAUTH_HERMES_PROVIDERS = new Set([
  'xai-oauth',
  'openai-codex',
  'nous',
])

type UnknownRecord = Record<string, unknown>

function isOauthHermesProvider(provider: string): boolean {
  const normalized = normalizeProviderId(provider)
  if (!normalized) return false
  if (OAUTH_HERMES_PROVIDERS.has(normalized)) return true
  return normalized.endsWith('-oauth')
}

async function probeRuntimeOauthProviders(
  agentId: AgentId,
  runtimeTarget?: string,
): Promise<{
  probed: boolean
  byProvider: Map<string, { usable: boolean; hasAccess: boolean; hasRefresh: boolean }>
}> {
  try {
    const { response, data } = await callAgentPath(
      agentId,
      '/admin/auth/providers',
      { method: 'GET' },
      { runtimeTarget },
    )
    if (!response.ok) {
      return { probed: false, byProvider: new Map() }
    }
    const providers = data && typeof data === 'object' && 'providers' in data
      ? (data as { providers?: Record<string, UnknownRecord> }).providers
      : null
    if (!providers || typeof providers !== 'object') {
      return { probed: true, byProvider: new Map() }
    }
    const byProvider = new Map<string, { usable: boolean; hasAccess: boolean; hasRefresh: boolean }>()
    for (const [name, state] of Object.entries(providers)) {
      if (!state || typeof state !== 'object') continue
      const key = normalizeProviderId(name)
      if (!key) continue
      const hasAccess = state.has_access_token === true
      const hasRefresh = state.has_refresh_token === true
      const usable = state.usable === true
        || (state.hermes_shape === true && hasAccess && hasRefresh)
      byProvider.set(key, { usable, hasAccess, hasRefresh })
    }
    return { probed: true, byProvider }
  } catch {
    return { probed: false, byProvider: new Map() }
  }
}

export interface PublicMessageModelOption {
  id: string
  model: string
  displayName: string
  provider: string
  providerLabel: string
  configured: boolean
  active: boolean
  available: boolean
  connected?: boolean
  /** True when credentials are personal (linked computer), not on the org VPS. */
  localOnly?: boolean
  source: 'hermes' | 'agent-default' | 'connected'
  supportsThinking?: boolean
  supportsVision?: boolean
  supportsTools?: boolean
  reasonUnavailable?: string
}

export interface PublicMessageModelCatalog {
  agentId: AgentId | null
  canSelect: boolean
  /** Live Hermes primary model used by Auto (or registry fallback). */
  currentModel?: string
  currentProvider?: string
  /** Explicit Auto target — same as current* when live config is known. */
  autoModel?: string
  autoProvider?: string
  autoLabel?: string
  runtimeSource?: 'live_config' | 'registry'
  models: PublicMessageModelOption[]
  providers: Array<{ id: string; label: string; configured: boolean; active: boolean; connected?: boolean }>
  source: 'hermes' | 'agent-default' | 'none'
  warning?: string
  connectProvidersUrl?: string
  /** Providers saved as personal (linked computer) — not available on the organisation VPS. */
  localOnlyProviderLabels?: string[]
  /** Providers Hermes is configured to use (primary + fallbacks), independent of PiB Settings. */
  hermesConfiguredProviders?: string[]
  /** Count of models that are actually selectable with credentials/config. */
  selectableModelCount?: number
}

export interface ValidatedMessageModelSelection {
  model: string
  provider?: string
}

export interface MessageModelValidationResult {
  ok: boolean
  status?: number
  error?: string
  selection?: ValidatedMessageModelSelection
  catalog?: PublicMessageModelCatalog
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function cleanMessageModelId(value: unknown): string {
  const cleaned = readString(value)
  if (!cleaned || !SAFE_MODEL_ID_RE.test(cleaned)) return ''
  return cleaned
}

export function cleanMessageProviderId(value: unknown): string {
  const cleaned = readString(value)
  if (!cleaned || !SAFE_PROVIDER_ID_RE.test(cleaned)) return ''
  return cleaned
}

function providerFromModelId(modelId: string): string {
  const [provider] = modelId.split('/')
  return cleanMessageProviderId(provider) || 'hermes'
}

function labelFromProvider(provider: string): string {
  return provider
    .split(/[-_.:]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || provider
}

function displayNameFromModelId(modelId: string): string {
  const leaf = modelId.split('/').pop() || modelId
  return leaf.replace(/[-_]/g, ' ')
}

function readModelEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  const record = asRecord(payload)
  if (!record) return []
  if (Array.isArray(record.data)) return record.data
  if (Array.isArray(record.models)) return record.models
  if (Array.isArray(record.availableModels)) return record.availableModels
  return []
}

function normalizeModelEntry(entry: unknown, currentModel = ''): PublicMessageModelOption | null {
  if (typeof entry === 'string') {
    const id = cleanMessageModelId(entry)
    if (!id) return null
    const provider = providerFromModelId(id)
    return {
      id,
      model: id,
      displayName: displayNameFromModelId(id),
      provider,
      providerLabel: labelFromProvider(provider),
      configured: true,
      active: id === currentModel,
      available: true,
      source: 'hermes',
    }
  }

  const record = asRecord(entry)
  if (!record) return null
  const id = cleanMessageModelId(record.id) || cleanMessageModelId(record.model) || cleanMessageModelId(record.name)
  if (!id) return null
  const provider = cleanMessageProviderId(record.provider) || cleanMessageProviderId(record.owned_by) || providerFromModelId(id)
  const displayName = readString(record.displayName) || readString(record.display_name) || readString(record.label) || readString(record.name) || displayNameFromModelId(id)
  const unavailableReason = readString(record.reasonUnavailable) || readString(record.reason_unavailable)

  return {
    id,
    model: id,
    displayName,
    provider,
    providerLabel: labelFromProvider(provider),
    configured: record.configured !== false,
    active: id === currentModel,
    available: record.available !== false,
    source: 'hermes',
    ...(typeof record.supportsThinking === 'boolean' ? { supportsThinking: record.supportsThinking } : {}),
    ...(typeof record.supportsVision === 'boolean' ? { supportsVision: record.supportsVision } : {}),
    ...(typeof record.supportsTools === 'boolean' ? { supportsTools: record.supportsTools } : {}),
    ...(unavailableReason ? { reasonUnavailable: unavailableReason } : {}),
  }
}

function fallbackModelOption(agentData: Partial<AgentTeamDoc> | null): PublicMessageModelOption | null {
  const model = cleanMessageModelId(agentData?.defaultModel)
  if (!model) return null
  const provider = providerFromModelId(model)
  return {
    id: model,
    model,
    displayName: displayNameFromModelId(model),
    provider,
    providerLabel: labelFromProvider(provider),
    configured: true,
    active: true,
    available: true,
    source: 'agent-default',
  }
}

function dedupeModels(models: PublicMessageModelOption[]): PublicMessageModelOption[] {
  const byId = new Map<string, PublicMessageModelOption>()
  for (const model of models) {
    const existing = byId.get(model.id)
    if (!existing || existing.source === 'agent-default') byId.set(model.id, model)
  }
  return Array.from(byId.values()).sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    return a.displayName.localeCompare(b.displayName)
  })
}

function providersForModels(
  models: PublicMessageModelOption[],
  connectedProviders: Set<string>,
): PublicMessageModelCatalog['providers'] {
  const byProvider = new Map<string, PublicMessageModelCatalog['providers'][number]>()
  for (const model of models) {
    const existing = byProvider.get(model.provider)
    byProvider.set(model.provider, {
      id: model.provider,
      label: model.providerLabel,
      configured: (existing?.configured ?? false) || model.configured,
      active: (existing?.active ?? false) || model.active,
      connected: connectedProviders.has(model.provider) || model.connected || existing?.connected,
    })
  }
  return Array.from(byProvider.values()).sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1
    if (a.active !== b.active) return a.active ? -1 : 1
    return a.label.localeCompare(b.label)
  })
}

function connectedModelOptions(
  connectedHermesProviders: Set<string>,
  currentModel: string,
): PublicMessageModelOption[] {
  const options: PublicMessageModelOption[] = []
  for (const def of listLlmProviders()) {
    if (!connectedHermesProviders.has(def.hermesProvider)) continue
    for (const modelId of def.curatedModels) {
      const id = cleanMessageModelId(modelId)
      if (!id) continue
      options.push({
        id,
        model: id,
        displayName: displayNameFromModelId(id),
        provider: def.hermesProvider,
        providerLabel: def.label,
        configured: true,
        active: id === currentModel,
        available: true,
        connected: true,
        source: 'connected',
      })
    }
  }
  return options
}

export function canSelectMessageModels(user: ApiUser): boolean {
  // Portal humans and agents may pick any model unlocked for the conversation runtime.
  return user.role === 'admin' || user.role === 'client' || user.role === 'ai'
}

export function selectConversationModelAgentId(conversation: Conversation, requestedAgentId?: unknown): AgentId | null {
  const requested = readString(requestedAgentId)
  if (requested && isValidAgentId(requested) && conversation.participantAgentIds.includes(requested)) {
    return requested
  }
  if (conversation.participantAgentIds.includes('pip')) return 'pip'
  return conversation.participantAgentIds[0] ?? null
}

function modelMatchesLivePrimary(
  model: PublicMessageModelOption,
  primaryModel?: string,
  primaryProvider?: string,
): boolean {
  if (!primaryModel) return false
  const leaf = model.id.split('/').pop() || model.id
  const primaryLeaf = primaryModel.split('/').pop() || primaryModel
  if (leaf !== primaryLeaf && model.id !== primaryModel && model.model !== primaryModel) return false
  if (!primaryProvider) return true
  return providersShareCredentialFamily(model.provider, primaryProvider)
}

function unavailableReasonForProvider(provider: string): string {
  return `No credentials configured for ${provider} on this agent runtime. Connect the provider in Settings or configure Hermes auth on the target machine.`
}

export async function getMessageModelCatalog(input: {
  conversation: Conversation
  user: ApiUser
  agentId?: unknown
}): Promise<PublicMessageModelCatalog> {
  const agentId = selectConversationModelAgentId(input.conversation, input.agentId)
  if (!agentId) {
    return {
      agentId: null,
      canSelect: false,
      models: [],
      providers: [],
      source: 'none',
      warning: 'This conversation has no agent participant.',
      selectableModelCount: 0,
    }
  }

  const agentSnap = await adminDb.collection('agent_team').doc(agentId).get()
  const agentData = agentSnap.exists ? agentSnap.data() as Partial<AgentTeamDoc> : null
  const registryDefaultModel = cleanMessageModelId(agentData?.defaultModel)
  const canSelect = canSelectMessageModels(input.user)
  const runtimeTarget = readString(input.conversation.workspaceContext?.runtimeTarget) || undefined

  let models: PublicMessageModelOption[] = []
  let source: PublicMessageModelCatalog['source'] = 'none'
  let warning: string | undefined
  let liveConfig: unknown = null
  let liveCatalogUnavailable = false

  const [modelsResult, configResult] = await Promise.all([
    callAgentPath(agentId, '/v1/models', { method: 'GET' }, { runtimeTarget })
      .then((result) => ({ ok: true as const, result }))
      .catch((error: unknown) => ({ ok: false as const, error })),
    callAgentPath(agentId, '/admin/config', {}, { runtimeTarget })
      .then((result) => ({ ok: true as const, result }))
      .catch((error: unknown) => ({ ok: false as const, error })),
  ])

  if (configResult.ok && configResult.result.response.ok) {
    liveConfig = configResult.result.data
  }

  const runtimeSummary = buildRuntimeModelSummary(
    { agentId, defaultModel: agentData?.defaultModel },
    liveConfig,
  )
  const configuredEntries = extractConfiguredRuntimeProviders(liveConfig)
  const hermesConfiguredProviders = Array.from(new Set(
    configuredEntries
      .map((entry) => normalizeProviderId(entry.provider))
      .filter(Boolean),
  ))

  if (modelsResult.ok && modelsResult.result.response.ok) {
    models = readModelEntries(modelsResult.result.data)
      .map((entry) => normalizeModelEntry(entry, ''))
      .filter(Boolean) as PublicMessageModelOption[]
    source = models.length > 0 ? 'hermes' : 'none'
  } else {
    liveCatalogUnavailable = true
    warning = modelsResult.ok
      ? `Hermes model catalogue returned ${modelsResult.result.response.status}`
      : 'Hermes model catalogue is unavailable; using the agent runtime default.'
  }

  const fallback = fallbackModelOption(agentData)
  if (fallback && !models.some((model) => model.id === fallback.id)) {
    models.unshift(fallback)
    if (source === 'none') source = 'agent-default'
  }

  const orgId = input.conversation.orgId || input.user.orgId || input.user.activeOrgId || ''
  const connectedHermesProviders = new Set<string>()
  const localOnlyProviderLabels: string[] = []
  const personalConnectedProviders = new Set<string>()
  if (orgId) {
    try {
      const connections = await listLlmProviderConnections({ orgId, uid: input.user.uid })
      const onUserComputer = await runtimeBelongsToUserComputer(input.user.uid, runtimeTarget)
      const onOrgVps = !onUserComputer && isOrgVpsConversationRuntime(runtimeTarget)
      const allowPersonalOnVps = memberMayUsePersonalLlmOnOrgVps(
        input.user.memberAccessPolicy,
        // ApiUser uses portal roles; owners are typically admin with full policy.
        null,
      )

      for (const c of connections) {
        if (c.status !== 'connected' || !c.hasCredentials) continue
        const hermesProvider = normalizeProviderId(
          c.hermesProvider || getLlmProvider(c.provider)?.hermesProvider || c.provider,
        )
        if (!hermesProvider) continue

        if (c.scope === 'org') {
          // Org credentials unlock Connected models on the organisation VPS.
          if (onOrgVps || !onUserComputer) {
            connectedHermesProviders.add(hermesProvider)
          }
          continue
        }

        // Personal credentials
        const def = getLlmProvider(c.provider)
        const label = def?.label || c.label || c.provider
        personalConnectedProviders.add(hermesProvider)

        if (onUserComputer) {
          connectedHermesProviders.add(hermesProvider)
        } else if (onOrgVps && allowPersonalOnVps) {
          // Eligible on VPS when Team access allows personal LLM credentials there.
          // Still mark localOnly=false so the picker treats them as Connected for this chat.
          connectedHermesProviders.add(hermesProvider)
        } else if (!localOnlyProviderLabels.includes(label)) {
          localOnlyProviderLabels.push(label)
        }
      }

      // Portal "Connected" is not enough for chat: Hermes must actually hold
      // usable OAuth tokens / keys on this conversation runtime.
      if (connectedHermesProviders.size > 0) {
        const runtimeAuth = await probeRuntimeOauthProviders(agentId, runtimeTarget)
        if (runtimeAuth.probed) {
          const blocked: string[] = []
          for (const provider of [...connectedHermesProviders]) {
            // Only OAuth families need nested-token proof; API-key families
            // stay unlocked via Hermes config / env.
            if (!isOauthHermesProvider(provider)) continue
            const status = runtimeAuth.byProvider.get(provider)
            const usable = status?.usable === true
              || [...expandProviderAliases([provider])].some((alias) => runtimeAuth.byProvider.get(alias)?.usable === true)
            if (!usable) {
              connectedHermesProviders.delete(provider)
              blocked.push(provider)
            }
          }
          if (blocked.length) {
            const blockedNote = `Portal credentials for ${blocked.join(', ')} are not usable on this machine yet (Hermes OAuth tokens missing or wrong shape). Re-sync from Settings → LLM providers after the runtime accepts the connection.`
            warning = warning ? `${warning} ${blockedNote}` : blockedNote
          }
        }
      }
    } catch {
      // Catalogue still works without connection enrichment.
    }
  }

  const usableProviders = expandProviderAliases([
    ...hermesConfiguredProviders,
    ...connectedHermesProviders,
  ])

  // Live Hermes primary is always usable even before /v1/models lists it.
  if (runtimeSummary.primaryProvider) {
    for (const alias of expandProviderAliases([runtimeSummary.primaryProvider])) {
      usableProviders.add(alias)
    }
  }

  const connectedExtras = connectedModelOptions(connectedHermesProviders, runtimeSummary.primaryModel || '')
  for (const extra of connectedExtras) {
    if (!models.some((model) => model.id === extra.id && model.provider === extra.provider)) {
      models.push(extra)
    }
  }
  if (liveCatalogUnavailable && connectedExtras.length > 0) {
    warning = 'Live model refresh is unavailable for the selected runtime; showing the supported catalogue for your connected providers.'
  }

  const autoModel = cleanMessageModelId(runtimeSummary.primaryModel) || registryDefaultModel || undefined
  const autoProvider = cleanMessageProviderId(runtimeSummary.primaryProvider)
    || (autoModel ? providerFromModelId(autoModel) : undefined)
    || undefined
  const autoLabel = runtimeSummary.source === 'live_config'
    ? (runtimeSummary.primaryProvider && runtimeSummary.primaryModel
      ? `${runtimeSummary.primaryProvider} · ${runtimeSummary.primaryModel}`
      : runtimeSummary.label)
    : (autoModel ? `Registry · ${autoModel}` : undefined)

  if (autoModel && !models.some((model) => modelMatchesLivePrimary(model, autoModel, autoProvider))) {
    models.unshift({
      id: autoModel,
      model: autoModel,
      displayName: displayNameFromModelId(autoModel),
      provider: autoProvider || providerFromModelId(autoModel),
      providerLabel: labelFromProvider(autoProvider || providerFromModelId(autoModel)),
      configured: true,
      active: true,
      available: true,
      source: runtimeSummary.source === 'live_config' ? 'hermes' : 'agent-default',
    })
    if (source === 'none') source = runtimeSummary.source === 'live_config' ? 'hermes' : 'agent-default'
  }

  const hasCredentialTruth = usableProviders.size > 0

  models = dedupeModels(models).map((model) => {
    const providerAliases = [...expandProviderAliases([model.provider])]
    const providerUsable = !hasCredentialTruth
      ? true
      : providerAliases.some((alias) => usableProviders.has(alias))
        || model.connected === true
        || model.source === 'connected'
    const hermesSaysUnavailable = model.available === false
    const available = !hermesSaysUnavailable && providerUsable
    const active = modelMatchesLivePrimary(model, autoModel, autoProvider)
    const unlockedViaConnection = providerAliases.some((alias) => connectedHermesProviders.has(alias))
    const isPersonalProvider = providerAliases.some((alias) => personalConnectedProviders.has(alias))
    return {
      ...model,
      active,
      available,
      configured: hasCredentialTruth ? (providerUsable || model.configured) : model.configured,
      connected: model.connected || unlockedViaConnection,
      localOnly: isPersonalProvider && !unlockedViaConnection,
      ...(available
        ? { reasonUnavailable: undefined }
        : {
          reasonUnavailable: model.reasonUnavailable || unavailableReasonForProvider(model.providerLabel || model.provider),
        }),
    }
  })

  // Prefer usable models first, then active, then name.
  models.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1
    if (a.active !== b.active) return a.active ? -1 : 1
    return a.displayName.localeCompare(b.displayName)
  })

  if (localOnlyProviderLabels.length) {
    const localNote = `Personal credentials (${localOnlyProviderLabels.join(', ')}) apply on your linked computers${memberMayUsePersonalLlmOnOrgVps(input.user.memberAccessPolicy, null) ? '' : ' only — ask an admin to enable them on the organisation VPS in Team access'}.`
    warning = warning ? `${warning} ${localNote}` : localNote
  }

  if (runtimeSummary.source === 'live_config' && runtimeSummary.staleRegistry) {
    const staleNote = `Agent registry still lists ${runtimeSummary.registryDefaultModel}; live Hermes Auto uses ${autoLabel}.`
    warning = warning ? `${warning} ${staleNote}` : staleNote
  }

  if (!hasCredentialTruth) {
    const credNote = 'Live Hermes provider config was unavailable, so model credentials could not be verified. Prefer Auto, or connect providers in Settings.'
    warning = warning ? `${warning} ${credNote}` : credNote
  } else if (connectedHermesProviders.size === 0 && hermesConfiguredProviders.length > 0) {
    const hermesNote = `PiB Settings has no portal connections; Auto still uses Hermes-native ${autoLabel || hermesConfiguredProviders.join(', ')} on this agent runtime.`
    warning = warning ? `${warning} ${hermesNote}` : hermesNote
  }

  const selectableModelCount = models.filter((model) => model.available).length
  const activeModel = models.find((model) => model.active && model.available)
    ?? models.find((model) => model.active)
    ?? models.find((model) => model.available)
    ?? models[0]

  return {
    agentId,
    canSelect,
    currentModel: autoModel || activeModel?.id,
    currentProvider: autoProvider || activeModel?.provider,
    ...(autoModel ? { autoModel } : {}),
    ...(autoProvider ? { autoProvider } : {}),
    ...(autoLabel ? { autoLabel } : {}),
    runtimeSource: runtimeSummary.source,
    models,
    providers: providersForModels(models, connectedHermesProviders),
    source,
    connectProvidersUrl: '/portal/settings/llm-providers',
    selectableModelCount,
    ...(hermesConfiguredProviders.length ? { hermesConfiguredProviders } : {}),
    ...(localOnlyProviderLabels.length ? { localOnlyProviderLabels } : {}),
    ...(warning ? { warning } : {}),
  }
}

export async function validateMessageModelSelection(input: {
  conversation: Conversation
  user: ApiUser
  agentId: AgentId | null
  model?: unknown
  provider?: unknown
}): Promise<MessageModelValidationResult> {
  const hasRequestedModel = input.model !== undefined && input.model !== null && input.model !== ''
  const hasRequestedProvider = input.provider !== undefined && input.provider !== null && input.provider !== ''
  const requestedModel = cleanMessageModelId(input.model)
  const requestedProvider = !hasRequestedProvider
    ? ''
    : cleanMessageProviderId(input.provider)

  if (hasRequestedModel && !requestedModel) return { ok: false, status: 400, error: 'Invalid model id.' }
  if (hasRequestedProvider && !requestedProvider) return { ok: false, status: 400, error: 'Invalid provider id.' }
  if (!requestedModel && !requestedProvider) return { ok: true, selection: undefined }
  if (!requestedModel) return { ok: false, status: 400, error: 'A model is required when selecting a provider.' }
  if (!input.agentId) return { ok: false, status: 400, error: 'Model selection requires an agent conversation.' }
  if (!canSelectMessageModels(input.user)) {
    return { ok: false, status: 403, error: 'Model selection is not available for this role.' }
  }

  const catalog = await getMessageModelCatalog({
    conversation: input.conversation,
    user: input.user,
    agentId: input.agentId,
  })
  const match = catalog.models.find((model) => {
    if (model.id !== requestedModel) return false
    if (!requestedProvider) return true
    return model.provider === requestedProvider
  })

  if (!match) {
    return { ok: false, status: 400, error: 'Selected model is not available for this agent runtime.', catalog }
  }
  if (!match.available) {
    return { ok: false, status: 400, error: match.reasonUnavailable || 'Selected model is unavailable for this agent runtime.', catalog }
  }

  return {
    ok: true,
    selection: {
      model: match.id,
      provider: requestedProvider || match.provider,
    },
    catalog,
  }
}
