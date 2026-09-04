import fs from 'node:fs'
import path from 'node:path'

export const RUN_MEDIA_MAX_BYTES = 10 * 1024 * 1024
export const RUN_MEDIA_MAX_FILES = 12
export const RUN_MEDIA_EXTENSIONS = 'png|jpg|jpeg|webp|gif|pdf|csv|svg|mp4|mp3|wav'
const MEDIA_EXT_RE = new RegExp(`\\.(?:${RUN_MEDIA_EXTENSIONS})$`, 'i')
const ABSOLUTE_MEDIA_PATH_RE = new RegExp(
  `(?<![A-Za-z0-9:])((?:\\/[^\\s"'\`\\)\\]>]+|[A-Za-z]:[\\\\/][^\\s"'\`\\)\\]>]+)\\.(?:${RUN_MEDIA_EXTENSIONS}))\\b`,
  'gi',
)

const EXT_CONTENT_TYPE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  csv: 'text/csv',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
}

export type RunMediaUploadPost = (
  path: string,
  body: { filename: string; contentType: string; bytesBase64: string },
) => Promise<Response>

function walkStrings(value: unknown, visit: (text: string) => void, depth = 0): void {
  if (depth > 8) return
  if (typeof value === 'string') {
    visit(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, visit, depth + 1)
    return
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      walkStrings(item, visit, depth + 1)
    }
  }
}

function rewriteStrings(value: unknown, replacements: ReadonlyMap<string, string>, depth = 0): unknown {
  if (depth > 8) return value
  if (typeof value === 'string') return replacePaths(value, replacements)
  if (Array.isArray(value)) return value.map((item) => rewriteStrings(item, replacements, depth + 1))
  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      next[key] = rewriteStrings(item, replacements, depth + 1)
    }
    return next
  }
  return value
}

export function extractAbsoluteMediaPaths(text: string): string[] {
  const found: string[] = []
  const normalized = text.replace(/file:\/\//gi, '')
  ABSOLUTE_MEDIA_PATH_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ABSOLUTE_MEDIA_PATH_RE.exec(normalized))) {
    const raw = match[1]
    if (raw && MEDIA_EXT_RE.test(raw)) found.push(raw)
  }
  return found
}

function pathKey(filePath: string): string {
  return path.normalize(filePath)
}

function existingMediaFile(filePath: string): { path: string; size: number } | null {
  for (const candidate of [filePath, path.normalize(filePath)]) {
    try {
      const stat = fs.statSync(candidate)
      if (stat.isFile()) return { path: candidate, size: stat.size }
    } catch {
      // Missing or unreadable — skip rather than throw.
    }
  }
  return null
}

function isUnderWorkingDirectory(filePath: string, workingDirectory: string): boolean {
  const cwd = path.resolve(workingDirectory)
  const resolved = path.resolve(filePath)
  return resolved === cwd || resolved.startsWith(cwd + path.sep)
}

export function contentTypeForFilename(filename: string): string | null {
  const ext = filename.split('.').pop()?.trim().toLowerCase() ?? ''
  return EXT_CONTENT_TYPE[ext] ?? null
}

export function collectRunMediaPaths(input: {
  workingDirectory: string
  finalText: string
  toolResults?: unknown
  richParts?: unknown
}): string[] {
  const referencedOrdered: string[] = []
  const seenReferenced = new Set<string>()
  const addReferenced = (text: string) => {
    for (const raw of extractAbsoluteMediaPaths(text)) {
      const key = pathKey(raw)
      if (seenReferenced.has(key)) continue
      seenReferenced.add(key)
      referencedOrdered.push(raw)
    }
  }
  addReferenced(input.finalText)
  walkStrings(input.richParts, addReferenced)

  const toolKeys = new Set<string>()
  walkStrings(input.toolResults, (text) => {
    for (const raw of extractAbsoluteMediaPaths(text)) {
      toolKeys.add(pathKey(raw))
    }
  })

  const selected: string[] = []
  const seenSelected = new Set<string>()
  for (const raw of referencedOrdered) {
    const file = existingMediaFile(raw)
    if (!file || file.size > RUN_MEDIA_MAX_BYTES) continue
    const key = pathKey(file.path)
    const fromTool = toolKeys.has(pathKey(raw)) || toolKeys.has(key)
    if (!fromTool && !isUnderWorkingDirectory(file.path, input.workingDirectory)) continue
    if (seenSelected.has(key)) continue
    seenSelected.add(key)
    selected.push(raw)
    if (selected.length >= RUN_MEDIA_MAX_FILES) break
  }
  return selected
}

function replacePaths(text: string, replacements: ReadonlyMap<string, string>): string {
  const entries = Array.from(replacements.entries()).sort((a, b) => b[0].length - a[0].length)
  let next = text
  for (const [from, to] of entries) {
    if (!from || !to || from === to) continue
    next = next.split(from).join(to)
  }
  return next
}

export function rewriteRunMediaReferences(
  finalText: string,
  replacements: ReadonlyMap<string, string> | Record<string, string>,
  richParts?: unknown,
): { finalText: string; richParts?: unknown } {
  const map = replacements instanceof Map ? replacements : new Map(Object.entries(replacements))
  const rewrittenText = replacePaths(finalText, map)
  if (richParts === undefined) return { finalText: rewrittenText }
  return { finalText: rewrittenText, richParts: rewriteStrings(richParts, map) }
}

export async function uploadRunMedia(
  post: RunMediaUploadPost,
  jobId: string,
  paths: string[],
): Promise<Map<string, string>> {
  const replacements = new Map<string, string>()
  for (const filePath of paths.slice(0, RUN_MEDIA_MAX_FILES)) {
    const file = existingMediaFile(filePath)
    if (!file || file.size > RUN_MEDIA_MAX_BYTES) continue
    const filename = path.basename(file.path)
    const contentType = contentTypeForFilename(filename)
    if (!contentType) continue
    let bytes: Buffer
    try {
      bytes = fs.readFileSync(file.path)
    } catch {
      continue
    }
    if (bytes.byteLength > RUN_MEDIA_MAX_BYTES) continue
    try {
      const response = await post(`/runs/${jobId}/media`, {
        filename,
        contentType,
        bytesBase64: bytes.toString('base64'),
      })
      if (!response.ok) continue
      const payload = await response.json() as { url?: unknown; data?: { url?: unknown } }
      const url = typeof payload.data?.url === 'string'
        ? payload.data.url
        : typeof payload.url === 'string' ? payload.url : ''
      if (!url) continue
      replacements.set(filePath, url)
      if (file.path !== filePath) replacements.set(file.path, url)
    } catch {
      // Best-effort: a single failed upload must not block completion.
    }
  }
  return replacements
}
