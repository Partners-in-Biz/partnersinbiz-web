import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  buildContract,
  extractPromises,
  buildReviewerPrompt,
  resolveScreenshots,
} from '../../../lib/design-finish-gate/contract'
import { FINISH_GATE_SCHEMA, REVIEWER_PROMPT_SCHEMA, DEFAULT_MAX_FIX_ROUNDS } from '../../../lib/design-finish-gate/types'

describe('finish-gate contract', () => {
  it('extracts promise bullets from a brief with commitment verbs', () => {
    const brief = [
      '# Redesign the landing page',
      '- Add a hero section with the brand palette',
      '- Ensure WCAG AA contrast on body text',
      '- Ship the mobile nav drawer',
      'Some prose that is not a bullet.',
      '- Implement the pricing toggle',
    ].join('\n')
    const promises = extractPromises(brief)
    expect(promises.map((p) => p.label)).toEqual([
      'Add a hero section with the brand palette',
      'Ensure WCAG AA contrast on body text',
      'Ship the mobile nav drawer',
      'Implement the pricing toggle',
    ])
    expect(promises[0].id).toBe('p1')
  })

  it('skips structural bullets (scope/status/source) and short lines', () => {
    const brief = [
      '- Scope: portal only',
      '- Status: open',
      '- hi',
      '- Use the design context palette',
    ].join('\n')
    const promises = extractPromises(brief)
    expect(promises.map((p) => p.label)).toEqual(['Use the design context palette'])
  })

  it('builds a contract with a self-contained fresh-reviewer prompt', () => {
    const contract = buildContract({
      title: 'Hero audit',
      brief: '- Add a hero with the brand palette',
      builderAgentId: 'theo',
      screenshots: ['/tmp/shot.png'],
      round: 1,
      maxFixRounds: 2,
    })
    expect(contract.schema).toBe(FINISH_GATE_SCHEMA)
    expect(contract.promises).toHaveLength(1)
    expect(contract.round).toBe(1)
    expect(contract.maxFixRounds).toBe(DEFAULT_MAX_FIX_ROUNDS)
    expect(contract.reviewerPrompt).toContain(REVIEWER_PROMPT_SCHEMA)
    expect(contract.reviewerPrompt).toContain('FRESH design reviewer')
    expect(contract.reviewerPrompt).toContain('/tmp/shot.png')
    expect(contract.reviewerPrompt).toContain('promiseScores')
    expect(contract.reviewerPrompt).toContain('never grade your own work')
  })

  it('prefers explicit promises over brief extraction', () => {
    const contract = buildContract({
      title: 'T',
      brief: '- Add hero',
      promises: [{ id: 'p1', label: 'Explicit promise', contract: 'Explicit bar' }],
      builderAgentId: 'theo',
    })
    expect(contract.promises).toHaveLength(1)
    expect(contract.promises[0].label).toBe('Explicit promise')
    expect(contract.promises[0].contract).toBe('Explicit bar')
  })

  it('resolveScreenshots keeps existing absolute paths only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-gate-'))
    const existing = path.join(dir, 'a.png')
    fs.writeFileSync(existing, 'x')
    const resolved = resolveScreenshots([existing, '/nonexistent/missing.png'])
    expect(resolved).toEqual([existing])
    expect(resolved[0]).toBe(path.resolve(existing))
  })

  it('reviewer prompt includes vision transcripts when supplied', () => {
    const contract = buildContract({
      title: 'T',
      brief: '- Add hero',
      builderAgentId: 'theo',
      screenshots: ['/tmp/a.png'],
      visionTranscripts: { '/tmp/a.png': 'summary: a hero section with brand palette colors' },
    })
    expect(contract.reviewerPrompt).toContain('Vision transcripts')
    expect(contract.reviewerPrompt).toContain('summary: a hero section with brand palette colors')
  })
})
