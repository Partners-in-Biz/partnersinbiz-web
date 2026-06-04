export type SoftwareBuildEvidenceKind = 'commit' | 'verification' | 'link' | 'document' | 'blocker'

export interface SoftwareBuildEvidenceRow {
  kind: SoftwareBuildEvidenceKind
  label: string
  value: string
  href?: string
}

type Artifact = {
  type?: unknown
  ref?: unknown
  label?: unknown
  url?: unknown
}

export interface SoftwareBuildEvidenceSource {
  labels?: unknown
  sourceDocumentId?: unknown
  sourceSpecVersion?: unknown
  approvalGateTaskId?: unknown
  agentInput?: {
    context?: Record<string, unknown> | null
    constraints?: unknown
  } | null
  agentOutput?: {
    summary?: unknown
    artifacts?: unknown
  } | null
  evidence?: unknown
}

function compact(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function uniqueRows(rows: SoftwareBuildEvidenceRow[]) {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = `${row.kind}:${row.label}:${row.value}:${row.href ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function artifactRef(artifact: Artifact) {
  return compact(artifact.ref) ?? compact(artifact.url)
}

function hrefForValue(value: string, kind: SoftwareBuildEvidenceKind): string | undefined {
  if (/^https?:\/\//i.test(value)) return value
  if (kind === 'document') return `/admin/documents/${encodeURIComponent(value)}`
  return undefined
}

function artifactLabel(artifact: Artifact, fallback: string) {
  return compact(artifact.label) ?? fallback
}

function extractCommandFragments(summary: string) {
  const lines = summary.split(/\r?\n/)
  const commands: string[] = []
  const commandPattern = /(?:NODE_OPTIONS=[^\s]+\s+)?(?:npm|npx|pnpm|yarn|bun|jest|tsc|eslint|playwright|vitest|git diff --check)[^\n;]*/gi

  for (const line of lines) {
    const normalized = line.replace(/^[-•*]\s*/, '').trim()
    if (/^(verification|verified|tests?|checks?|commands?)\b/i.test(normalized) || commandPattern.test(normalized)) {
      commandPattern.lastIndex = 0
      const matches = normalized.match(commandPattern)
      if (matches) commands.push(...matches.map((match) => match.trim().replace(/[,.]$/, '')))
    }
    commandPattern.lastIndex = 0
  }

  return commands
}

function extractBlockerLines(summary: string) {
  return summary
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-•*]\s*/, '').trim())
    .filter((line) => /\b(blocked|blocker|failed|missing|approval required|not run|could not|unable)\b/i.test(line))
}

function pushStringArrayRows(rows: SoftwareBuildEvidenceRow[], value: unknown, kind: SoftwareBuildEvidenceKind, label: string) {
  if (!Array.isArray(value)) return
  for (const item of value) {
    const text = compact(item)
    if (!text) continue
    rows.push({ kind, label, value: text, href: hrefForValue(text, kind) })
  }
}

export function getSoftwareBuildEvidenceRows(source: SoftwareBuildEvidenceSource): SoftwareBuildEvidenceRow[] {
  const rows: SoftwareBuildEvidenceRow[] = []
  const context = source.agentInput?.context ?? {}

  const artifacts = Array.isArray(source.agentOutput?.artifacts) ? source.agentOutput?.artifacts as Artifact[] : []
  for (const artifact of artifacts) {
    const type = compact(artifact.type)?.toLowerCase() ?? ''
    const ref = artifactRef(artifact)
    if (!ref) continue

    if (type.includes('commit') || type.includes('sha')) {
      rows.push({ kind: 'commit', label: artifactLabel(artifact, 'Commit'), value: ref, href: hrefForValue(ref, 'commit') })
    } else if (type.includes('test') || type.includes('verification') || type.includes('check')) {
      rows.push({ kind: 'verification', label: artifactLabel(artifact, 'Verification'), value: ref, href: hrefForValue(ref, 'verification') })
    } else if (type.includes('doc') || type.includes('spec')) {
      rows.push({ kind: 'document', label: artifactLabel(artifact, 'Related doc'), value: ref, href: hrefForValue(ref, 'document') })
    } else if (type.includes('url') || type.includes('preview') || type.includes('link')) {
      const label = artifactLabel(artifact, /preview|development|dev/i.test(ref) ? 'Preview/development link' : 'Link')
      rows.push({ kind: 'link', label, value: ref, href: hrefForValue(ref, 'link') })
    }
  }

  for (const key of ['sourceDocumentId', 'sourceSpecVersion', 'approvalGateTaskId']) {
    const value = compact(source[key as keyof SoftwareBuildEvidenceSource]) ?? compact(context[key])
    if (!value) continue
    rows.push({
      kind: 'document',
      label: key === 'sourceDocumentId' ? 'Related doc' : key === 'sourceSpecVersion' ? 'Spec version' : 'Approval gate',
      value,
      href: key === 'sourceDocumentId' ? hrefForValue(value, 'document') : undefined,
    })
  }

  const evidence = source.evidence as Record<string, unknown> | null
  if (evidence && typeof evidence === 'object') {
    pushStringArrayRows(rows, evidence.commits, 'commit', 'Commit')
    pushStringArrayRows(rows, evidence.verificationCommands, 'verification', 'Verification')
    pushStringArrayRows(rows, evidence.previewLinks, 'link', 'Preview/development link')
    pushStringArrayRows(rows, evidence.relatedDocs, 'document', 'Related doc')
    pushStringArrayRows(rows, evidence.blockers, 'blocker', 'Blocker')
  }

  const summary = compact(source.agentOutput?.summary)
  if (summary) {
    for (const command of extractCommandFragments(summary)) {
      rows.push({ kind: 'verification', label: 'Verification', value: command })
    }
    for (const blocker of extractBlockerLines(summary)) {
      rows.push({ kind: 'blocker', label: 'Blocker', value: blocker })
    }
  }

  return uniqueRows(rows).slice(0, 12)
}

export function hasSoftwareBuildEvidence(source: SoftwareBuildEvidenceSource) {
  return getSoftwareBuildEvidenceRows(source).length > 0
}
