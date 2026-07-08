import { adminDb } from '@/lib/firebase/admin'
import { callAgentPath } from '@/lib/agents/team'
import { isValidAgentId, type AgentId, type AgentTeamDoc } from '@/lib/agents/types'
import type { ApiUser } from '@/lib/api/types'
import type { Conversation } from '@/lib/conversations/types'

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
  source: 'hermes' | 'agent-default'
  supportsThinking?: boolean
  supportsVision?: boolean
  supportsTools?: boolean
  reasonUnavailable?: string
}

export interface PublicMessageModelCatalog {
  agentId: AgentId | null
  canSelect: boolean
  currentModel?: string
  currentProvider?: string
  models: PublicMessageModelOption[]
  providers: Array<{ id: string; label: string; configured: boolean; active: boolean }>
  source: 'hermes' | 'agent-default' | 'none'
  warning?: string
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

function providersForModels(models: PublicMessageModelOption[]): PublicMessageModelCatalog['providers'] {
  const byProvider = new Map<string, PublicMessageModelCatalog['providers'][number]>()
  for (const model of models) {
    const existing = byProvider.get(model.provider)
    byProvider.set(model.provider, {
      id: model.provider,
      label: model.providerLabel,
      configured: (existing?.configured ?? false) || model.configured,
      active: (existing?.active ?? false) || model.active,
    })
  }
  return Array.from(byProvider.values()).sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    return a.label.localeCompare(b.label)
  })
}

export function canSelectMessageModels(user: ApiUser): boolean {
  return user.role === 'admin' || user.role === 'ai'
}

export function selectConversationModelAgentId(conversation: Conversation, requestedAgentId?: unknown): AgentId | null {
  const requested = readString(requestedAgentId)
  if (requested && isValidAgentId(requested) && conversation.participantAgentIds.includes(requested)) {
    return requested
  }
  if (conversation.participantAgentIds.includes('pip')) return 'pip'
  return conversation.participantAgentIds[0] ?? null
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
    }
  }

  const agentSnap = await adminDb.collection('agent_team').doc(agentId).get()
  const agentData = agentSnap.exists ? agentSnap.data() as Partial<AgentTeamDoc> : null
  const currentModel = cleanMessageModelId(agentData?.defaultModel)
  const canSelect = canSelectMessageModels(input.user)

  let models: PublicMessageModelOption[] = []
  let source: PublicMessageModelCatalog['source'] = 'none'
  let warning: string | undefined

  try {
    const upstream = await callAgentPath(agentId, '/v1/models', { method: 'GET' })
    if (upstream.response.ok) {
      models = readModelEntries(upstream.data)
        .map((entry) => normalizeModelEntry(entry, currentModel))
        .filter(Boolean) as PublicMessageModelOption[]
      source = models.length > 0 ? 'hermes' : 'none'
    } else {
      warning = `Hermes model catalogue returned ${upstream.response.status}`
    }
  } catch {
    warning = 'Hermes model catalogue is unavailable; using the agent default model.'
  }

  const fallback = fallbackModelOption(agentData)
  if (fallback && !models.some((model) => model.id === fallback.id)) {
    models.unshift(fallback)
    if (source === 'none') source = 'agent-default'
  }

  models = dedupeModels(models).map((model) => ({
    ...model,
    active: currentModel ? model.id === currentModel : model.active,
  }))

  const activeModel = models.find((model) => model.active) ?? models[0]
  return {
    agentId,
    canSelect,
    currentModel: activeModel?.id,
    currentProvider: activeModel?.provider,
    models,
    providers: providersForModels(models),
    source,
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
