/**
 * Pure derivation helpers that turn a conversation's raw `ChatEvent` stream (and
 * optional rich message parts) into the read models the Agent Workbench rail
 * renders: a terminal transcript, a files tree, a changes list and browser
 * targets. Phase 1 has no dedicated workbench event channel yet, so everything
 * here is inferred from tool call input/output/preview text and known tool
 * name conventions (read/write/edit/ls-ish names).
 *
 * These functions intentionally have no React/DOM dependency so they can be
 * unit tested in isolation and reused by both the rail and any future
 * server-side summarisation.
 */
import type { ChatEvent, RichMessagePart } from '@/lib/hermes/types'
import type {
  WorkbenchBrowserTarget,
  WorkbenchChangeFile,
  WorkbenchChangeStatus,
  WorkbenchFileNode,
  WorkbenchTerminalEntry,
  WorkbenchTerminalStatus,
} from './types'

const MAX_TERMINAL_ENTRIES = 48

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function truncateText(value: string, limit: number): string {
  const cleaned = value.replace(/\r\n/g, '\n').trim()
  if (cleaned.length <= limit) return cleaned
  return `${cleaned.slice(0, limit).trimEnd()}\n… truncated`
}

// ---------------------------------------------------------------------------
// Terminal transcript
// ---------------------------------------------------------------------------

function terminalEventLabel(event: ChatEvent): string {
  switch (event.event) {
    case 'tool.started':
      return event.activity ?? 'Using a tool'
    case 'tool.completed':
      return event.error ? 'Tool returned an error' : 'Tool completed'
    case 'task.created':
      return 'Planning work'
    case 'task.updated':
      return event.title ? `Updating ${event.title}` : 'Updating task list'
    case 'approval.required':
      return 'Waiting for approval'
    case 'reasoning.summary':
      return 'Reasoning summary available'
    case 'run.completed':
      return 'Finalising response'
    case 'run.failed':
      return 'Run failed'
    default:
      return event.activity ?? event.preview ?? 'Working'
  }
}

function terminalBodyForEvent(event: ChatEvent): string {
  const parts: string[] = []
  const input = event.input ?? event.preview
  const output = event.output ?? event.stdout
  if (input && event.event !== 'assistant.text_delta') parts.push(`$ ${truncateText(input, 700)}`)
  if (output) parts.push(truncateText(output, 1200))
  if (event.stderr) parts.push(truncateText(event.stderr, 1200))
  if (!parts.length && event.delta) parts.push(truncateText(event.delta, 260))
  if (!parts.length && event.activity) parts.push(event.activity)
  return parts.join('\n')
}

/**
 * Ports the "inline command console" derivation used by `MessageBubble`
 * (`commandConsoleRows`) into a workbench-shaped, standalone helper. Skips
 * streaming text deltas and polling heartbeats and keeps the most recent
 * 48 entries.
 */
function toolCallIdentity(event: ChatEvent): string | null {
  const visit = (value: unknown, depth = 0): string | null => {
    if (!value || typeof value !== 'object' || depth > 2) return null
    const record = value as Record<string, unknown>
    for (const key of ['toolCallId', 'tool_call_id', 'callId', 'call_id', 'invocationId', 'invocation_id']) {
      const candidate = record[key]
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    }
    return visit(record.data, depth + 1) ?? visit(record.payload, depth + 1)
  }
  return visit(event.raw)
}

const UNSCOPED_RUN_KEY = 'unscoped'

function toolRunKey(event: ChatEvent): string {
  const explicitRunId = event.runId?.trim() || event.run_id?.trim()
  return explicitRunId ? `scoped:${explicitRunId}` : UNSCOPED_RUN_KEY
}

