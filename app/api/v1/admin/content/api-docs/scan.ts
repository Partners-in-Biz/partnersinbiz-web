import fs from 'fs'
import path from 'path'

export interface ApiEndpoint {
  method: string
  path: string
  group: string
}

const HTTP_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const

/**
 * Recursively collect all `route.ts` / `route.tsx` file paths under `dir`.
 */
function collectRouteFiles(dir: string): string[] {
  const out: string[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectRouteFiles(full))
    } else if (entry.isFile() && (entry.name === 'route.ts' || entry.name === 'route.tsx')) {
      out.push(full)
    }
  }
  return out
}

/**
 * Detect which HTTP methods a route file exports. Matches both
 * `export const GET = ...` and `export async function GET(...)` styles.
 */
function detectMethods(fileText: string): string[] {
  const found: string[] = []
  for (const method of HTTP_METHODS) {
    const re = new RegExp(`export\\s+(?:const|async\\s+function|function)\\s+${method}\\b`)
    if (re.test(fileText)) found.push(method)
  }
  return found
}

/**
 * Convert a route directory (absolute) into a public URL path.
 * `.../app/api/v1/admin/plans` -> `/api/v1/admin/plans`
 * Next dynamic segments: `[id]` -> `:id`, `[...slug]` -> `*slug`.
 */
function dirToUrlPath(routeDir: string, appDir: string): string {
  const rel = path.relative(appDir, routeDir)
  const posix = rel.split(path.sep).join('/')
  const segments = posix
    .split('/')
    .filter((s) => s.length > 0)
    .map((seg) => {
      const catchAll = seg.match(/^\[\.\.\.(.+)\]$/)
      if (catchAll) return `*${catchAll[1]}`
      const dynamic = seg.match(/^\[(.+)\]$/)
      if (dynamic) return `:${dynamic[1]}`
      return seg
    })
  return '/' + segments.join('/')
}

/**
 * Derive a deterministic group from a URL path. The group is the first
 * segment after `/api/v1/`; when that segment is `admin` and a further
 * segment exists, the group becomes `admin/<next>`.
 */
function deriveGroup(urlPath: string): string {
  const segments = urlPath.split('/').filter((s) => s.length > 0)
  // segments: ['api', 'v1', <first>, <next>, ...]
  const first = segments[2] ?? ''
  if (!first) return 'root'
  if (first === 'admin') {
    const next = segments[3]
    if (next && !next.startsWith(':') && !next.startsWith('*')) {
      return `admin/${next}`
    }
    return 'admin'
  }
  return first
}

/**
 * Scan the filesystem under `app/api/v1` and enumerate every route handler
 * and the HTTP methods it exports. Returns a flat, deduped, sorted list.
 */
export function scanApiRoutes(): ApiEndpoint[] {
  const appDir = path.join(process.cwd(), 'app')
  const baseDir = path.join(appDir, 'api', 'v1')

  const endpoints: ApiEndpoint[] = []
  const seen = new Set<string>()

  let routeFiles: string[]
  try {
    routeFiles = collectRouteFiles(baseDir)
  } catch {
    return []
  }

  for (const file of routeFiles) {
    let text: string
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const methods = detectMethods(text)
    if (methods.length === 0) continue

    const urlPath = dirToUrlPath(path.dirname(file), appDir)
    const group = deriveGroup(urlPath)

    for (const method of methods) {
      const dedupeKey = `${method} ${urlPath}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      endpoints.push({ method, path: urlPath, group })
    }
  }

  endpoints.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1
    return a.method < b.method ? -1 : a.method > b.method ? 1 : 0
  })

  return endpoints
}
