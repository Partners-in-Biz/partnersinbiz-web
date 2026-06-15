import { readFileSync } from 'node:fs'
import path from 'node:path'

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('native select dropdown theme', () => {
  it('keeps native dropdown option menus dark and readable across portal selects', () => {
    const css = source('app/globals.css')

    expect(css).toContain('--color-pib-card:')
    expect(css).toContain('select option')
    expect(css).toContain('select optgroup')
    expect(css).toContain('background: var(--color-pib-card)')
    expect(css).toContain('color: var(--color-pib-text)')
    expect(css).toContain('select option:checked')
    expect(css).toContain('background: var(--color-pib-accent)')
    expect(css).toContain('color: #050505')
  })
})
