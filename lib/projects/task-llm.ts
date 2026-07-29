/**
 * Resolve which LLM credentials a project task should use at dispatch time.
 * - org: shared organisation Hermes credentials on the watcher runtime
 * - personal: unsupported on the shared watcher runtime; safely falls back to org
 * - auto: organisation credentials on the shared watcher runtime
 */
import { listLlmProviderConnections } from '@/lib/llm-providers/store'
import { getLlmProvider, listLlmProviders } from '@/lib/llm-providers/providers'
import { syncLlmConnectionToHermes } from '@/lib/llm-providers/sync-hermes'
import type { MemberAccessPolicy } from '@/lib/orgMembers/access-policy'
import { normalizeProviderId, providersShareCredentialFamily } from '@/lib/messages/model-provider-aliases'

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

export async function resolveTaskLlmCredentials(input: {
  orgId: string
  ownerUid: string
  requestedSource?: unknown
  requestedProvider?: unknown
  agentModel?: string | null
  /** Preloaded member access policy from ApiUser when available. */
  memberAccessPolicy?: MemberAccessPolicy | null
}): Promise<TaskLlmResolution> {
  const requestedSource = cleanTaskLlmCredentialSource(input.requestedSource) ?? 'auto'
  const requestedProvider = cleanTaskAgentProvider(input.requestedProvider)
  const inferredProvider = inferHermesProviderFromModel(input.agentModel)
  const desiredProvider = requestedProvider || inferredProvider

  const connections = await listLlmProviderConnections({ orgId: input.orgId, uid: input.ownerUid })
  const org = connections.filter((c) => c.scope === 'org' && c.status === 'connected' && c.hasCredentials)

  const matchingOrg = desiredProvider
    ? org.find((c) => providersShareCredentialFamily(
      c.hermesProvider || getLlmProvider(c.provider)?.hermesProvider,
      desiredProvider,
    ))
    : org[0]

  if (requestedSource === 'org') {
    return {
      llmCredentialSource: 'org',
      resolvedSource: 'org',
      agentProvider: desiredProvider
        || (matchingOrg ? normalizeProviderId(matchingOrg.hermesProvider || matchingOrg.provider) : null)
        || null,
      llmCredentialOwnerUid: input.ownerUid,
      personalConnectionId: null,
    }
  }

  if (requestedSource === 'personal') {
    return {
      llmCredentialSource: 'personal',
      resolvedSource: 'org',
      agentProvider: desiredProvider
        || (matchingOrg ? normalizeProviderId(matchingOrg.hermesProvider || matchingOrg.provider) : null)
        || null,
      llmCredentialOwnerUid: input.ownerUid,
      personalConnectionId: null,
      warning: 'Project watchers run on the shared organisation runtime, so personal credentials are not copied there. Using organisation credentials.',
    }
  }

  return {
    llmCredentialSource: 'auto',
    resolvedSource: 'org',
    agentProvider: desiredProvider
      || (matchingOrg ? normalizeProviderId(matchingOrg.hermesProvider || matchingOrg.provider) : null)
      || null,
    llmCredentialOwnerUid: input.ownerUid,
    personalConnectionId: null,
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
