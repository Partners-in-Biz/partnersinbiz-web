import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  runVisionTranscript,
  buildVisionTranscripts,
  summarizeModLens,
  resolveDefaultModel,
  resolveDefaultProvider,
} from '../../../lib/design-finish-gate/vision'

function tmpPng(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-gate-vision-'))
  const file = path.join(dir, 'shot.png')
  fs.writeFileSync(file, 'fake-png')
  return file
}

describe('finish-gate vision (ModLens bridge)', () => {
  it('returns ok with transcript when the fake binary produces JSON', () => {
    const png = tmpPng()
    const result = runVisionTranscript(png, {
      _fakeStdout: JSON.stringify({
        provider: 'gemini-api',
        result: {
          summary: 'A hero section with brand palette',
          ocr: { full_text: 'Hero\nCTA' },
          layout: { regions: [{ kind: 'heading', label: 'hero', text: 'Welcome' }] },
          uncertainty: [],
        },
      }),
    })
    expect(result.ok).toBe(true)
    expect(result.transcript).toContain('provider=gemini-api')
    expect(result.transcript).toContain('A hero section with brand palette')
    expect(result.transcript).toContain('Hero\nCTA')
    expect(result.transcript).toContain('layout: heading hero: Welcome')
  })

  it('resolves default model/provider from the real modlens config when present', () => {
    // Config-aware resolution should not throw and returns a non-empty model.
    const model = resolveDefaultModel()
    const provider = resolveDefaultProvider()
    expect(typeof model).toBe('string')
    expect(model.length).toBeGreaterThan(0)
    expect(typeof provider).toBe('string')
    expect(provider.length).toBeGreaterThan(0)
  })

  it('fails closed with a note, never throws, on missing image', () => {
    const result = runVisionTranscript('/nonexistent/nope.png', { _fakeStdout: '{}' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not found')
    expect(result.transcript).toBe('')
  })

  it('gracefully reports a failing binary (no provider etc)', () => {
    const png = tmpPng()
    const result = runVisionTranscript(png, { binary: 'definitely-not-a-real-binary-xyz' })
    expect(result.ok).toBe(false)
    expect(result.error.length).toBeGreaterThan(0)
  })

  it('buildVisionTranscripts keys by path and collects notes', () => {
    const png = tmpPng()
    const { transcripts, notes } = buildVisionTranscripts([png, '/missing/x.png'], {
      _fakeStdout: JSON.stringify({ result: { summary: 'ok' } }),
    })
    expect(transcripts[png]).toContain('ok')
    expect(notes.some((n) => n.includes('not found'))).toBe(true)
  })

  it('summarizeModLens falls back to raw text for non-JSON output', () => {
    expect(summarizeModLens('not json at all')).toBe('not json at all')
    expect(summarizeModLens('x'.repeat(7000)).length).toBeLessThanOrEqual(6000)
  })
})
