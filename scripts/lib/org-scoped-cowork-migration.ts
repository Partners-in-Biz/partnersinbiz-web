/**
 * Pure helpers for migrating Partners-era flat Cowork folders into
 * `~/Cowork/partners/{FolderName}` (Mac) and `/var/lib/hermes/Cowork/partners/{FolderName}` (VPS).
 */
import {
  LOCAL_COWORK_ROOT,
  PIB_COWORK_NESTING_SLUG,
  VPS_COWORK_ROOT,
  rewriteLegacyFlatCoworkPath,
} from '@/lib/client-provisioning/cowork-paths'

/** Top-level Cowork entries that must stay at the Cowork root. */
export const RESERVED_COWORK_ROOT_NAMES = new Set([
  'Cowork',
  'Partners in Biz — Client Growth',
  'Side Projects',
  'YouTube Business',
  '_projects',
  PIB_COWORK_NESTING_SLUG,
])

export const DEFAULT_PIB_VPS_HOST = '65.108.146.144'
export const DEFAULT_MAC_COWORK_ROOT = '/Users/peetstander/Cowork'
export const DEFAULT_MAPPINGS_PATH = '/Users/peetstander/.partnersinbiz/mappings.json'
export const PARTNERS_MAC_WORKSPACE_MAPPING_ID = 'partners-mac-workspace'
export const PARTNERS_MAC_WORKSPACE_NESTED_PATH =
  `${DEFAULT_MAC_COWORK_ROOT}/${PIB_COWORK_NESTING_SLUG}/Partners in Biz`

/** Known Firestore / manifest path field names that may hold Cowork roots or children. */
export const COWORK_PATH_FIELD_KEYS = [
  'localPath',
  'vpsPath',
  'agentDomainPath',
  'localAgentDomainPath',
  'localWorkingPath',
  'vpsWorkingPath',
] as const

export type CoworkPathFieldKey = (typeof COWORK_PATH_FIELD_KEYS)[number]

export interface CliFlags {
  dryRun: boolean
  macOnly: boolean
  vpsOnly: boolean
  firestoreOnly: boolean
  skipFirestore: boolean
  skipVps: boolean
  skipMac: boolean
  host: string
  macCoworkRoot: string
  mappingsPath: string
}

export interface MigrationScopes {
  mac: boolean
  vps: boolean
  firestore: boolean
}

export type FsEntryKind = 'directory' | 'file' | 'symlink' | 'other'

export interface MoveCandidateClassification {
  action: 'move' | 'skip'
  reason: string
  folderName: string
  fromRelative: string
  toRelative: string
}

export interface PathRewriteChange {
  fieldPath: string
  from: string
  to: string
}

export interface PathRewriteResult {
  changed: boolean
  next: Record<string, unknown>
  changes: PathRewriteChange[]
}

