/**
 * Pick the default computer for a new Workspace / Company Cowork session.
 * Honours the org workspace defaultRuntimeTarget when possible, then VPS,
 * then any selectable machine (so Mac remains available as an explicit choice).
 */

export type PreferredRuntimeCandidate = {
  id: string
  legacyRuntimeTargetIds?: string[]
  selectable: boolean
  isLocal?: boolean
  kind?: string
  deviceKind?: string
}

function isVpsRuntime(runtime: PreferredRuntimeCandidate): boolean {
  if (runtime.deviceKind === 'vps' || runtime.kind === 'vps') return true
  if (runtime.id === 'vps' || runtime.id.includes('vps')) return true
  if (runtime.isLocal === false) return true
  return false
}

export function runtimeMatchesPreferredTarget(
  runtime: PreferredRuntimeCandidate,
  preferredTargetId: string,
): boolean {
  const preferred = preferredTargetId.trim()
  if (!preferred) return false
  if (runtime.id === preferred) return true
  if (runtime.legacyRuntimeTargetIds?.includes(preferred)) return true
  // Legacy shorthand used in workspace docs: "vps" / "local".
  if (preferred === 'vps' && isVpsRuntime(runtime)) return true
  if (preferred === 'local' && runtime.isLocal === true) return true
  return false
}

export function pickPreferredWorkspaceRuntime<T extends PreferredRuntimeCandidate>(
  runtimes: T[],
  options?: { preferredTargetId?: string | null },
): T | null {
  const selectable = runtimes.filter((runtime) => runtime.selectable)
  if (selectable.length === 0) return null

  const preferredTargetId = options?.preferredTargetId?.trim()
  if (preferredTargetId) {
    const matched = selectable.find((runtime) => runtimeMatchesPreferredTarget(runtime, preferredTargetId))
    if (matched) return matched
  }

  const vps = selectable.find((runtime) => isVpsRuntime(runtime))
  if (vps) return vps

  return selectable[0] ?? null
}
