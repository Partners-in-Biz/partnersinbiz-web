import type { CredentialPool, CredentialPoolKey } from './types'

export function createCredentialPool(input: {
  orgId: string
  provider: string
  keys: Array<{ id: string; label: string; fingerprint: string; priority?: number }>
}): CredentialPool {
  if (!input.provider.trim()) throw new Error('Provider is required')
  if (!input.keys.length) throw new Error('At least one credential key is required')
  return {
    orgId: input.orgId,
    provider: input.provider.trim(),
    keys: input.keys.map((k, i) => ({
      id: k.id,
      label: k.label,
      fingerprint: k.fingerprint,
      lastStatus: 'unknown' as const,
      priority: k.priority ?? i,
    })),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Pick next key after rate-limit/failure rotation.
 * Prefers ok/unknown with lowest priority number; skips currently failed/rate_limited when alternatives exist.
 */
export function selectCredentialKey(
  pool: CredentialPool,
  options: { preferFreshAfter?: string; forceRotateFrom?: string } = {},
): CredentialPoolKey | null {
  if (pool.keys.length === 0) return null
  const sorted = [...pool.keys].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))

  if (options.forceRotateFrom) {
    const idx = sorted.findIndex((k) => k.id === options.forceRotateFrom)
    if (idx >= 0) {
      const rotated = [...sorted.slice(idx + 1), ...sorted.slice(0, idx)]
      const healthy = rotated.find((k) => k.lastStatus === 'ok' || k.lastStatus === 'unknown')
      if (healthy) return healthy
      return rotated[0] || null
    }
  }

  const healthy = sorted.find((k) => k.lastStatus === 'ok' || k.lastStatus === 'unknown')
  if (healthy) return healthy
  return sorted[0] || null
}

export function markCredentialStatus(
  pool: CredentialPool,
  keyId: string,
  status: CredentialPoolKey['lastStatus'],
): CredentialPool {
  return {
    ...pool,
    keys: pool.keys.map((k) => (k.id === keyId ? { ...k, lastStatus: status } : k)),
    updatedAt: new Date().toISOString(),
  }
}
