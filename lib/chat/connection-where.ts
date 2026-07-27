/**
 * Human-readable "where is this chat running?" summary for Messages.
 * Prefer live presence + workspace context + last-run dispatch metadata.
 */

export type ConnectionWhereKind = 'VPS' | 'Computer' | 'Local' | 'Remote'

export type ConnectionWhere = {
  kind: ConnectionWhereKind
  /** Short machine / host name, e.g. "Partners VPS" or "Peet's Mac". */
  label: string
  /** Optional folder / mapping name, e.g. "Partners in Biz". */
  mappingLabel?: string
  /** Single-line chip text: "VPS · Partners VPS" or "Computer · Peet's Mac · CRM". */
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

function resolveKind(input: ConnectionWhereInput): ConnectionWhereKind {
  const deviceKind = clean(input.deviceKind).toLowerCase()
  const runtimeKind = clean(input.runtimeKind).toLowerCase()
  const runtimeTarget = clean(input.runtimeTarget).toLowerCase()
  const labelBlob = `${clean(input.machineLabel)} ${clean(input.runtimeLabel)} ${clean(input.locationLabel)}`.toLowerCase()

  if (
    deviceKind === 'vps'
    || runtimeKind === 'vps'
    || runtimeTarget === 'vps'
    || labelBlob.includes('vps')
  ) {
    return 'VPS'
  }
  if (runtimeKind === 'local' || runtimeTarget === 'local' || input.isLocal === true) {
    return 'Local'
  }
  if (
    deviceKind === 'computer'
    || runtimeKind === 'linked-computer'
    || runtimeKind === 'remote'
    || labelBlob.includes('mac')
    || labelBlob.includes('computer')
  ) {
    return 'Computer'
  }
  if (runtimeTarget || runtimeKind) return 'Remote'
  return 'Remote'
}

function resolveIcon(kind: ConnectionWhereKind): ConnectionWhere['icon'] {
  if (kind === 'VPS') return 'dns'
  if (kind === 'Local') return 'hard_drive'
  if (kind === 'Computer') return 'computer'
  return 'cloud'
}

/**
 * Build a connection-where summary. Returns null when nothing useful is known.
 */
export function buildConnectionWhere(input: ConnectionWhereInput | null | undefined): ConnectionWhere | null {
  if (!input) return null

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
  if (!label && !mappingLabel && !clean(input.runtimeKind) && !target) return null
  if (!label) {
    label = kind === 'VPS' ? 'VPS' : kind === 'Local' ? 'Local computer' : kind === 'Computer' ? 'Computer' : 'Runtime'
  }

  // Avoid "VPS · VPS" duplication.
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
