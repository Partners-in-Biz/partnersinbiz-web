/**
 * Default Context Reference expanders for Messages dispatch:
 * @file / @folder from workspace, @diff via git, @url via HTTP fetch.
 */
import { execFileSync } from 'child_process'
import type { ContextRefExpandDeps } from './context-refs-expand'
import type { WorkspaceFs } from './workspace-fs'

const MAX_DIFF = 24_000
const MAX_URL = 24_000
const FETCH_TIMEOUT_MS = 8_000

export function createGitDiffDep(cwd?: string): NonNullable<ContextRefExpandDeps['gitDiff']> {
  return (range: string) => {
    const safeRange = (range || 'HEAD').trim().slice(0, 200)
    if (!safeRange || safeRange.includes(';') || safeRange.includes('|') || safeRange.includes('`')) {
      return null
    }
    try {
      const args =
        safeRange === 'HEAD' || safeRange === 'staged' || safeRange === '--staged'
          ? ['diff', '--', '.']
          : safeRange.startsWith('HEAD') || /^[A-Za-z0-9_./~^@{}+-]+$/.test(safeRange)
            ? ['diff', safeRange, '--', '.']
            : null
      if (!args) return null
      if (safeRange === 'staged' || safeRange === '--staged') {
        args.splice(1, 0, '--cached')
      }
      const out = execFileSync('git', args, {
        cwd: cwd || process.cwd(),
        encoding: 'utf8',
        maxBuffer: MAX_DIFF * 2,
        timeout: 10_000,
      })
      if (!out) return '(empty diff)'
      return out.length > MAX_DIFF ? `${out.slice(0, MAX_DIFF)}\n…[truncated]` : out
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return `(git diff unavailable: ${message.slice(0, 200)})`
    }
  }
}

export function createFetchUrlDep(
  fetchImpl: typeof fetch = fetch,
): NonNullable<ContextRefExpandDeps['fetchUrl']> {
  return (url: string) => {
    if (!/^https?:\/\//i.test(url)) return null
    // Sync bridge: dispatch is async-capable but expand API is sync.
    // Use deasync-free approach: return a marker that async path resolves — for sync expand,
    // we use child_process curl when available, else note unavailable.
    try {
      const out = execFileSync(
        'curl',
        ['-fsSL', '--max-time', '8', '-A', 'PartnersInBiz-HermesFeatures/1.0', url],
        {
          encoding: 'utf8',
          maxBuffer: MAX_URL * 2,
          timeout: FETCH_TIMEOUT_MS + 1000,
        },
      )
      if (!out) return '(empty url body)'
      return out.length > MAX_URL ? `${out.slice(0, MAX_URL)}\n…[truncated]` : out
    } catch {
      // Fallback: leave explicit unavailable (async fetch helper exists below)
      return `(url fetch unavailable: ${url})`
    }
  }
}

/** Async URL fetch for callers that can await (preferred). */
export async function fetchUrlAsync(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'PartnersInBiz-HermesFeatures/1.0' },
    })
    clearTimeout(timer)
    if (!res.ok) return `(url fetch failed: ${res.status})`
    const text = await res.text()
    return text.length > MAX_URL ? `${text.slice(0, MAX_URL)}\n…[truncated]` : text
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return `(url fetch unavailable: ${message.slice(0, 200)})`
  }
}

export function buildDefaultRefDeps(input: {
  workspace?: WorkspaceFs | null
  workspaceFiles?: Record<string, string>
  cwd?: string
  fetchImpl?: typeof fetch
}): ContextRefExpandDeps {
  const files = input.workspaceFiles || {}
  return {
    readFile: (p) => {
      if (input.workspace) return input.workspace.readFile(p)
      return files[p] ?? null
    },
    listFolder: (p) => {
      if (input.workspace) return input.workspace.listFolder(p)
      const prefix = !p || p === '.' ? '' : p.endsWith('/') ? p : `${p}/`
      const names = new Set<string>()
      for (const key of Object.keys(files)) {
        if (prefix && !key.startsWith(prefix) && key !== p) continue
        const rest = prefix ? key.slice(prefix.length) : key
        if (!rest && key !== p) continue
        names.add(rest.split('/')[0] || key)
      }
      return names.size ? [...names] : null
    },
    gitDiff: createGitDiffDep(input.cwd || input.workspace?.root || process.cwd()),
    fetchUrl: createFetchUrlDep(input.fetchImpl),
  }
}