export function buildWorkbenchTerminalEntries(events: ChatEvent[]): WorkbenchTerminalEntry[] {
  const entries: WorkbenchTerminalEntry[] = []
  const identities = new Map<string, string>()
  const runKeys = new Map<string, string>()
  const eventMeta = (event: ChatEvent) => {
    const seconds = event.timestamp
      ? new Date(event.timestamp > 10_000_000_000 ? event.timestamp : event.timestamp * 1000).toISOString().slice(11, 19)
      : '--:--:--'
    const duration = typeof event.durationMs === 'number'
      ? `${event.durationMs}ms`
      : typeof event.duration === 'number'
        ? `${event.duration}ms`
        : ''
    const exit = typeof event.exitCode === 'number' ? `exit ${event.exitCode}` : ''
    return [seconds, event.event, duration, exit].filter(Boolean).join(' · ')
  }

  events.forEach((event, index) => {
    if (event.event === 'assistant.text_delta' || event.event === 'heartbeat') return
    const failed = Boolean(event.error) || (typeof event.exitCode === 'number' && event.exitCode !== 0)
    if (event.event === 'tool.started') {
      const runKey = toolRunKey(event)
      const entry: WorkbenchTerminalEntry = {
        id: `${runKey}:${index}:${event.tool ?? 'tool'}`,
        status: 'running',
        label: event.tool ?? terminalEventLabel(event),
        meta: eventMeta(event),
        body: terminalBodyForEvent(event),
        tool: event.tool,
        timestamp: event.timestamp,
      }
      entries.push(entry)
      runKeys.set(entry.id, runKey)
      const identity = toolCallIdentity(event)
      if (identity) identities.set(entry.id, identity)
      return
    }
    if (event.event === 'tool.completed') {
      const identity = toolCallIdentity(event)
      const runKey = toolRunKey(event)
      const running = identity
        ? entries.find((entry) => entry.status === 'running' && entry.tool === event.tool && runKeys.get(entry.id) === runKey && identities.get(entry.id) === identity)
        : entries.findLast((entry) => entry.status === 'running' && entry.tool === event.tool && runKeys.get(entry.id) === runKey)
      if (running) {
        running.status = failed ? 'failed' : 'done'
        running.meta = eventMeta(event)
        const completedBody = terminalBodyForEvent(event)
        running.body = event.input || event.preview
          ? (completedBody || running.body)
          : [running.body, completedBody].filter(Boolean).join('\n')
        running.timestamp = event.timestamp ?? running.timestamp
        return
      }
    }
    const status: WorkbenchTerminalStatus = failed
      ? 'failed'
      : event.event === 'tool.input_delta'
        ? 'running'
        : event.event === 'tool.completed' || event.event === 'run.completed'
          ? 'done'
          : 'info'
    entries.push({
      id: `${toolRunKey(event)}:${index}:${event.event ?? event.tool ?? 'event'}`,
      status,
      label: event.tool ?? terminalEventLabel(event),
      meta: eventMeta(event),
      body: terminalBodyForEvent(event),
      tool: event.tool,
      timestamp: event.timestamp,
    })
  })

  return entries.slice(-MAX_TERMINAL_ENTRIES)
}

// ---------------------------------------------------------------------------
// Shared path extraction (used by the files tree and the changes list)
// ---------------------------------------------------------------------------

const CODE_EXTENSIONS = [
  'tsx', 'ts', 'jsx', 'js', 'mjs', 'cjs', 'json', 'md', 'mdx', 'css', 'scss', 'sass', 'less',
  'html', 'htm', 'py', 'go', 'rs', 'rb', 'java', 'kt', 'kts', 'swift', 'c', 'cpp', 'h', 'hpp',
  'yml', 'yaml', 'toml', 'sql', 'sh', 'bash', 'zsh', 'txt', 'env', 'lock', 'csv', 'graphql',
  'gql', 'proto', 'xml', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'ico', 'pdf',
]

const EXTENSION_ALTERNATION = CODE_EXTENSIONS.join('|')
const LEADING_BOUNDARY = "(?:^|[\\s\"'`(\\[<>=,])"
const TRAILING_BOUNDARY = "(?=$|[\\s\"'`)\\]<>,.;:!?])"
const EXTENSION_PATH_SOURCE = LEADING_BOUNDARY
  + "((?:[A-Za-z]:)?(?:\\.{1,2}/)?/?(?:@?[\\w.-]+/)*[\\w.-]+\\.(?:" + EXTENSION_ALTERNATION + "))"
  + TRAILING_BOUNDARY

/**
 * Splits a tool name into lowercase alphanumeric tokens so `list_dir`,
 * `apply-patch`, `strReplace` etc. all decompose consistently — a plain
 * `\btoken\b` regex fails on `list_dir` because `_` is a word character and
 * blocks the trailing boundary.
 */
