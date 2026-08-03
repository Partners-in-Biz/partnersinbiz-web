/**
 * Resolve which LLM credentials a project task should use at dispatch time.
 * Credentials follow the task's execution machine:
 * - organisation VPS → organisation account
 * - member-owned linked computer → that member's personal account
 */
import { listLlmProviderConnections } from '@/lib/llm-providers/store'
import { getLlmProvider, listLlmProviders } from '@/lib/llm-providers/providers'
import { syncLlmConnectionToHermes } from '@/lib/llm-providers/sync-hermes'
import type { MemberAccessPolicy } from '@/lib/orgMembers/access-policy'
import { normalizeProviderId, providersShareCredentialFamily } from '@/lib/messages/model-provider-aliases'
import { SYSTEM_DEFAULT_PRIMARY_PROVIDER } from '@/lib/agents/default-runtime-model'

export const VALID_LLM_CREDENTIAL_SOURCES = ['auto', 'org', 'personal'] as const
export type TaskLlmCredentialSource = (typeof VALID_LLM_CREDENTIAL_SOURCES)[number]

export const TASK_LLM_PROVIDER_RE = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/

export type TaskLlmResolution = {
  llmCredentialSource: TaskLlmCredentialSource
  /** Effective source after auto-resolution. */
  resolvedSource: 'org' | 'personal'
  agentProvider: string | null
  llmCredentialOwnerUid: string | null
  /** Connection id to sync when personal credentials are required. */
  personalConnectionId: string | null
  connectionId: string | null
  warning?: string
}

export function cleanTaskLlmCredentialSource(value: unknown): TaskLlmCredentialSource | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return null
  const cleaned = value.trim().toLowerCase()
  return VALID_LLM_CREDENTIAL_SOURCES.includes(cleaned as TaskLlmCredentialSource)
    ? cleaned as TaskLlmCredentialSource
    : null
}

export function cleanTaskAgentProvider(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  if (!TASK_LLM_PROVIDER_RE.test(cleaned)) return null
  return normalizeProviderId(cleaned) || cleaned
}

export function inferHermesProviderFromModel(model: string | null | undefined): string | null {
  if (!model) return null
  const leaf = model.split('/').pop() || model
  const lower = leaf.toLowerCase()
  if (lower.startsWith('claude')) return 'anthropic'
  if (lower.startsWith('grok')) return 'xai-oauth'
  if (lower.startsWith('gpt') || lower.includes('codex')) return 'openai-codex'
  if (lower.startsWith('gemini')) return 'gemini'
  if (lower.startsWith('deepseek')) return 'deepseek'
  const prefix = model.includes('/') ? model.split('/')[0] : ''
  return normalizeProviderId(prefix) || null
}

/** Curated Hermes providers shown in Kanban credential UI. */
export function taskLlmProviderOptions(): Array<{ value: string; label: string }> {
  return listLlmProviders().map((provider) => ({
    value: provider.hermesProvider,
    label: provider.label,
  }))
}

function connectionProviderId(connection: { hermesProvider?: string | null; provider?: string | null }): string | null {
  return normalizeProviderId(connection.hermesProvider || connection.provider || '') || null
}

function pickPreferredConnection<T extends { hermesProvider?: string | null; provider?: string | null }>(
  connections: T[],
  desiredProvider: string | null,
): T | undefined {
  if (!connections.length) return undefined
  if (desiredProvider) {
    return connections.find((c) => providersShareCredentialFamily(
      c.hermesProvider || getLlmProvider(c.provider || '')?.hermesProvider,
      desiredProvider,
    ))
  }
  // Auto with no explicit model/provider must follow the system primary (SuperGrok),
  // not whichever connected account happens to sort first (often Codex).
  const systemPrimary = connections.find((c) => providersShareCredentialFamily(
    c.hermesProvider || getLlmProvider(c.provider || '')?.hermesProvider,
    SYSTEM_DEFAULT_PRIMARY_PROVIDER,
  ))
  return systemPrimary || connections[0]
}

