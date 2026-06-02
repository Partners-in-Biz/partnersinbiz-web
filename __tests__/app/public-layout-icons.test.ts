import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('public layout icon subset', () => {
  it('loads the Material Symbols used by the Gauteng audit page', () => {
    const layoutSource = readFileSync(
      path.join(process.cwd(), 'app/(public)/layout.tsx'),
      'utf8'
    )

    for (const iconName of [
      'arrow_downward',
      'arrow_upward',
      'campaign',
      'language',
      'search',
      'warning',
    ]) {
      expect(layoutSource).toContain(iconName)
    }
  })
})
