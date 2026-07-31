import type { ContextRefKind, ExpandedContextRef } from './types'

const MAX_CHARS = 24_000

export interface ContextRefExpandInput {
  kind: ContextRefKind
  query: string
}

export interface ContextRefExpandDeps {
  readFile?: (path: string) => string | null
  listFolder?: (path: string) => string[] | null
  gitDiff?: (range: string) => string | null
  fetchUrl?: (url: string) => string | null
}

function truncate(content: string): { content: string; truncated: boolean } {
  if (content.length <= MAX_CHARS) return { content, truncated: false }
  return { content: `${content.slice(0, MAX_CHARS)}\n…[truncated]`, truncated: true }
}

export function parseAtReference(token: string): ContextRefExpandInput | null {
  const raw = token.trim()
  if (!raw.startsWith('@')) return null
  const body = raw.slice(1)
  if (body.startsWith('file:')) return { kind: 'file', query: body.slice(5) }
  if (body.startsWith('folder:') || body.startsWith('dir:')) {
    const q = body.includes(':') ? body.slice(body.indexOf(':') + 1) : body
    return { kind: 'folder', query: q }
  }
  if (body.startsWith('diff:') || body.startsWith('git:')) {
    return { kind: 'diff', query: body.slice(body.indexOf(':') + 1) || 'HEAD' }
  }
  if (body.startsWith('url:') || body.startsWith('http://') || body.startsWith('https://')) {
    const query = body.startsWith('url:') ? body.slice(4) : body
    return { kind: 'url', query }
  }
  // bare @path → file
  if (body.includes('/') || body.includes('.')) return { kind: 'file', query: body }
  return null
}

export function expandContextReference(
  input: ContextRefExpandInput,
  deps: ContextRefExpandDeps = {},
): ExpandedContextRef {
  const query = input.query.trim()
  if (!query) {
    return { kind: input.kind, query, label: input.kind, content: '', truncated: false }
  }

  if (input.kind === 'file') {
    const raw = deps.readFile?.(query) ?? null
    if (raw == null) {
      return { kind: 'file', query, label: query, content: `(file not found: ${query})`, truncated: false }
    }
    const t = truncate(raw)
    return { kind: 'file', query, label: query, content: t.content, truncated: t.truncated }
  }

  if (input.kind === 'folder') {
    const entries = deps.listFolder?.(query) ?? null
    if (entries == null) {
      return { kind: 'folder', query, label: query, content: `(folder not found: ${query})`, truncated: false }
    }
    const listing = entries.slice(0, 500).join('\n')
    const t = truncate(listing)
    return { kind: 'folder', query, label: query, content: t.content, truncated: t.truncated || entries.length > 500 }
  }

  if (input.kind === 'diff') {
    const raw = deps.gitDiff?.(query || 'HEAD') ?? null
    if (raw == null) {
      return { kind: 'diff', query, label: `diff:${query}`, content: `(diff unavailable for ${query})`, truncated: false }
    }
    const t = truncate(raw)
    return { kind: 'diff', query, label: `diff:${query}`, content: t.content, truncated: t.truncated }
  }

  // url
  if (!/^https?:\/\//i.test(query)) {
    return { kind: 'url', query, label: query, content: '(url must start with http:// or https://)', truncated: false }
  }
  const raw = deps.fetchUrl?.(query) ?? null
  if (raw == null) {
    return { kind: 'url', query, label: query, content: `(url fetch unavailable: ${query})`, truncated: false }
  }
  const t = truncate(raw)
  return { kind: 'url', query, label: query, content: t.content, truncated: t.truncated }
}

export function expandAtTokensInMessage(
  message: string,
  deps: ContextRefExpandDeps = {},
): { text: string; expansions: ExpandedContextRef[] } {
  const expansions: ExpandedContextRef[] = []
  const tokenRe = /@(?:file:|folder:|dir:|diff:|git:|url:|https?:\/\/)[^\s]+|@[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g
  const text = message.replace(tokenRe, (token) => {
    const parsed = parseAtReference(token)
    if (!parsed) return token
    const expanded = expandContextReference(parsed, deps)
    expansions.push(expanded)
    return `[@${expanded.kind}:${expanded.label}]`
  })
  return { text, expansions }
}

export function contextRefsDispatchBlock(expansions: ExpandedContextRef[]): string {
  if (expansions.length === 0) return ''
  return [
    '[Context references expanded]',
    ...expansions.map((e) => `## @${e.kind}:${e.label}\n${e.content}`),
    '',
  ].join('\n')
}
