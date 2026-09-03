import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { compareToBaseline, scanStyleDebt } from '@/scripts/studio-style-baseline'

const root = process.cwd()
const baselinePath = path.join(root, 'docs/studio-migration/style-baseline.json')

describe('studio style lint ratchet', () => {
  it('keeps banned-class counts at or below the baseline', () => {
    expect(existsSync(baselinePath)).toBe(true)
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, number>
    const current = scanStyleDebt()
    const { regressions } = compareToBaseline(current, baseline)

    // Files not in the baseline must be zero (compareToBaseline treats missing baseline as 0).
    expect(regressions).toEqual([])
  })
})
