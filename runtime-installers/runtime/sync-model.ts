import { createHash } from 'node:crypto'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SHA256 = /^[a-f0-9]{64}$/
const MAX_ENTRIES = 1_000
const MAX_FILE_BYTES = 100 * 1024 * 1024
const MAX_MANIFEST_BYTES = 100 * 1024 * 1024

export type ProjectManifestEntry =
  | { type: 'file'; path: string; sha256: string; size: number; executable?: true }
  | { type: 'directory'; path: string; size: 0; sha256?: never }

export interface ProjectContentManifest {
  version: 1
  projectId: string
  entries: ProjectManifestEntry[]
  entryCount: number
  totalBytes: number
  revision: string
}

function projectId(value: string): string {
  const clean = value.trim()
  if (!SAFE_ID.test(clean)) throw new Error('projectId is invalid')
  return clean
}

function manifestPath(value: string): string {
  const clean = value.trim()
  if (!clean || clean.length > 1024 || clean.startsWith('/') || clean.startsWith('~')
    || clean.includes('\\') || /[\u0000-\u001f]/.test(clean)) throw new Error('path is not eligible for project sync')
  const segments = clean.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) throw new Error('path is not eligible for project sync')
  const lower = segments.map((segment) => segment.toLowerCase())
  const unsupportedPortableSegment = segments.some((segment) => {
    const normalized = segment.normalize('NFC')
    const stem = normalized.split('.')[0].toUpperCase()
    return normalized !== segment || Buffer.byteLength(normalized, 'utf8') > 255
      || /[<>:"|?*]/.test(normalized) || /[. ]$/.test(normalized)
      || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)
  })
  const name = lower.at(-1) ?? ''
  const forbiddenSegment = lower.some((segment) => ['.git', 'node_modules', '.pib-sync', '.partnersinbiz'].includes(segment))
  const forbiddenName = name === '.env' || name.startsWith('.env.')
    || ['id_rsa', 'id_ed25519', 'credentials.json', 'service-account.json'].includes(name)
    || /\.(?:pem|key|p12|pfx)$/.test(name)
  if (forbiddenSegment || forbiddenName) throw new Error('path is not eligible for project sync')
  if (unsupportedPortableSegment) throw new Error('project sync path is not portable across linked computers')
  return segments.join('/')
}

export function buildProjectContentManifest(input: {
  projectId: string
  entries: ProjectManifestEntry[]
}): ProjectContentManifest {
  const id = projectId(input.projectId)
  if (!Array.isArray(input.entries) || input.entries.length > MAX_ENTRIES) throw new Error(`project sync manifest exceeds ${MAX_ENTRIES} entries`)
  const seen = new Set<string>()
  const portableSeen = new Set<string>()
  let totalBytes = 0
  const entries = input.entries.map((entry): ProjectManifestEntry => {
    const entryPath = manifestPath(entry.path)
    if (seen.has(entryPath)) throw new Error('project sync manifest contains a duplicate path')
    seen.add(entryPath)
    const portableKey = entryPath.normalize('NFC').toLocaleLowerCase('en-US')
    if (portableSeen.has(portableKey)) throw new Error('project sync manifest contains a cross-platform path collision')
    portableSeen.add(portableKey)
    if (entry.type === 'directory') {
      if (entry.size !== 0 || 'sha256' in entry && entry.sha256 !== undefined) throw new Error('project sync directory entries cannot contain file content')
      return { type: 'directory', path: entryPath, size: 0 }
    }
    const sha256 = entry.sha256.toLowerCase()
    if (!SHA256.test(sha256)) throw new Error('project sync file sha256 is invalid')
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_FILE_BYTES) throw new Error('project sync maximum file size is 100 MiB')
    if (entry.executable !== undefined && entry.executable !== true) throw new Error('project sync executable flag is invalid')
    totalBytes += entry.size
    if (totalBytes > MAX_MANIFEST_BYTES) throw new Error('project sync manifest exceeds its maximum total size')
    return { type: 'file', path: entryPath, sha256, size: entry.size, ...(entry.executable ? { executable: true as const } : {}) }
  }).sort((left, right) => left.path.localeCompare(right.path))
  const revision = createHash('sha256').update(JSON.stringify({ version: 1, projectId: id, entries })).digest('hex')
  return { version: 1, projectId: id, entries, entryCount: entries.length, totalBytes, revision }
}
