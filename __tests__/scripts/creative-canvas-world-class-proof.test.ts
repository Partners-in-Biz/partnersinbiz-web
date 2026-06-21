import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

describe('creative-canvas-world-class-proof script', () => {
  it('prints usage when preview URL is missing', () => {
    const result = spawnSync('node', [join(process.cwd(), 'scripts/creative-canvas-world-class-proof.mjs')], {
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Usage: node scripts/creative-canvas-world-class-proof.mjs --preview-url PREVIEW_URL')
  })
})
