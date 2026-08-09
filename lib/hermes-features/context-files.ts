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

export function selectContextFilesForPrompt(
  files: DiscoveredContextFile[],
  options: { maxChars?: number } = {},
): DiscoveredContextFile[] {
  const maxChars = options.maxChars ?? 12_000
  // One canonical operating file, with AGENTS taking precedence over format
  // mirrors. SOUL is separate identity context only when it adds new content.
  const ordered = [
    files.find((file) => file.kind === 'agents'),
    files.find((file) => file.kind === 'hermes'),
    files.find((file) => file.kind === 'claude'),
    files.find((file) => file.kind === 'cursorrules'),
    files.find((file) => file.kind === 'soul'),
  ].filter((file): file is DiscoveredContextFile => Boolean(file))

  const seenContent = new Set<string>()
  const selected: DiscoveredContextFile[] = []
  const suffix = '\n…[context budget truncated]'
  const fit = (value: string, remaining: number): string => {
    if (remaining <= 0) return ''
    if (value.length <= remaining) return value
    if (remaining <= suffix.length) return ''
    return `${value.slice(0, remaining - suffix.length).trimEnd()}${suffix}`
  }
  let used = 0
  for (const file of ordered) {
    const normalized = file.content.trim()
    if (!normalized || seenContent.has(normalized)) continue
    if (used >= maxChars) break
    const remaining = maxChars - used
    const content = fit(normalized, remaining)
    if (!content) break
    selected.push({ ...file, content })
    seenContent.add(normalized)
    used += content.length
    // A selected AGENTS/other operating contract supersedes other operating formats.
    if (file.kind !== 'soul') {
      const soul = ordered.find((candidate) => candidate.kind === 'soul')
      if (soul && soul !== file && !seenContent.has(soul.content.trim()) && used < maxChars) {
        const soulRemaining = maxChars - used
        const soulContent = soul.content.trim().length > soulRemaining
          ? `${soul.content.trim().slice(0, Math.max(0, soulRemaining - 24)).trimEnd()}\n…[context budget truncated]`
          : soul.content.trim()
        if (soulContent) selected.push({ ...soul, content: soulContent })
      }
      break
    }
  }
  return selected
}

export function contextFilesDispatchBlock(files: DiscoveredContextFile[]): string {
  if (files.length === 0) return '[Project context files]\n(none discovered)\n'
  return [
    '[Project context files]',
    ...files.map((f) => `## ${f.fileName} (${f.kind})\n${f.content}`),
    '',
  ].join('\n')
}