function toolTokens(tool: string): string[] {
  return tool
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function toolHasAnyToken(tool: string, tokens: ReadonlySet<string>): boolean {
  return toolTokens(tool).some((token) => tokens.has(token))
}

/** Finds path-like tokens ending in a recognized code/asset extension. */
function extractExtensionPaths(text: string): string[] {
  const regex = new RegExp(EXTENSION_PATH_SOURCE, 'gi')
  const results: string[] = []
  for (let match = regex.exec(text); match !== null; match = regex.exec(text)) {
    results.push(match[1])
    if (match[0].length === 0) regex.lastIndex += 1
  }
  return results
}

const PATH_BEARING_TOOL_TOKENS = new Set([
  'read', 'view', 'cat', 'open', 'show', 'write', 'edit', 'update', 'create',
  'patch', 'save', 'apply', 'str', 'replace', 'ls', 'list', 'glob', 'find',
])
const CHANGE_TOOL_TOKENS = new Set([
  'write', 'edit', 'update', 'create', 'patch', 'save', 'apply', 'str', 'replace',
  'delete', 'remove', 'rename', 'move',
])

function extractJsonPathHint(text: string): string | null {
  const match = text.match(/"(?:path|file|filePath|file_path|target_file|targetFile|filename)"\s*:\s*"([^"]+)"/)
  return match ? match[1] : null
}

function extractLeadingTokenPath(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const firstLine = trimmed.split(/\r?\n/)[0]?.trim()
  const firstToken = firstLine?.split(/\s+/)[0]
  if (!firstToken || firstToken.length > 240) return null
  if (firstToken.includes('://')) return null
  if (!/^[\w.@/-]+$/.test(firstToken)) return null
  return firstToken
}

/** JSON `"path": "..."` hints take precedence over a bare leading token. */
function extractBarePathHint(text: string): string | null {
  return extractJsonPathHint(text) ?? extractLeadingTokenPath(text)
}

