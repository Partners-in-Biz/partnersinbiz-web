/**
 * Sandboxed workspace filesystem for context discovery and checkpoint/rollback.
 * Only relative paths under a resolved root are allowed.
 */
import fs from 'fs'
import path from 'path'
import { CONTEXT_FILE_CANDIDATES } from './context-files'
import type { DiscoveredContextFile } from './types'

const MAX_FILE_BYTES = 40_000
const MAX_SNAPSHOT_FILES = 80
const TEXT_EXT = new Set([
  '.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.json', '.yaml', '.yml', '.toml',
  '.css', '.scss', '.html', '.py', '.rs', '.go', '.sh', '.env.example', '.cursorrules',
])

export interface WorkspaceFs {
  root: string
  readFile(relativePath: string): string | null
  writeFile(relativePath: string, content: string): void
  listFolder(relativePath: string): string[] | null
  snapshotTextFiles(): Record<string, string>
  applySnapshot(files: Record<string, string>): { written: string[]; removed: string[] }
  discoverContextFiles(): DiscoveredContextFile[]
}

function isSafeRelative(rel: string): boolean {
  const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!clean || clean.includes('\0')) return false
  if (clean.split('/').some((p) => p === '..')) return false
  return true
}

function resolveUnderRoot(root: string, relativePath: string): string | null {
  if (!isSafeRelative(relativePath)) return null
  const abs = path.resolve(root, relativePath)
  const rootAbs = path.resolve(root)
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null
  return abs
}

export function createNodeWorkspaceFs(rootPath: string): WorkspaceFs | null {
  const root = path.resolve(rootPath)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return null

  return {
    root,
    readFile(relativePath: string) {
      const abs = resolveUnderRoot(root, relativePath)
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null
      try {
        const buf = fs.readFileSync(abs)
        if (buf.length > MAX_FILE_BYTES * 4) {
          return `${buf.subarray(0, MAX_FILE_BYTES).toString('utf8')}\n…[truncated]`
        }
        return buf.toString('utf8')
      } catch {
        return null
      }
    },
    writeFile(relativePath: string, content: string) {
      const abs = resolveUnderRoot(root, relativePath)
      if (!abs) throw new Error(`Unsafe path: ${relativePath}`)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, content, 'utf8')
    },
    listFolder(relativePath: string) {
      const abs = resolveUnderRoot(root, relativePath === '.' ? '' : relativePath)
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return null
      try {
        return fs.readdirSync(abs).slice(0, 500)
      } catch {
        return null
      }
    },
    snapshotTextFiles() {
      const out: Record<string, string> = {}
      const walk = (dir: string, relBase: string) => {
        if (Object.keys(out).length >= MAX_SNAPSHOT_FILES) return
        let entries: string[]
        try {
          entries = fs.readdirSync(dir)
        } catch {
          return
        }
        for (const name of entries) {
          if (Object.keys(out).length >= MAX_SNAPSHOT_FILES) break
          if (name === 'node_modules' || name === '.git' || name === '.next' || name === 'dist') continue
          const abs = path.join(dir, name)
          const rel = relBase ? `${relBase}/${name}` : name
          let st: fs.Stats
          try {
            st = fs.statSync(abs)
          } catch {
            continue
          }
          if (st.isDirectory()) {
            walk(abs, rel)
            continue
          }
          if (!st.isFile() || st.size > MAX_FILE_BYTES) continue
          const ext = path.extname(name).toLowerCase()
          const base = name.toLowerCase()
          const isContext = CONTEXT_FILE_CANDIDATES.some((c) => c.fileName === name)
          if (!isContext && !TEXT_EXT.has(ext) && !base.endsWith('.md')) continue
          try {
            out[rel] = fs.readFileSync(abs, 'utf8')
          } catch {
            /* skip */
          }
        }
      }
      walk(root, '')
      return out
    },
    applySnapshot(files: Record<string, string>) {
      const written: string[] = []
      const previous = this.snapshotTextFiles()
      for (const [rel, content] of Object.entries(files)) {
        this.writeFile(rel, content)
        written.push(rel)
      }
      const removed: string[] = []
      for (const rel of Object.keys(previous)) {
        if (rel in files) continue
        // Only remove previously snapshotted text files still present
        const abs = resolveUnderRoot(root, rel)
        if (abs && fs.existsSync(abs)) {
          try {
            fs.unlinkSync(abs)
            removed.push(rel)
          } catch {
            /* ignore */
          }
        }
      }
      return { written, removed }
    },
    discoverContextFiles() {
      const found: DiscoveredContextFile[] = []
      for (const candidate of CONTEXT_FILE_CANDIDATES) {
        const content = this.readFile(candidate.fileName)
        if (content == null || content === '') continue
        found.push({
          kind: candidate.kind,
          fileName: candidate.fileName,
          relativePath: candidate.fileName,
          content: content.length > MAX_FILE_BYTES
            ? `${content.slice(0, MAX_FILE_BYTES)}\n…[truncated]`
            : content,
        })
      }
      return found
    },
  }
}

/** In-memory FS for tests — same contract as node FS. */
export function createMemoryWorkspaceFs(
  initial: Record<string, string> = {},
  root = '/virtual-workspace',
): WorkspaceFs {
  const files = { ...initial }
  return {
    root,
    readFile(relativePath: string) {
      if (!isSafeRelative(relativePath)) return null
      return files[relativePath] ?? null
    },
    writeFile(relativePath: string, content: string) {
      if (!isSafeRelative(relativePath)) throw new Error(`Unsafe path: ${relativePath}`)
      files[relativePath] = content
    },
    listFolder(relativePath: string) {
      if (!isSafeRelative(relativePath) && relativePath !== '.' && relativePath !== '') return null
      const prefix = !relativePath || relativePath === '.' ? '' : relativePath.replace(/\/$/, '') + '/'
      const names = new Set<string>()
      for (const key of Object.keys(files)) {
        if (prefix && !key.startsWith(prefix)) continue
        const rest = prefix ? key.slice(prefix.length) : key
        if (!rest) continue
        names.add(rest.split('/')[0]!)
      }
      return [...names]
    },
    snapshotTextFiles() {
      return { ...files }
    },
    applySnapshot(next) {
      const removed = Object.keys(files).filter((k) => !(k in next))
      for (const k of Object.keys(files)) delete files[k]
      Object.assign(files, next)
      return { written: Object.keys(next), removed }
    },
    discoverContextFiles() {
      const found: DiscoveredContextFile[] = []
      for (const candidate of CONTEXT_FILE_CANDIDATES) {
        const content = files[candidate.fileName]
        if (content == null || content === '') continue
        found.push({
          kind: candidate.kind,
          fileName: candidate.fileName,
          relativePath: candidate.fileName,
          content,
        })
      }
      return found
    },
  }
}

export function resolveWorkspaceRootFromConversation(workspaceContext?: {
  vpsWorkingPath?: string | null
  localWorkingPath?: string | null
  vpsPath?: string | null
  localPath?: string | null
} | null): string | null {
  if (!workspaceContext) return null
  const candidates = [
    workspaceContext.localWorkingPath,
    workspaceContext.vpsWorkingPath,
    workspaceContext.localPath,
    workspaceContext.vpsPath,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      const resolved = path.resolve(c.trim())
      if (fs.existsSync(resolved)) return resolved
    }
  }
  return null
}
