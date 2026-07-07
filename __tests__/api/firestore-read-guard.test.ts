import { execFileSync } from 'node:child_process'
import path from 'node:path'

describe('portal Firestore read-pattern guard', () => {
  it('keeps dashboard/list routes from reintroducing unbounded limit probes', () => {
    const repoRoot = path.resolve(__dirname, '../..')
    expect(() => {
      execFileSync('node', ['scripts/audit-firestore-read-patterns.mjs'], {
        cwd: repoRoot,
        stdio: 'pipe',
      })
    }).not.toThrow()
  })
})
