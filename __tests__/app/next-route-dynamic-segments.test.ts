import fs from 'fs'
import path from 'path'

function walkDirs(root: string): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true })
  const dirs: string[] = [root]

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue
    dirs.push(...walkDirs(path.join(root, entry.name)))
  }

  return dirs
}

function routeKeyFor(dir: string, appRoot: string): string {
  return path
    .relative(appRoot, dir)
    .split(path.sep)
    .map((segment) => (segment.startsWith('[') && segment.endsWith(']') ? '[]' : segment))
    .join('/')
}

describe('Next app route tree', () => {
  it('uses one dynamic segment name for each route shape', () => {
    const appRoot = path.join(process.cwd(), 'app')
    const dynamicNamesByRouteShape = new Map<string, Set<string>>()

    for (const dir of walkDirs(appRoot)) {
      const segment = path.basename(dir)
      if (!segment.startsWith('[') || !segment.endsWith(']')) continue

      const routeKey = routeKeyFor(dir, appRoot)
      const names = dynamicNamesByRouteShape.get(routeKey) ?? new Set<string>()
      names.add(segment)
      dynamicNamesByRouteShape.set(routeKey, names)
    }

    const conflicts = [...dynamicNamesByRouteShape.entries()]
      .filter(([, names]) => names.size > 1)
      .map(([routeKey, names]) => `${routeKey}: ${[...names].sort().join(', ')}`)

    expect(conflicts).toEqual([])
  })
})
