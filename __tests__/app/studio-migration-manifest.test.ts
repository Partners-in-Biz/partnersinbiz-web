import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { buildManifest, listAppTargets } from '@/scripts/studio-migration-manifest'

const root = process.cwd()
const manifestPath = path.join(root, 'docs/studio-migration/pages.json')

describe('studio migration manifest', () => {
  it('every target file on disk is in the manifest and every entry exists', () => {
    expect(existsSync(manifestPath)).toBe(true)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
      string,
      { status: string; batch: string; note: string }
    >
    const onDisk = listAppTargets()

    for (const file of onDisk) {
      expect(manifest[file]).toBeDefined()
      expect(['todo', 'done', 'na']).toContain(manifest[file].status)
    }

    for (const file of Object.keys(manifest)) {
      expect(existsSync(path.join(root, file))).toBe(true)
    }

    // Rebuilding preserves entries and covers the same set.
    const rebuilt = buildManifest(manifest)
    expect(Object.keys(rebuilt).sort()).toEqual(Object.keys(manifest).sort())
  })

  it('requires zero todo when STUDIO_MIGRATION_COMPLETE=1', () => {
    if (process.env.STUDIO_MIGRATION_COMPLETE !== '1') return
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, { status: string }>
    const todos = Object.entries(manifest).filter(([, e]) => e.status === 'todo')
    expect(todos).toEqual([])
  })
})
