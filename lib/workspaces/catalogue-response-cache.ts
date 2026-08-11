/**
 * Short process-local cache for GET /api/v1/workspaces.
 *
 * Healthy client refresh is 5 minutes; recovery is 60s. A 20s TTL collapses
 * multi-tab / multi-component bursts and concurrent agent catalogue hits on the
 * same warm instance without making online chips feel frozen.
 */

export const WORKSPACE_CATALOGUE_RESPONSE_CACHE_TTL_MS = 20_000

interface CatalogueCacheEntry<T> {
  expiresAt: number
  value: T
}

const cache = new Map<string, CatalogueCacheEntry<unknown>>()

export function workspaceCatalogueCacheKey(input: {
  orgId: string
  userId: string
  agentId: string
}): string {
  return `${input.orgId.trim()}::${input.userId.trim()}::${input.agentId.trim()}`
}

export function readWorkspaceCatalogueCache<T>(
  key: string,
  nowMs: number = Date.now(),
): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= nowMs) {
    cache.delete(key)
    return null
  }
  return entry.value as T
}

export function writeWorkspaceCatalogueCache<T>(
  key: string,
  value: T,
  options: { ttlMs?: number; nowMs?: number } = {},
): void {
  const ttlMs = options.ttlMs ?? WORKSPACE_CATALOGUE_RESPONSE_CACHE_TTL_MS
  const nowMs = options.nowMs ?? Date.now()
  cache.set(key, { expiresAt: nowMs + Math.max(0, ttlMs), value })
}

/** Test / ops helper — production routes never need this. */
export function clearWorkspaceCatalogueCache(): void {
  cache.clear()
}
