/**
 * Shared-codebase / multi-root conventions for PiB Projects.
 *
 * - Multiple Projects may point at the same on-disk folder (shared registered path).
 * - A single Project may declare related code roots (e.g. frontend + backend)
 *   relative to that primary folder so agents treat them as one product surface.
 */

export type ProjectCodeRoot = {
  /** Path relative to the project primary folder (e.g. `frontend`, `backend`). */
  path: string
  label?: string
}

export type ProjectFolderMode = 'standard' | 'registered'

const SAFE_RELATIVE = /^(?:[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)$/

export function cleanCodeRootPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim().replace(/\\/g, '/')
  // Reject absolute / home paths before stripping slashes.
  if (!raw || raw.startsWith('/') || raw.startsWith('~') || /^[A-Za-z]:\//.test(raw)) return null
  const clean = raw.replace(/^\/+|\/+$/g, '')
  if (!clean || clean.length > 240) return null
  if (clean.includes('..') || clean.includes('\0')) return null
  if (!SAFE_RELATIVE.test(clean)) return null
  return clean
}

export function normalizeProjectCodeRoots(value: unknown, limit = 12): ProjectCodeRoot[] {
  if (!Array.isArray(value)) return []
  const out: ProjectCodeRoot[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (out.length >= limit) break
    if (typeof entry === 'string') {
      const path = cleanCodeRootPath(entry)
      if (!path || seen.has(path)) continue
      seen.add(path)
      out.push({ path, label: path })
      continue
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const raw = entry as Record<string, unknown>
    const path = cleanCodeRootPath(raw.path)
    if (!path || seen.has(path)) continue
    seen.add(path)
    const label = typeof raw.label === 'string' && raw.label.trim()
      ? raw.label.trim().slice(0, 80)
      : path
    out.push({ path, label })
  }
  return out
}

/** Sensible monorepo defaults when a primary folder looks like an app root with FE/BE children. */
export function defaultMonorepoCodeRoots(childNames: string[]): ProjectCodeRoot[] {
  const lower = new Set(childNames.map((name) => name.toLowerCase()))
  const roots: ProjectCodeRoot[] = []
  if (lower.has('frontend') || lower.has('web') || lower.has('app') || lower.has('client')) {
    const name = ['frontend', 'web', 'app', 'client'].find((candidate) => lower.has(candidate))!
    roots.push({ path: name, label: 'Frontend' })
  }
  if (lower.has('backend') || lower.has('api') || lower.has('server')) {
    const name = ['backend', 'api', 'server'].find((candidate) => lower.has(candidate))!
    roots.push({ path: name, label: 'Backend' })
  }
  return roots
}

/**
 * Prompt block for Hermes / linked runs: company orientation + multi-root map.
 * Paths are relative to the session working directory unless noted.
 */
export function buildProjectCodeWorkspacePrompt(input: {
  projectName?: string | null
  projectId?: string | null
  folderRelativePath?: string | null
  projectFolderMode?: ProjectFolderMode | string | null
  companyName?: string | null
  companyId?: string | null
  codeRoots?: ProjectCodeRoot[] | null
  sharedFolder?: boolean | null
}): string {
  const projectName = typeof input.projectName === 'string' ? input.projectName.trim() : ''
  const companyName = typeof input.companyName === 'string' ? input.companyName.trim() : ''
  const folderRelativePath = typeof input.folderRelativePath === 'string' ? input.folderRelativePath.trim() : ''
  const codeRoots = normalizeProjectCodeRoots(input.codeRoots)
  const registered = input.projectFolderMode === 'registered' || input.sharedFolder === true

  const lines = [
    '[Project code workspace map]',
    projectName ? `projectName: ${projectName}` : '',
    input.projectId ? `projectId: ${input.projectId}` : '',
    folderRelativePath ? `primaryFolderRelativePath: ${folderRelativePath}` : '',
    registered
      ? 'folderMode: registered (may share this on-disk tree with other PiB Projects — do not assume exclusive ownership of the folder)'
      : 'folderMode: standard',
    companyName ? `companyName: ${companyName}` : '',
    input.companyId ? `crmCompanyId: ${input.companyId}` : '',
    'Before inventing company facts, read (when file access is available):',
    '1) ./AGENTS.md and ./CLAUDE.md in the session working directory',
    '2) Company root AGENTS.md/CLAUDE.md one or more parents up when this folder is nested under Cowork/partners/{Company}',
    '3) Company agentDomain hot.md then index.md (paths in workspace context)',
    '4) ./.pib-workspace.json when present',
  ]

  if (codeRoots.length > 0) {
    lines.push('Related code roots (relative to the primary project folder — treat as one product surface):')
    for (const root of codeRoots) {
      lines.push(`- ${root.label ?? root.path}: ./${root.path}`)
    }
    lines.push('When a task mentions frontend/UI or backend/API, work in the matching root; keep contracts and shared types consistent across roots.')
  } else {
    lines.push('No explicit codeRoots on this project. If frontend/ and backend/ (or web/api) exist under the primary folder, treat them as related roots of the same product.')
  }

  lines.push('Multiple PiB Projects may manage the same codebase path with different boards/sessions. Coordinate via git; do not duplicate the repository into another directory.')
  lines.push('---')
  lines.push('')
  return lines.filter(Boolean).join('\n')
}

/** Markdown template for a project or monorepo AGENTS.md orientation file. */
export function projectAgentsTemplate(input: {
  projectName: string
  companyName?: string
  companyWikiHint?: string
  codeRoots?: ProjectCodeRoot[]
}): string {
  const company = input.companyName?.trim() || 'the parent company'
  const roots = normalizeProjectCodeRoots(input.codeRoots)
  const rootsBlock = roots.length > 0
    ? roots.map((root) => `- \`${root.path}/\` — ${root.label ?? root.path}`).join('\n')
    : `- \`frontend/\` or \`web/\` — UI (if present)\n- \`backend/\` or \`api/\` — API (if present)`

  return `# ${input.projectName}

PiB delivery project for **${company}**.

## Company context

- Read the **company** \`AGENTS.md\` / \`CLAUDE.md\` in the parent Cowork folder (or company root) before inventing company facts.
${input.companyWikiHint ? `- Company knowledge base: \`${input.companyWikiHint}\` (start with \`wiki/hot.md\` then \`index.md\`).\n` : ''}- CRM / Messages company folder is the durable identity home; this Project is the delivery board and execution cwd.

## Code roots (single disk tree)

Primary working directory is this folder (or the registered path linked to this Project).

${rootsBlock}

Other PiB Projects may share this same on-disk path with a different board. Do **not** clone or copy the codebase into \`projects/{otherId}\` for convenience.

## Rules

- Prefer project tasks, command sessions, and evidence on this Project.
- Keep secrets out of git; use linked-runtime / org secrets channels.
- If both frontend and backend change, keep API contracts aligned.
`
}
