import { adminDb } from '@/lib/firebase/admin'
import { callAgentPath } from '@/lib/agents/team'
import {
  buildRuntimeModelSummary,
  extractConfiguredRuntimeProviders,
} from '@/lib/agents/runtime-config'
import { AGENT_IDS, isValidAgentId, type AgentId, type AgentTeamDoc } from '@/lib/agents/types'
import type { ApiUser } from '@/lib/api/types'
import type { Conversation } from '@/lib/conversations/types'
import { listLlmProviderConnections } from '@/lib/llm-providers/store'
import { getLlmProvider, listLlmProviders } from '@/lib/llm-providers/providers'
import {
  connectionCredentialVersion,
  listRuntimeLlmCredentialBindings,
} from '@/lib/llm-providers/bindings'
import {
  isOrgVpsConversationRuntime,
  resolveLlmCredentialRuntimeTarget,
  runtimeBelongsToUserComputer,
} from '@/lib/llm-providers/sync-targets'
import {
  expandProviderAliases,
  normalizeProviderId,
  providersShareCredentialFamily,
} from '@/lib/messages/model-provider-aliases'
import { buildDeepSeekUsageAdvisory, type DeepSeekUsageAdvisory } from '@/lib/llm-providers/deepseek-usage'

const SAFE_MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+~=-]{0,191}$/
const SAFE_PROVIDER_ID_RE = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/

type UnknownRecord = Record<string, unknown>

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
  connectionId?: string
  connectionLabel?: string
  credentialBindingId?: string
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
  /** Provider-specific usage tips (e.g. DeepSeek peak/off-peak) when those APIs are connected. */
  usageAdvisories?: DeepSeekUsageAdvisory[]
}

