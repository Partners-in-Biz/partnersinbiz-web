import { readFileSync } from 'node:fs'
import path from 'node:path'

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('native select dropdown theme', () => {
  it('keeps native dropdown option menus readable across portal selects', () => {
    const css = source('app/globals.css')

    expect(css).toContain('--color-pib-card:')
    expect(css).toContain('select option')
    expect(css).toContain('select optgroup')
    expect(css).toContain('background: var(--sc-surface)')
    expect(css).toContain('color: var(--sc-ink)')
    expect(css).toContain('select option:checked')
    expect(css).toContain('background: var(--sc-ink)')
    expect(css).toContain('color: var(--sc-canvas)')
  })
})
