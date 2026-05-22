/**
 * Loads per-agent Hermes dispatch config from Firestore (agent_dispatch_configs/<agentId>).
 *
 * Doc shape (written by scripts/seed-agent-dispatch-configs.ts):
 *   {
 *     agentId: 'pip' | 'theo' | 'maya' | 'sage' | 'nora',
 *     baseUrl: string,          // e.g. https://hermes-api.partnersinbiz.online
 *     apiKey: string,           // bearer token Hermes will accept
 *     enabled: boolean,
 *     updatedAt: Timestamp,
 *     createdBy?: string,
 *   }
 *
 * 60-second in-memory TTL cache keyed by agentId.
 */
import { db } from './firestore'
import { logger } from './logger'

export const DEFAULT_AGENT_IDS = ['pip', 'theo', 'maya', 'sage', 'nora'] as const
export const AGENT_IDS = DEFAULT_AGENT_IDS
export type AgentId = string

export interface AgentConfig {
  baseUrl: string
  apiKey: string
  enabled: boolean
}

interface CacheEntry {
  value: AgentConfig | null
  expiresAt: number
}

const CACHE_TTL_MS = 60_000
const cache = new Map<string, CacheEntry>()
const AGENT_ID_RE = /^[a-z][a-z0-9._-]{1,39}$/

export function normalizeEnabledAgentIds(
  rows: Array<{ id: string; data?: Record<string, unknown> | null }>,
  fallback: readonly string[] = DEFAULT_AGENT_IDS,
): string[] {
  const ids = rows
    .filter((row) => row.data?.enabled !== false)
    .map((row) => {
      const raw = typeof row.data?.agentId === 'string' && row.data.agentId.trim()
        ? row.data.agentId.trim()
        : row.id
      return raw.trim()
    })
    .filter((agentId) => AGENT_ID_RE.test(agentId))

  const unique = Array.from(new Set(ids)).sort()
  return unique.length > 0 ? unique : [...fallback]
}

export async function loadEnabledAgentIds(): Promise<string[]> {
  try {
    const snap = await db.collection('agent_team').where('enabled', '==', true).get()
    const rows = snap.docs.map((doc) => ({
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    }))
    return normalizeEnabledAgentIds(rows)
  } catch (err) {
    logger.error('failed to load enabled agent ids from agent_team; using default core agents', {
      error: err instanceof Error ? err.message : String(err),
    })
    return [...DEFAULT_AGENT_IDS]
  }
}

export async function getAgentConfig(agentId: string): Promise<AgentConfig | null> {
  const now = Date.now()
  const cached = cache.get(agentId)
  if (cached && cached.expiresAt > now) {
    return cached.value
  }

  try {
    const snap = await db.collection('agent_dispatch_configs').doc(agentId).get()
    if (!snap.exists) {
      cache.set(agentId, { value: null, expiresAt: now + CACHE_TTL_MS })
      return null
    }
    const data = snap.data() ?? {}
    const baseUrl = typeof data.baseUrl === 'string' ? data.baseUrl.trim().replace(/\/+$/, '') : ''
    const apiKey = typeof data.apiKey === 'string' ? data.apiKey.trim() : ''
    const enabled = data.enabled !== false

    if (!baseUrl || !apiKey) {
      logger.warn('agent_dispatch_config missing baseUrl/apiKey', { agentId })
      cache.set(agentId, { value: null, expiresAt: now + CACHE_TTL_MS })
      return null
    }

    const value: AgentConfig = { baseUrl, apiKey, enabled }
    cache.set(agentId, { value, expiresAt: now + CACHE_TTL_MS })
    return value
  } catch (err) {
    logger.error('failed to load agent_dispatch_config', {
      agentId,
      error: err instanceof Error ? err.message : String(err),
    })
    // Don't poison the cache on transient errors — just return null.
    return null
  }
}

export function invalidateAgentConfigCache(agentId?: string): void {
  if (agentId) {
    cache.delete(agentId)
  } else {
    cache.clear()
  }
}