export interface LinkedComputerMappingsPlan {
  changed: boolean
  next: Record<string, string>
  changes: Array<{ mappingId: string; from: string; to: string }>
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function parseFlags(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): CliFlags {
  const flags: CliFlags = {
    dryRun: true,
    macOnly: false,
    vpsOnly: false,
    firestoreOnly: false,
    skipFirestore: false,
    skipVps: false,
    skipMac: false,
    host: cleanString(env.PIB_VPS_HOST) || DEFAULT_PIB_VPS_HOST,
    macCoworkRoot: DEFAULT_MAC_COWORK_ROOT,
    mappingsPath: DEFAULT_MAPPINGS_PATH,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--commit' || arg === '--apply') flags.dryRun = false
    else if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--mac-only') flags.macOnly = true
    else if (arg === '--vps-only') flags.vpsOnly = true
    else if (arg === '--firestore-only') flags.firestoreOnly = true
    else if (arg === '--skip-firestore') flags.skipFirestore = true
    else if (arg === '--skip-vps') flags.skipVps = true
    else if (arg === '--skip-mac') flags.skipMac = true
    else if (arg === '--host') flags.host = cleanString(argv[++i]) || flags.host
    else if (arg === '--mac-cowork-root') flags.macCoworkRoot = cleanString(argv[++i]) || flags.macCoworkRoot
    else if (arg === '--mappings-path') flags.mappingsPath = cleanString(argv[++i]) || flags.mappingsPath
    else throw new Error(`Unknown argument: ${arg}`)
  }

  const exclusive = [flags.macOnly, flags.vpsOnly, flags.firestoreOnly].filter(Boolean).length
  if (exclusive > 1) {
    throw new Error('Use only one of --mac-only, --vps-only, or --firestore-only')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(flags.host)) {
    throw new Error('VPS host contains unsupported characters')
  }
  return flags
}

export function resolveMigrationScopes(flags: CliFlags): MigrationScopes {
  if (flags.macOnly) return { mac: true, vps: false, firestore: false }
  if (flags.vpsOnly) return { mac: false, vps: true, firestore: false }
  if (flags.firestoreOnly) return { mac: false, vps: false, firestore: true }
  return {
    mac: !flags.skipMac,
    vps: !flags.skipVps,
    firestore: !flags.skipFirestore,
  }
}

/**
 * Decide whether a Cowork root entry should move under `partners/`.
 */
export function classifyMoveCandidate(input: {
  name: string
  kind: FsEntryKind
}): MoveCandidateClassification {
  const folderName = cleanString(input.name)
  const fromRelative = folderName
  const toRelative = folderName ? `${PIB_COWORK_NESTING_SLUG}/${folderName}` : ''

  if (!folderName || folderName === '.' || folderName === '..') {
    return {
      action: 'skip',
      reason: 'invalid name',
      folderName,
      fromRelative,
      toRelative,
    }
  }
  if (folderName.startsWith('.')) {
    return {
      action: 'skip',
      reason: 'dot entry',
      folderName,
      fromRelative,
      toRelative,
    }
  }
  if (folderName === 'CLAUDE.md' || input.kind === 'file' || input.kind === 'other') {
    return {
      action: 'skip',
      reason: 'not a directory',
      folderName,
      fromRelative,
      toRelative,
    }
  }
  if (input.kind === 'symlink') {
    return {
      action: 'skip',
      reason: 'symlink at Cowork root (compatibility link or non-workspace)',
      folderName,
      fromRelative,
      toRelative,
    }
  }
  if (RESERVED_COWORK_ROOT_NAMES.has(folderName)) {
    return {
      action: 'skip',
      reason:
        folderName === PIB_COWORK_NESTING_SLUG
          ? 'destination nest already present'
          : 'reserved Cowork root entry',
      folderName,
      fromRelative,
      toRelative,
    }
  }

  return {
    action: 'move',
    reason: 'Partners-era flat workspace',
    folderName,
    fromRelative,
    toRelative,
  }
}

/** Apply rewriteLegacyFlatCoworkPath only when the value actually changes. */
export function rewriteCoworkPathValue(
  value: string,
  nestingOrgSlug: string = PIB_COWORK_NESTING_SLUG,
): string | null {
  const trimmed = cleanString(value)
  if (!trimmed) return null
  const rewritten = rewriteLegacyFlatCoworkPath(trimmed, nestingOrgSlug)
  if (!rewritten || rewritten === trimmed) return null
  return rewritten
}

function rewriteKnownPathFields(
  record: Record<string, unknown>,
  fieldPathPrefix: string,
  nestingOrgSlug: string,
  changes: PathRewriteChange[],
): Record<string, unknown> {
  const next = { ...record }
  for (const key of COWORK_PATH_FIELD_KEYS) {
    const current = cleanString(record[key])
    if (!current) continue
    const rewritten = rewriteCoworkPathValue(current, nestingOrgSlug)
    if (!rewritten) continue
    next[key] = rewritten
    changes.push({
      fieldPath: fieldPathPrefix ? `${fieldPathPrefix}.${key}` : key,
      from: current,
      to: rewritten,
    })
  }
  return next
}

/**
 * Deep-rewrite path fields on a plain object (workspace docs, manifests, etc.).
 * Handles nested `manifest`, `workspaceManifest`, `workspaceContext`, and
 * `folderRegistry[].syncTargets`.
 */
export function rewritePathFieldsInObject(
  data: Record<string, unknown>,
  nestingOrgSlug: string = PIB_COWORK_NESTING_SLUG,
): PathRewriteResult {
  const changes: PathRewriteChange[] = []
  let next: Record<string, unknown> = rewriteKnownPathFields({ ...data }, '', nestingOrgSlug, changes)

  const nestedKeys = ['manifest', 'workspaceManifest', 'workspaceContext'] as const
  for (const nestedKey of nestedKeys) {
    const nested = asRecord(data[nestedKey])
    if (Object.keys(nested).length === 0) continue
    const before = changes.length
    const rewrittenNested = rewriteKnownPathFields(nested, nestedKey, nestingOrgSlug, changes)
    if (changes.length > before) next = { ...next, [nestedKey]: rewrittenNested }
  }

  if (Array.isArray(data.folderRegistry)) {
    let registryChanged = false
    const nextRegistry = data.folderRegistry.map((entry, index) => {
      const row = asRecord(entry)
      const syncTargets = asRecord(row.syncTargets)
      if (Object.keys(syncTargets).length === 0) return entry
      const before = changes.length
      const rewrittenTargets = rewriteKnownPathFields(
        syncTargets,
        `folderRegistry[${index}].syncTargets`,
        nestingOrgSlug,
        changes,
      )
      if (changes.length === before) return entry
      registryChanged = true
      return { ...row, syncTargets: rewrittenTargets }
    })
    if (registryChanged) next = { ...next, folderRegistry: nextRegistry }
  }

  return {
    changed: changes.length > 0,
    next,
    changes,
  }
}

/** Minimal Firestore merge patch from a rewrite result (avoids rewriting unrelated fields). */
export function buildFirestoreMergePatch(result: PathRewriteResult): Record<string, unknown> {
  if (!result.changed) return {}
  const patch: Record<string, unknown> = {}
  const topLevelKeys = new Set<string>()
  for (const change of result.changes) {
    if (!change.fieldPath.includes('.') && !change.fieldPath.includes('[')) {
      topLevelKeys.add(change.fieldPath)
    }
  }
  for (const key of topLevelKeys) patch[key] = result.next[key]
  if (result.changes.some((c) => c.fieldPath.startsWith('manifest.'))) {
    patch.manifest = result.next.manifest
  }
  if (result.changes.some((c) => c.fieldPath.startsWith('workspaceManifest.'))) {
    patch.workspaceManifest = result.next.workspaceManifest
  }
  if (result.changes.some((c) => c.fieldPath.startsWith('workspaceContext.'))) {
    patch.workspaceContext = result.next.workspaceContext
  }
  if (result.changes.some((c) => c.fieldPath.startsWith('folderRegistry'))) {
    patch.folderRegistry = result.next.folderRegistry
  }
  return patch
}

export function rewriteOrgWorkspaceDoc(
  data: Record<string, unknown>,
  nestingOrgSlug: string = PIB_COWORK_NESTING_SLUG,
): PathRewriteResult {
  return rewritePathFieldsInObject(data, nestingOrgSlug)
}

export function rewriteOrganizationDoc(
  data: Record<string, unknown>,
  nestingOrgSlug: string = PIB_COWORK_NESTING_SLUG,
): PathRewriteResult {
  return rewritePathFieldsInObject(data, nestingOrgSlug)
}

export function rewriteConversationDoc(
  data: Record<string, unknown>,
  nestingOrgSlug: string = PIB_COWORK_NESTING_SLUG,
): PathRewriteResult {
  const context = asRecord(data.workspaceContext)
  if (Object.keys(context).length === 0) {
    return { changed: false, next: data, changes: [] }
  }
  const rewritten = rewritePathFieldsInObject(
    { workspaceContext: context },
    nestingOrgSlug,
  )
  if (!rewritten.changed) {
    return { changed: false, next: data, changes: [] }
  }
  return {
    changed: true,
    next: {
      ...data,
      workspaceContext: rewritten.next.workspaceContext,
    },
    changes: rewritten.changes,
  }
}

export function rewritePibWorkspaceJson(
  data: Record<string, unknown>,
  nestingOrgSlug: string = PIB_COWORK_NESTING_SLUG,
): PathRewriteResult {
  return rewritePathFieldsInObject(data, nestingOrgSlug)
}

export function planLinkedComputerMappingsUpdate(
  mappings: Record<string, string>,
  nestedPartnersPath: string = PARTNERS_MAC_WORKSPACE_NESTED_PATH,
): LinkedComputerMappingsPlan {
  const next = { ...mappings }
  const changes: LinkedComputerMappingsPlan['changes'] = []
  const current = cleanString(mappings[PARTNERS_MAC_WORKSPACE_MAPPING_ID])
  if (current === nestedPartnersPath) {
    return { changed: false, next, changes }
  }
  next[PARTNERS_MAC_WORKSPACE_MAPPING_ID] = nestedPartnersPath
  changes.push({
    mappingId: PARTNERS_MAC_WORKSPACE_MAPPING_ID,
    from: current || '(missing)',
    to: nestedPartnersPath,
  })
  return { changed: true, next, changes }
}

/**
 * Build a remote bash script that mkdir's partners/, moves listed folders,
 * and creates compatibility symlinks at the old flat paths.
 */
export function buildVpsMigrationBash(input: {
  folderNames: string[]
  dryRun: boolean
  coworkRoot?: string
  nestingSlug?: string
}): string {
  const coworkRoot = input.coworkRoot || VPS_COWORK_ROOT
  const nestingSlug = input.nestingSlug || PIB_COWORK_NESTING_SLUG
  const dryFlag = input.dryRun ? '1' : '0'
  const folderEntries = input.folderNames.map((name) => `  ${shellSingleQuote(name)}`).join('\n')

  return `set -euo pipefail
ROOT=${shellSingleQuote(coworkRoot)}
NEST=${shellSingleQuote(nestingSlug)}
DRY_RUN=${dryFlag}
NEST_DIR="$ROOT/$NEST"
if [ "$DRY_RUN" = "1" ]; then
  if [ -d "$NEST_DIR" ]; then echo "NEST_DIR|$NEST_DIR|exists"; else echo "NEST_DIR|$NEST_DIR|would_create"; fi
else
  mkdir -p "$NEST_DIR"
  echo "NEST_DIR|$NEST_DIR|ready"
fi
folders=(
${folderEntries}
)
if [ "\${#folders[@]}" -gt 0 ]; then
  for name in "\${folders[@]}"; do
    [ -n "$name" ] || continue
    src="$ROOT/$name"
    dst="$NEST_DIR/$name"
    if [ -L "$src" ]; then
      echo "SKIP_SYMLINK|$name|$(readlink "$src")"
      continue
    fi
    if [ -d "$src" ]; then
      if [ -e "$dst" ]; then
        echo "DEST_EXISTS|$name"
        continue
      fi
      if [ "$DRY_RUN" = "1" ]; then
        echo "WOULD_MOVE|$name|$src|$dst"
      else
        mv "$src" "$dst"
        ln -s "$dst" "$src"
        echo "MOVED|$name|$src|$dst"
      fi
      continue
    fi
    if [ -d "$dst" ]; then
      echo "ALREADY_MOVED|$name"
      if [ ! -e "$src" ] && [ ! -L "$src" ]; then
        if [ "$DRY_RUN" = "1" ]; then
          echo "WOULD_SYMLINK|$name|$dst|$src"
        else
          ln -s "$dst" "$src"
          echo "SYMLINK_CREATED|$name|$dst|$src"
        fi
      fi
      continue
    fi
    echo "MISSING|$name"
  done
fi
`
}

export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Portable helpers for summary formatting (also used by tests). */
export function formatMoveSummaryRow(row: {
  scope: 'mac' | 'vps'
  folderName: string
  fromPath: string
  toPath: string
  action: string
  symlink?: string
}): string {
  const symlink = row.symlink ? ` | symlink=${row.symlink}` : ''
  return `${row.scope}\t${row.folderName}\t${row.action}\t${row.fromPath}\t→\t${row.toPath}${symlink}`
}

export function nestedCoworkPath(folderName: string, root: 'local' | 'vps' = 'local'): string {
  const base = root === 'vps' ? VPS_COWORK_ROOT : LOCAL_COWORK_ROOT
  return `${base}/${PIB_COWORK_NESTING_SLUG}/${folderName}`
}
