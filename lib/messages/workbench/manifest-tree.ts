/**
 * Turns a project-sync content manifest (`ProjectManifestEntry[]`, see
 * `lib/project-sync/model.ts`) into the same `WorkbenchFileNode[]` shape the
 * Phase 1 event-derived tree builder (`from-events.ts`) produces, so the
 * Files panel can render either source interchangeably.
 *
 * Unlike the event-derived heuristic, manifest entries are authoritative:
 * every file and directory that exists in the synced workspace is present
 * with an explicit `type`, so there is no path-sniffing here — just tree
 * assembly and path-safety checks on any caller-supplied relative path.
 */
import type { ProjectManifestEntry } from '@/lib/project-sync/model'
import type { WorkbenchFileNode } from './types'

interface MutableFileNode {
  name: string
  path: string
  kind: 'file' | 'directory'
  children: Map<string, MutableFileNode> | null
}

/**
 * Normalizes a caller-supplied relative path for safe comparison against
 * manifest entries. Rejects absolute paths, `..` traversal, empty segments
 * and backslashes. Manifest entry paths are already normalized by
 * `buildProjectContentManifest`, so this only needs to guard input coming
 * from outside the manifest (e.g. an API query parameter).
 */
export function normalizeManifestPath(raw: string): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value || value.includes('\\') || value.includes('\0')) return null
  if (value.startsWith('/') || value.startsWith('~') || /^[A-Za-z]:/.test(value)) return null
  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null
  return segments.join('/')
}

/**
 * Builds a nested file tree from a project-sync manifest's flat entry list.
 * Directory entries are honoured explicitly; any intermediate path segment
 * not present as its own manifest entry (which should not normally happen
 * for a well-formed manifest, but is possible for partial/legacy data) is
 * synthesized as a directory node so the tree stays consistent.
 */
export function manifestToWorkbenchFileTree(entries: ProjectManifestEntry[]): WorkbenchFileNode[] {
  const root = new Map<string, MutableFileNode>()

  for (const entry of entries) {
    const normalized = normalizeManifestPath(entry.path)
    if (!normalized) continue
    const segments = normalized.split('/')

    let cursor = root
    let currentPath = ''
    segments.forEach((segment, index) => {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      const isLast = index === segments.length - 1
      const isDirectory = !isLast || entry.type === 'directory'
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

/** Looks up a single file entry by its normalized manifest-relative path. */
export function findManifestFile(entries: ProjectManifestEntry[], relativePath: string): ProjectManifestEntry | null {
  const normalized = normalizeManifestPath(relativePath)
  if (!normalized) return null
  return entries.find((entry) => entry.type === 'file' && entry.path === normalized) ?? null
}
