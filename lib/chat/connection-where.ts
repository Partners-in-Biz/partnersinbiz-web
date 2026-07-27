/**
 * Human-readable "where is this chat running?" summary for Messages.
 *
 * Inventory is org-dynamic: an organisation may link only computers, only a
 * VPS, several of either, or a mix. Never assume Partners-style dual inventory
 * (canonical VPS + Peet's Mac). Prefer live presence + workspace context +
 * last-run dispatch metadata, using structured kind fields — not label text.
 */

export type ConnectionWhereKind = 'VPS' | 'Computer' | 'Local' | 'Remote'

export type ConnectionWhere = {
  kind: ConnectionWhereKind
  /** Operator-facing machine name from the org's linked inventory. */
  label: string
  /** Optional folder / mapping name on that machine. */
  mappingLabel?: string
  /** Single-line chip text, e.g. "Computer · Studio Mini" or "VPS · acme-edge". */
  display: string
  online: boolean | null
  title: string
  icon: 'dns' | 'computer' | 'hard_drive' | 'cloud'
}

export type ConnectionWhereInput = {
  runtimeKind?: string | null
  machineLabel?: string | null
  runtimeTarget?: string | null
  runtimeLabel?: string | null
  mappingLabel?: string | null
  deviceKind?: string | null
  isLocal?: boolean | null
  online?: boolean | null
  locationLabel?: string | null
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Classify from structured runtime fields only.
 * Do not infer kind from free-text labels (orgs name machines anything).
 */
function resolveKind(input: ConnectionWhereInput): ConnectionWhereKind {
  const deviceKind = clean(input.deviceKind).toLowerCase()
  const runtimeKind = clean(input.runtimeKind).toLowerCase()
  const runtimeTarget = clean(input.runtimeTarget).toLowerCase()

  if (deviceKind === 'vps' || runtimeKind === 'vps' || runtimeTarget === 'vps') {
    return 'VPS'
  }
  if (runtimeKind === 'local' || runtimeTarget === 'local' || input.isLocal === true) {
    // "Local" means this browser/session host path when the target is the local runtime.
    // Linked org computers still surface as Computer even when selected from this Mac.
    if (deviceKind === 'computer' || runtimeKind === 'linked-computer' || runtimeKind === 'remote') {
      return 'Computer'
    }
    return 'Local'
  }
  if (
    deviceKind === 'computer'
    || runtimeKind === 'linked-computer'
    || runtimeKind === 'remote'
  ) {
    return 'Computer'
  }
  // Unknown structured kind — still show the org label as Remote.
  if (runtimeTarget || runtimeKind || deviceKind) return 'Remote'
  return 'Remote'
}

function resolveIcon(kind: ConnectionWhereKind): ConnectionWhere['icon'] {
  if (kind === 'VPS') return 'dns'
  if (kind === 'Local') return 'hard_drive'
  if (kind === 'Computer') return 'computer'
  return 'cloud'
}

/**
 * Build a connection-where summary for whatever machine this session uses.
 * Returns null when nothing useful is known.
 */
export function buildConnectionWhere(input: ConnectionWhereInput | null | undefined): ConnectionWhere | null {
  if (!input) return null

  // Prefer the org's own machine/location labels from the linked inventory.
  const machine = clean(input.machineLabel)
    || clean(input.locationLabel)
    || clean(input.runtimeLabel)
  const target = clean(input.runtimeTarget)
  const mappingLabel = clean(input.mappingLabel) || undefined
  const kind = resolveKind(input)

  // Generic target ids are only useful when we have no friendlier label.
  let label = machine
  if (!label) {
    if (target === 'vps') label = 'VPS'
    else if (target === 'local') label = 'Local'
    else if (target && !/^[a-f0-9-]{20,}$/i.test(target)) label = target
  }
  if (!label && !mappingLabel && !clean(input.runtimeKind) && !clean(input.deviceKind) && !target) {
    return null
  }
  if (!label) {
    label = kind === 'VPS'
      ? 'VPS'
      : kind === 'Local'
        ? 'Local computer'
        : kind === 'Computer'
          ? 'Computer'
          : 'Runtime'
  }

  // Avoid "VPS · VPS" / "Computer · Computer" when the only label is the kind word.
  const kindPrefix = label.toLowerCase() === kind.toLowerCase() ? null : kind
  const parts = [kindPrefix, label, mappingLabel].filter(Boolean) as string[]
  const display = parts.join(' · ')
  const online = typeof input.online === 'boolean' ? input.online : null
  const onlineText = online === true ? 'online' : online === false ? 'offline' : 'status unknown'
  const title = `${display} · ${onlineText}`

  return {
    kind,
    label,
    ...(mappingLabel ? { mappingLabel } : {}),
    display,
    online,
    title,
    icon: resolveIcon(kind),
  }
}