export interface ValidatedMessageModelSelection {
  model: string
  provider?: string
  llmConnectionId: string
  llmCredentialBindingId: string
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
    const key = `${model.connectionId || 'unbound'}:${model.provider}:${model.id}`
    const existing = byId.get(key)
    if (!existing || existing.source === 'agent-default') byId.set(key, model)
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

function normalizeAccountModelIds(modelIds: unknown, provider: string): string[] {
  const raw = Array.isArray(modelIds)
    ? modelIds.filter((value): value is string => typeof value === 'string')
    : []
  return raw.filter((modelId) => modelBelongsToCredentialProvider(modelId, provider))
}

function bindingUnavailableReason(input: {
  connectionLabel: string
  status?: string | null
  lastError?: string | null
}): string {
  const label = input.connectionLabel || 'This provider'
  const err = typeof input.lastError === 'string' ? input.lastError.trim() : ''
  if (err) {
    if (/active \/v1\/runs|restart deferred/i.test(err)) {
      return `${label} is connected, but live verify is waiting because this agent profile has an active run. Finish or idle the chat, Sync in Settings, then Refresh Models.`
    }
    return `${label} is connected, but this machine/agent is not live-verified yet: ${err.slice(0, 180)}`
  }
  if (input.status === 'delivering' || input.status === 'desired' || input.status === 'stored') {
    return `${label} is connected, but credentials are still syncing to this machine/agent (${input.status}). Wait for idle, Sync in Settings, then Refresh Models.`
  }
  if (input.status === 'failed') {
    return `${label} is connected, but the last live verify on this machine/agent failed. Sync again when the profile is idle, then Refresh Models.`
  }
  return `${label} is connected in Settings, but not live-verified on this machine and agent profile yet. Sync when idle, then Refresh Models.`
}

/** Ready (selectable) + pending (visible Needs credentials) rows for PiB-connected accounts. */
export function connectedModelOptions(
  accounts: Array<{
    connectionId: string
    connectionLabel: string
    credentialBindingId?: string
    provider: string
    modelIds?: string[] | null
    available?: boolean
    reasonUnavailable?: string
  }>,
  currentModel: string,
): PublicMessageModelOption[] {
  const options: PublicMessageModelOption[] = []
  for (const account of accounts) {
    const def = listLlmProviders().find((candidate) => candidate.hermesProvider === account.provider)
      || listLlmProviders().find((candidate) => candidate.key === account.provider)
    if (!def) continue
    // `/v1/models` is a machine-wide Hermes catalogue, not proof that every
    // connected account can authenticate every listed provider. Start with
    // the maintained provider catalogue, then add only discovered ids that
    // belong to this credential family.
    const discovered = normalizeAccountModelIds(account.modelIds, account.provider)
    const modelIds = [...new Set([...def.curatedModels, ...discovered])]
    const available = account.available !== false
    for (const modelId of modelIds) {
      const id = cleanMessageModelId(modelId)
      if (!id) continue
      options.push({
        id,
        model: id,
        displayName: displayNameFromModelId(id),
        provider: account.provider,
        providerLabel: `${def.label} · ${account.connectionLabel}`,
        configured: true,
        active: id === currentModel,
        available,
        connected: available,
        connectionId: account.connectionId,
        connectionLabel: account.connectionLabel,
        ...(account.credentialBindingId ? { credentialBindingId: account.credentialBindingId } : {}),
        source: 'connected',
        ...(!available && account.reasonUnavailable
          ? { reasonUnavailable: account.reasonUnavailable }
          : {}),
      })
    }
  }
  return options
}

function modelBelongsToCredentialProvider(modelId: string, provider: string): boolean {
  const id = cleanMessageModelId(modelId).toLowerCase()
  if (!id || AGENT_IDS.includes(id)) return false
  const normalized = normalizeProviderId(provider)
  if (normalized === 'xai' || normalized === 'xai-oauth') {
    return id.startsWith('grok-') || id.startsWith('x-ai/') || id.startsWith('xai/')
  }
  if (normalized === 'openai-codex' || normalized === 'openai-api') {
    return /^(gpt-|o[134]-|openai\/)/.test(id)
  }
  if (normalized === 'anthropic') {
    return id.startsWith('claude-') || id.startsWith('anthropic/')
  }
  if (normalized === 'gemini') {
    return id.startsWith('gemini-') || id.startsWith('google/')
  }
  if (normalized === 'deepseek') {
    return id.startsWith('deepseek') || id.startsWith('deepseek/')
  }
  if (normalized === 'copilot') {
    return /^(gpt-|o[134]-|claude-|openai\/|anthropic\/)/.test(id)
  }
  // Aggregators intentionally span provider families; their live catalogue
  // may be broader than the maintained fallback list.
  if (normalized === 'openrouter' || normalized === 'nous') return true
  return false
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
  const readyAccounts: Array<{
    connectionId: string
    connectionLabel: string
    credentialBindingId?: string
    provider: string
    modelIds?: string[] | null
    available?: boolean
    reasonUnavailable?: string
  }> = []
  const pendingAccounts: Array<{
    connectionId: string
    connectionLabel: string
    credentialBindingId?: string
    provider: string
    modelIds?: string[] | null
    available?: boolean
    reasonUnavailable?: string
  }> = []
  const localOnlyProviderLabels: string[] = []
  const personalConnectedProviders = new Set<string>()
  let deepseekConnected = false
  if (orgId) {
    try {
      const connections = await listLlmProviderConnections({ orgId, uid: input.user.uid })
      const credentialTarget = await resolveLlmCredentialRuntimeTarget({
        runtimeTargetId: runtimeTarget,
        orgId,
        ownerUid: input.user.uid,
        agentId,
      })
      const onUserComputer = credentialTarget.ownerType === 'user'
        || await runtimeBelongsToUserComputer(input.user.uid, runtimeTarget)
      const onOrgVps = !onUserComputer && isOrgVpsConversationRuntime(runtimeTarget)
      const eligibleConnections = connections.filter((c) => {
        if (c.status !== 'connected' || !c.hasCredentials) return false
        if (onUserComputer) return c.scope === 'user' && c.ownerUid === input.user.uid
        return c.scope === 'org' && (onOrgVps || !onUserComputer)
      })
      const bindings = await listRuntimeLlmCredentialBindings({
        runtimeTargetId: credentialTarget.runtimeTargetId,
        agentId,
        connectionIds: eligibleConnections.map((connection) => connection.id),
      })
      const bindingByConnection = new Map(bindings.map((binding) => [binding.connectionId, binding]))
      const eligibleIds = new Set(eligibleConnections.map((connection) => connection.id))

      for (const c of connections) {
        const hermesProvider = normalizeProviderId(
          c.hermesProvider || getLlmProvider(c.provider)?.hermesProvider || c.provider,
        )
        if (!hermesProvider) continue
        const def = getLlmProvider(c.provider)
        const label = def?.label || c.label || c.provider
        if (c.scope === 'user') personalConnectedProviders.add(hermesProvider)
        if (
          c.status === 'connected'
          && c.hasCredentials
          && (hermesProvider === 'deepseek' || c.provider === 'deepseek')
          && (c.scope === 'org' || (c.scope === 'user' && c.ownerUid === input.user.uid))
        ) {
          deepseekConnected = true
        }
        const binding = bindingByConnection.get(c.id)
        const bindingReady = binding?.status === 'ready'
          && binding.liveAuthVerified === true
          && binding.credentialVersion === connectionCredentialVersion(c)
        const discoveredFromConnection = Array.isArray((c as { meta?: { discoveredModels?: unknown } }).meta?.discoveredModels)
          ? ((c as { meta?: { discoveredModels?: unknown } }).meta?.discoveredModels as unknown[])
          : []
        const modelIds = [
          ...(Array.isArray(binding?.verifiedModelIds) ? binding!.verifiedModelIds : []),
          ...discoveredFromConnection.filter((value): value is string => typeof value === 'string'),
        ]
        if (bindingReady && binding) {
          connectedHermesProviders.add(hermesProvider)
          readyAccounts.push({
            connectionId: c.id,
            connectionLabel: c.label || label,
            credentialBindingId: binding.id,
            provider: hermesProvider,
            modelIds,
            available: true,
          })
        } else if (eligibleIds.has(c.id)) {
          // Connection is in-scope for this chat runtime but not live-ready yet.
          // Still surface curated models so the picker shows the provider (Needs credentials)
          // instead of disappearing entirely (DeepSeek/BYOK when Hermes /v1/models omits them).
          pendingAccounts.push({
            connectionId: c.id,
            connectionLabel: c.label || label,
            ...(binding?.id ? { credentialBindingId: binding.id } : {}),
            provider: hermesProvider,
            modelIds,
            available: false,
            reasonUnavailable: bindingUnavailableReason({
              connectionLabel: c.label || label,
              status: binding?.status,
              lastError: binding?.lastError,
            }),
          })
        } else if (c.scope === 'user' && !onUserComputer && !localOnlyProviderLabels.includes(label)) {
          localOnlyProviderLabels.push(label)
        }
      }
    } catch {
      // Catalogue still works without connection enrichment.
    }
  }

  const usableProviders = expandProviderAliases([...connectedHermesProviders])

  const connectedExtras = connectedModelOptions(
    [...readyAccounts, ...pendingAccounts],
    runtimeSummary.primaryModel || '',
  )
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

  const unboundModels = models.filter((model) => !connectedExtras.some((extra) =>
    extra.id === model.id && providersShareCredentialFamily(extra.provider, model.provider),
  ))
  models = dedupeModels([...connectedExtras, ...unboundModels]).map((model) => {
    const providerAliases = [...expandProviderAliases([model.provider])]
    const providerUsable = !hasCredentialTruth
      ? false
      : providerAliases.some((alias) => usableProviders.has(alias))
        || model.connected === true
        || model.source === 'connected'
    const hermesSaysUnavailable = model.available === false
    const available = !hermesSaysUnavailable && providerUsable
    const active = modelMatchesLivePrimary(model, autoModel, autoProvider)
    const unlockedViaConnection = providerAliases.some((alias) => connectedHermesProviders.has(alias))
    const isPersonalProvider = providerAliases.some((alias) => personalConnectedProviders.has(alias))
    const matchingAccount = model.connectionId
      ? readyAccounts.find((account) => account.connectionId === model.connectionId)
      : readyAccounts.find((account) => providersShareCredentialFamily(account.provider, model.provider))
    return {
      ...model,
      ...(matchingAccount ? {
        connectionId: matchingAccount.connectionId,
        connectionLabel: matchingAccount.connectionLabel,
        credentialBindingId: matchingAccount.credentialBindingId,
        providerLabel: `${labelFromProvider(model.provider)} · ${matchingAccount.connectionLabel}`,
      } : {}),
      active,
      available: available && Boolean(matchingAccount),
      configured: hasCredentialTruth ? (providerUsable || model.configured) : model.configured,
      connected: model.connected || unlockedViaConnection,
      localOnly: isPersonalProvider && !unlockedViaConnection,
      ...(available && matchingAccount
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
    const localNote = `Personal credentials (${localOnlyProviderLabels.join(', ')}) apply on computers owned by your account only. Shared VPS chats use organisation accounts.`
    warning = warning ? `${warning} ${localNote}` : localNote
  }

  if (runtimeSummary.source === 'live_config' && runtimeSummary.staleRegistry) {
    const staleNote = `Agent registry still lists ${runtimeSummary.registryDefaultModel}; live Hermes Auto uses ${autoLabel}.`
    warning = warning ? `${warning} ${staleNote}` : staleNote
  }

  if (!hasCredentialTruth) {
    const credNote = 'No account has passed live authentication on this machine and agent profile. Explicit model selection is locked until you sync a provider in Settings; Auto may still use the runtime-managed default.'
    warning = warning ? `${warning} ${credNote}` : credNote
  } else if (connectedHermesProviders.size === 0 && hermesConfiguredProviders.length > 0) {
    const hermesNote = `Hermes reports ${autoLabel || hermesConfiguredProviders.join(', ')}, but PiB will not dispatch until an account is synced and live-verified for this machine and profile.`
    warning = warning ? `${warning} ${hermesNote}` : hermesNote
  }

  const selectableModelCount = models.filter((model) => model.available).length
  const activeModel = models.find((model) => model.active && model.available)
    ?? models.find((model) => model.active)
    ?? models.find((model) => model.available)
    ?? models[0]
  const usageAdvisories = deepseekConnected || connectedHermesProviders.has('deepseek')
    ? [buildDeepSeekUsageAdvisory()]
    : undefined

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
    ...(usageAdvisories ? { usageAdvisories } : {}),
    ...(warning ? { warning } : {}),
  }
}

export async function validateMessageModelSelection(input: {
  conversation: Conversation
  user: ApiUser
  agentId: AgentId | null
  model?: unknown
  provider?: unknown
  connectionId?: unknown
  credentialBindingId?: unknown
}): Promise<MessageModelValidationResult> {
  const hasRequestedModel = input.model !== undefined && input.model !== null && input.model !== ''
  const hasRequestedProvider = input.provider !== undefined && input.provider !== null && input.provider !== ''
  const requestedModel = cleanMessageModelId(input.model)
  const requestedProvider = !hasRequestedProvider
    ? ''
    : cleanMessageProviderId(input.provider)
  const requestedConnectionId = readString(input.connectionId)
  const requestedBindingId = readString(input.credentialBindingId)

  if (hasRequestedModel && !requestedModel) return { ok: false, status: 400, error: 'Invalid model id.' }
  if (hasRequestedProvider && !requestedProvider) return { ok: false, status: 400, error: 'Invalid provider id.' }
  if (requestedModel && (!requestedConnectionId || !requestedBindingId)) {
    return {
      ok: false,
      status: 400,
      error: 'An exact connected account and machine binding are required for model selection.',
    }
  }
  if (!input.agentId) return { ok: false, status: 400, error: 'Model selection requires an agent conversation.' }
  if (!canSelectMessageModels(input.user)) {
    return { ok: false, status: 403, error: 'Model selection is not available for this role.' }
  }

  const catalog = await getMessageModelCatalog({
    conversation: input.conversation,
    user: input.user,
    agentId: input.agentId,
  })
  const match = requestedModel
    ? catalog.models.find((model) => {
        if (model.id !== requestedModel) return false
        if (requestedProvider && model.provider !== requestedProvider) return false
        if (requestedConnectionId && model.connectionId !== requestedConnectionId) return false
        if (requestedBindingId && model.credentialBindingId !== requestedBindingId) return false
        return true
      })
    : catalog.models.find((model) => model.active && model.available && model.connectionId && model.credentialBindingId)
      ?? catalog.models.find((model) => model.available && model.connectionId && model.credentialBindingId)

  if (!match) {
    return { ok: false, status: 400, error: 'Selected model is not available for this agent runtime.', catalog }
  }
  if (!match.available) {
    return { ok: false, status: 400, error: match.reasonUnavailable || 'Selected model is unavailable for this agent runtime.', catalog }
  }
  if (!match.connectionId || !match.credentialBindingId) {
    return {
      ok: false,
      status: 409,
      error: 'The selected account is not live-verified on this machine and agent profile. Sync it in Settings and retry.',
      catalog,
    }
  }

  return {
    ok: true,
    selection: {
      model: match.id,
      provider: requestedProvider || match.provider,
      llmConnectionId: match.connectionId,
      llmCredentialBindingId: match.credentialBindingId,
    },
    catalog,
  }
}