export async function resolveTaskLlmCredentials(input: {
  orgId: string
  ownerUid: string
  requestedSource?: unknown
  requestedProvider?: unknown
  agentModel?: string | null
  /** Preloaded member access policy from ApiUser when available. */
  memberAccessPolicy?: MemberAccessPolicy | null
  runtimeTargetId?: string | null
}): Promise<TaskLlmResolution> {
  const requestedSource = cleanTaskLlmCredentialSource(input.requestedSource) ?? 'auto'
  const requestedProvider = cleanTaskAgentProvider(input.requestedProvider)
  const inferredProvider = inferHermesProviderFromModel(input.agentModel)
  // Prefer explicit request, then model inference, then system Auto primary (xai-oauth/grok).
  // Never leave desiredProvider empty when SuperGrok is the platform default — that used to
  // stamp openai-codex from the first personal connection and break profile-default grok runs.
  const desiredProvider = requestedProvider
    || inferredProvider
    || SYSTEM_DEFAULT_PRIMARY_PROVIDER

  const connections = await listLlmProviderConnections({ orgId: input.orgId, uid: input.ownerUid })
  const org = connections.filter((c) => c.scope === 'org' && c.status === 'connected' && c.hasCredentials)
  const personal = connections.filter((c) => c.scope === 'user'
    && c.ownerUid === input.ownerUid
    && c.status === 'connected'
    && c.hasCredentials)

  const matchingOrg = pickPreferredConnection(org, desiredProvider)
  const matchingPersonal = pickPreferredConnection(personal, desiredProvider)
  const runtimeIsPersonal = Boolean(input.runtimeTargetId
    && !['vps', 'auto'].includes(input.runtimeTargetId.trim().toLowerCase()))

  if (requestedSource === 'org') {
    return {
      llmCredentialSource: 'org',
      resolvedSource: 'org',
      agentProvider: desiredProvider
        || (matchingOrg ? connectionProviderId(matchingOrg) : null)
        || null,
      llmCredentialOwnerUid: input.ownerUid,
      personalConnectionId: null,
      connectionId: matchingOrg?.id ?? null,
    }
  }

  if (requestedSource === 'personal') {
    return {
      llmCredentialSource: 'personal',
      resolvedSource: 'personal',
      agentProvider: desiredProvider
        || (matchingPersonal ? connectionProviderId(matchingPersonal) : null)
        || null,
      llmCredentialOwnerUid: input.ownerUid,
      personalConnectionId: matchingPersonal?.id ?? null,
      connectionId: matchingPersonal?.id ?? null,
      ...(!matchingPersonal ? { warning: 'No matching personal LLM account is connected yet.' } : {}),
    }
  }

  if ((runtimeIsPersonal && matchingPersonal) || (!matchingOrg && matchingPersonal)) {
    return {
      llmCredentialSource: 'auto',
      resolvedSource: 'personal',
      agentProvider: desiredProvider
        || connectionProviderId(matchingPersonal)
        || null,
      llmCredentialOwnerUid: input.ownerUid,
      personalConnectionId: matchingPersonal.id,
      connectionId: matchingPersonal.id,
    }
  }

  return {
    llmCredentialSource: 'auto',
    resolvedSource: 'org',
    agentProvider: desiredProvider
      || (matchingOrg ? connectionProviderId(matchingOrg) : null)
      || null,
    llmCredentialOwnerUid: input.ownerUid,
    personalConnectionId: null,
    connectionId: matchingOrg?.id ?? null,
  }
}

/** Best-effort sync of the owner's personal connection before a watcher run. */
export async function ensurePersonalTaskCredentialsSynced(connectionId: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const sync = await syncLlmConnectionToHermes(connectionId)
    if (sync.failed.length && !sync.synced.length) {
      return { ok: false, message: sync.failed[0]?.error || sync.message || 'Personal credential sync failed' }
    }
    return { ok: true, message: sync.message }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Personal credential sync failed' }
  }
}
