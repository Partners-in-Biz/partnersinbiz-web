import { findManifestFile, manifestToWorkbenchFileTree, normalizeManifestPath } from '@/lib/messages/workbench/manifest-tree'
import type { ProjectManifestEntry } from '@/lib/project-sync/model'

describe('normalizeManifestPath', () => {
  it('accepts clean relative paths', () => {
    expect(normalizeManifestPath('src/index.ts')).toBe('src/index.ts')
    expect(normalizeManifestPath('README.md')).toBe('README.md')
  })

  it('rejects traversal, absolute and empty-segment paths', () => {
    expect(normalizeManifestPath('../secret.env')).toBeNull()
    expect(normalizeManifestPath('a/../b')).toBeNull()
    expect(normalizeManifestPath('/etc/passwd')).toBeNull()
    expect(normalizeManifestPath('~/secrets')).toBeNull()
    expect(normalizeManifestPath('a//b')).toBeNull()
    expect(normalizeManifestPath('a\\b')).toBeNull()
    expect(normalizeManifestPath('')).toBeNull()
    expect(normalizeManifestPath('   ')).toBeNull()
  })

  it('rejects Windows-style drive-letter paths', () => {
    expect(normalizeManifestPath('C:/Windows')).toBeNull()
  })
})

describe('manifestToWorkbenchFileTree', () => {
  it('builds a nested tree from flat manifest entries', () => {
    const entries: ProjectManifestEntry[] = [
      { type: 'directory', path: 'src', size: 0 },
      { type: 'file', path: 'src/index.ts', sha256: 'a'.repeat(64), size: 120 },
      { type: 'file', path: 'src/lib/util.ts', sha256: 'b'.repeat(64), size: 45 },
      { type: 'file', path: 'README.md', sha256: 'c'.repeat(64), size: 10 },
    ]

    const tree = manifestToWorkbenchFileTree(entries)

    expect(tree.map((node) => node.name)).toEqual(['src', 'README.md'])
    const src = tree.find((node) => node.name === 'src')!
    expect(src.kind).toBe('directory')
    expect(src.children?.map((node) => node.name)).toEqual(['lib', 'index.ts'])
    const lib = src.children!.find((node) => node.name === 'lib')!
    expect(lib.kind).toBe('directory')
    expect(lib.children?.[0]).toEqual({ name: 'util.ts', path: 'src/lib/util.ts', kind: 'file', children: undefined })
  })

  it('synthesizes intermediate directories that have no explicit manifest entry', () => {
    const entries: ProjectManifestEntry[] = [
      { type: 'file', path: 'a/b/c.txt', sha256: 'd'.repeat(64), size: 1 },
    ]

    const tree = manifestToWorkbenchFileTree(entries)

    expect(tree).toEqual([
      {
        name: 'a',
        path: 'a',
        kind: 'directory',
        children: [
          {
            name: 'b',
            path: 'a/b',
            kind: 'directory',
            children: [{ name: 'c.txt', path: 'a/b/c.txt', kind: 'file', children: undefined }],
          },
        ],
      },
    ])
  })

  it('skips entries with unsafe paths', () => {
    const entries: ProjectManifestEntry[] = [
      { type: 'file', path: '../escape.txt', sha256: 'e'.repeat(64), size: 1 },
      { type: 'file', path: 'ok.txt', sha256: 'f'.repeat(64), size: 1 },
    ]

    const tree = manifestToWorkbenchFileTree(entries)

    expect(tree).toEqual([{ name: 'ok.txt', path: 'ok.txt', kind: 'file', children: undefined }])
  })

  it('sorts directories before files, then alphabetically', () => {
    const entries: ProjectManifestEntry[] = [
      { type: 'file', path: 'zeta.txt', sha256: 'a'.repeat(64), size: 1 },
      { type: 'directory', path: 'alpha', size: 0 },
      { type: 'file', path: 'beta.txt', sha256: 'b'.repeat(64), size: 1 },
    ]

    const tree = manifestToWorkbenchFileTree(entries)

    expect(tree.map((node) => node.name)).toEqual(['alpha', 'beta.txt', 'zeta.txt'])
  })
})

describe('findManifestFile', () => {
  const entries: ProjectManifestEntry[] = [
    { type: 'directory', path: 'src', size: 0 },
    { type: 'file', path: 'src/index.ts', sha256: 'a'.repeat(64), size: 120 },
  ]

  it('finds a file entry by relative path', () => {
    expect(findManifestFile(entries, 'src/index.ts')).toEqual(entries[1])
  })

  it('returns null for directories, missing files and unsafe paths', () => {
    expect(findManifestFile(entries, 'src')).toBeNull()
    expect(findManifestFile(entries, 'src/missing.ts')).toBeNull()
    expect(findManifestFile(entries, '../src/index.ts')).toBeNull()
  })
})