function normalizePath(raw: string): string | null {
  let value = raw.trim()
  if (!value) return null
  value = value.replace(/^['"`]+|['"`]+$/g, '')
  value = value.replace(/[),.;:!?]+$/g, '')
  if (!value || value.includes('://')) return null
  value = value.replace(/\\/g, '/')
  const isAbsolute = value.startsWith('/')
  const withoutRelativePrefix = value.replace(/^\.\//, '')
  const segments = withoutRelativePrefix.split('/').filter((segment) => segment.length > 0 && segment !== '.')
  if (segments.length === 0) return null
  return (isAbsolute ? '/' : '') + segments.join('/')
}

// ---------------------------------------------------------------------------
// Files tree
// ---------------------------------------------------------------------------

interface MutableFileNode {
  name: string
  path: string
  kind: 'file' | 'directory'
  children: Map<string, MutableFileNode> | null
}

function buildTreeFromPaths(rawPaths: string[], directoryPaths = new Set<string>()): WorkbenchFileNode[] {
  const root = new Map<string, MutableFileNode>()

  for (const rawPath of rawPaths) {
    const isAbsolute = rawPath.startsWith('/')
    const segments = rawPath.replace(/^\//, '').split('/').filter(Boolean)
    if (segments.length === 0) continue

    let cursor = root
    let currentPath = ''
    segments.forEach((segment, index) => {
      currentPath = currentPath ? `${currentPath}/${segment}` : (isAbsolute ? `/${segment}` : segment)
      const isLast = index === segments.length - 1
      const isDirectory = !isLast || directoryPaths.has(rawPath)
      let node = cursor.get(segment)
      if (!node) {
        node = { name: segment, path: currentPath, kind: isDirectory ? 'directory' : 'file', children: isDirectory ? new Map() : null }
        cursor.set(segment, node)
      } else if (isDirectory && node.kind === 'file') {
        node.kind = 'directory'
        node.children = node.children ?? new Map()
      }
      if (isDirectory) {
        if (!node.children) node.children = new Map()
        cursor = node.children
      }
    })
  }

  const toSorted = (map: Map<string, MutableFileNode>): WorkbenchFileNode[] => {
    const list = Array.from(map.values()).map((node) => ({
      name: node.name,
      path: node.path,
      kind: node.kind,
      children: node.children ? toSorted(node.children) : undefined,
    }))
    list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return list
  }

  return toSorted(root)
}

/**
 * Derives a nested file tree from tool activity. Two signals are combined:
 * 1. Any path-like token ending in a known extension found in the event's
 *    input/output/preview/stdout text.
 * 2. For tool names that look like a read/write/edit/ls call, the raw input
 *    (or a `"path": "..."` JSON hint inside it) is treated as a path even
 *    without an extension — e.g. a bare directory passed to `ls`.
 */
export function buildWorkbenchFileTree(events: ChatEvent[]): WorkbenchFileNode[] {
  const paths = new Set<string>()
  const directoryPaths = new Set<string>()

  for (const event of events) {
    const texts = [event.input, event.output, event.preview, event.stdout].filter(isNonEmptyString)
    for (const text of texts) {
      for (const candidate of extractExtensionPaths(text)) {
        const normalized = normalizePath(candidate)
        if (normalized) paths.add(normalized)
      }
    }

    const tool = event.tool ?? ''
    if (tool && toolHasAnyToken(tool, PATH_BEARING_TOOL_TOKENS)) {
      const hintSource = (isNonEmptyString(event.input) && event.input)
        || (isNonEmptyString(event.preview) && event.preview)
        || ''
      if (hintSource) {
        const hint = extractBarePathHint(hintSource)
        if (hint) {
          const normalized = normalizePath(hint)
          if (normalized) {
            paths.add(normalized)
            const tokens = new Set(toolTokens(tool))
            if (tokens.has('ls') || tokens.has('list') || tokens.has('glob') || tokens.has('find')) directoryPaths.add(normalized)
          }
        }
      }
    }
  }

  return buildTreeFromPaths(Array.from(paths), directoryPaths)
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

function statusFromTool(tool: string): WorkbenchChangeStatus {
  const tokens = new Set(toolTokens(tool))
  if (tokens.has('delete') || tokens.has('remove')) return 'deleted'
  if (tokens.has('rename') || tokens.has('move')) return 'renamed'
  if (tokens.has('create')) return 'added'
  if (['write', 'edit', 'update', 'patch', 'save', 'apply', 'str', 'replace'].some((token) => tokens.has(token))) return 'modified'
  return 'unknown'
}

interface ParsedDiff {
  path: string
  patch: string
  status: WorkbenchChangeStatus
}

function looksLikeUnifiedDiff(text: string): boolean {
  return /^diff --git /m.test(text) || (/^--- /m.test(text) && /^\+\+\+ /m.test(text))
}

function splitDiffByFile(body: string): ParsedDiff[] {
  const gitSections = body.split(/(?=^diff --git )/m).filter((section) => section.trim().length > 0)
  const sections = gitSections.length > 0 && /^diff --git /.test(gitSections[0]) ? gitSections : [body]
  const chunks: ParsedDiff[] = []

  for (const section of sections) {
    const gitMatch = section.match(/^diff --git a\/(.+?) b\/(.+)$/m)
    const plusMatch = section.match(/^\+\+\+ (?:b\/)?(.+)$/m)
    const minusMatch = section.match(/^--- (?:a\/)?(.+)$/m)

    let path: string | null = null
    let status: WorkbenchChangeStatus = 'modified'

    if (gitMatch) path = (gitMatch[2] || gitMatch[1]).trim()
    if (!path && plusMatch && plusMatch[1].trim() !== '/dev/null') path = plusMatch[1].trim()
    if (!path && minusMatch && minusMatch[1].trim() !== '/dev/null') path = minusMatch[1].trim()

    if (plusMatch?.[1]?.trim() === '/dev/null') status = 'deleted'
    else if (minusMatch?.[1]?.trim() === '/dev/null') status = 'added'

    if (path) chunks.push({ path, patch: section.trim(), status })
  }

  return chunks
}

function extractDiffBlocks(text: string): ParsedDiff[] {
  const fenced = Array.from(text.matchAll(/```(?:diff|patch)\r?\n([\s\S]*?)```/g)).map((match) => match[1])
  const bodies = fenced.length > 0 ? fenced : (looksLikeUnifiedDiff(text) ? [text] : [])
  return bodies.flatMap((body) => splitDiffByFile(body))
}

function extractV4PatchBlocks(text: string): ParsedDiff[] {
  if (!/^\*\*\* Begin Patch/m.test(text)) return []
  const headers = Array.from(text.matchAll(/^\*\*\* (Add|Update|Delete) File:\s*(.+)$/gm))
  return headers.flatMap((header, index) => {
    const path = header[2]?.trim()
    if (!path) return []
    const start = header.index ?? 0
    const end = headers[index + 1]?.index ?? text.indexOf('*** End Patch', start)
    const patch = text.slice(start, end > start ? end : undefined).trim()
    return [{
      path,
      patch,
      status: header[1] === 'Add' ? 'added' : header[1] === 'Delete' ? 'deleted' : 'modified',
    } satisfies ParsedDiff]
  })
}

/**
 * Derives a changes list from write/edit/apply_patch/str_replace-style tool
 * calls (path + best-effort added/modified/deleted/renamed status from the
 * tool name) and from any unified diff content (fenced ```diff blocks or raw
 * `--- a/x` / `+++ b/x` text) found in tool output, which take precedence for
 * status and patch content since they're unambiguous.
 */
export function buildWorkbenchChanges(events: ChatEvent[]): WorkbenchChangeFile[] {
  const changes = new Map<string, WorkbenchChangeFile>()

  const upsert = (rawPath: string, patch: { status?: WorkbenchChangeStatus; patch?: string; preview?: string }) => {
    const normalized = normalizePath(rawPath)
    if (!normalized) return
    const existing = changes.get(normalized)
    const nextStatus = patch.status && patch.status !== 'unknown' ? patch.status : existing?.status ?? patch.status ?? 'unknown'
    changes.set(normalized, {
      path: normalized,
      status: nextStatus,
      patch: patch.patch ?? existing?.patch,
      preview: patch.preview ?? existing?.preview,
    })
  }

  for (const event of events) {
    const tool = event.tool ?? ''
    if (tool && toolHasAnyToken(tool, CHANGE_TOOL_TOKENS)) {
      const source = (isNonEmptyString(event.input) && event.input) || (isNonEmptyString(event.preview) && event.preview) || ''
      if (source) {
        const extracted = extractExtensionPaths(source)
        const hint = extracted[0] ?? extractBarePathHint(source)
        if (hint) {
          const bodyText = [event.output, event.stdout, event.preview].find(isNonEmptyString)
          upsert(hint, { status: statusFromTool(tool), preview: bodyText ? truncateText(bodyText, 800) : undefined })
        }
      }
    }

    const texts = [event.input, event.output, event.stdout, event.preview].filter(isNonEmptyString)
    for (const text of texts) {
      for (const diff of [...extractDiffBlocks(text), ...extractV4PatchBlocks(text)]) {
        upsert(diff.path, { status: diff.status, patch: diff.patch })
      }
    }
  }

  return Array.from(changes.values()).sort((a, b) => a.path.localeCompare(b.path))
}

// ---------------------------------------------------------------------------
// Browser targets
// ---------------------------------------------------------------------------

const URL_REGEX = /https?:\/\/[^\s"'`)\]<>]+/gi

function cleanUrl(raw: string): string {
  return raw.replace(/[),.;:!?]+$/g, '')
}

/**
 * Derives browser preview targets from URLs mentioned in tool activity text
 * plus any image/gallery/file rich message parts attached to the message.
 * Duplicate URLs/images are collapsed to a single target.
 */
export function buildWorkbenchBrowserTargets(events: ChatEvent[], richParts: RichMessagePart[] = []): WorkbenchBrowserTarget[] {
  const targets: WorkbenchBrowserTarget[] = []
  const seen = new Set<string>()

  const addTarget = (target: WorkbenchBrowserTarget) => {
    const key = target.url ?? target.imageUrl ?? target.id
    if (!key || seen.has(key)) return
    seen.add(key)
    targets.push(target)
  }

  events.forEach((event, eventIndex) => {
    const texts = [event.input, event.output, event.preview, event.stdout].filter(isNonEmptyString)
    const urls = new Set<string>()
    for (const text of texts) {
      for (const match of text.matchAll(URL_REGEX)) {
        const cleaned = cleanUrl(match[0])
        if (cleaned) urls.add(cleaned)
      }
    }
    Array.from(urls).forEach((url, urlIndex) => {
      addTarget({
        id: `event-${eventIndex}-${urlIndex}`,
        url,
        title: event.tool ?? event.activity ?? event.title,
        source: 'event',
      })
    })
  })

  richParts.forEach((part, partIndex) => {
    if (part.type === 'image' && isNonEmptyString(part.url)) {
      addTarget({
        id: part.id ?? `rich-image-${partIndex}`,
        imageUrl: part.url,
        title: part.title ?? part.alt ?? part.caption,
        source: 'rich_part',
      })
    }
    if (part.type === 'gallery' && Array.isArray(part.images)) {
      part.images.forEach((image, imageIndex) => {
        if (isNonEmptyString(image.url)) {
          addTarget({
            id: `${part.id ?? `rich-gallery-${partIndex}`}-${imageIndex}`,
            imageUrl: image.url,
            title: image.caption ?? image.alt ?? part.title,
            source: 'rich_part',
          })
        }
      })
    }
    if (part.type === 'file' && isNonEmptyString(part.url) && /^https?:\/\//i.test(part.url)) {
      addTarget({
        id: part.id ?? `rich-file-${partIndex}`,
        url: part.url,
        title: part.name ?? part.title,
        source: 'attachment',
      })
    }
  })

  return targets
}
