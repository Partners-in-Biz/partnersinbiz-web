import type { ContextFileKind, DiscoveredContextFile } from './types'

/** Discovery order matches Hermes progressive project identity loading. */
export const CONTEXT_FILE_CANDIDATES: Array<{ kind: ContextFileKind; fileName: string }> = [
  { kind: 'hermes', fileName: '.hermes.md' },
  { kind: 'agents', fileName: 'AGENTS.md' },
  { kind: 'claude', fileName: 'CLAUDE.md' },
  { kind: 'soul', fileName: 'SOUL.md' },
  { kind: 'cursorrules', fileName: '.cursorrules' },
]

export type WorkspaceFileReader = (relativePath: string) => string | null | undefined

/**
 * Discover multi-format context files under a workspace root listing.
 * `exists` is a pure lookup of path → content (tests inject a map).
 */
export function discoverContextFiles(
  reader: WorkspaceFileReader,
  options: { maxBytesPerFile?: number } = {},
): DiscoveredContextFile[] {
  const maxBytes = options.maxBytesPerFile ?? 40_000
  const found: DiscoveredContextFile[] = []
  for (const candidate of CONTEXT_FILE_CANDIDATES) {
    const raw = reader(candidate.fileName)
    if (raw == null || raw === '') continue
    const content = raw.length > maxBytes ? `${raw.slice(0, maxBytes)}\n…[truncated]` : raw
    found.push({
      kind: candidate.kind,
      fileName: candidate.fileName,
      relativePath: candidate.fileName,
      content,
    })
  }
  return found
}

export function discoverContextFilesFromMap(
  files: Record<string, string>,
  options?: { maxBytesPerFile?: number },
): DiscoveredContextFile[] {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(files)) {
    const base = key.split(/[\\/]/).pop() || key
    normalized[base] = value
    normalized[key] = value
  }
  return discoverContextFiles((rel) => normalized[rel] ?? null, options)
}

export function contextFilesDispatchBlock(files: DiscoveredContextFile[]): string {
  if (files.length === 0) {
    return '[Project context files]\n(none discovered)\n'
  }
  return [
    '[Project context files]',
    ...files.map((f) => `## ${f.fileName} (${f.kind})\n${f.content}`),
    '',
  ].join('\n')
}
