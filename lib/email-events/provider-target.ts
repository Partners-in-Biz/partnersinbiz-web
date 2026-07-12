export interface ProviderEventTarget<T extends { orgId?: string }> { id: string; data: T }

/** Provider message ids must resolve to exactly one tenant-owned email row. */
export function resolveProviderEventTarget<T extends { orgId?: string }>(
  candidates: Array<ProviderEventTarget<T>>,
): ProviderEventTarget<T> | null {
  if (candidates.length === 0) return null
  if (candidates.length !== 1) throw new Error('Provider message id is ambiguous across email rows')
  const target = candidates[0]
  if (!target.data.orgId?.trim()) throw new Error('Provider event target has no tenant ownership')
  return target
}
