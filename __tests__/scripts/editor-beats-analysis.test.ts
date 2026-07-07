import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const modulePath = join(process.cwd(), 'scripts/higgsfield-executor/lib/editor-beats.mjs')

function runModule<T>(code: string): T {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import * as m from ${JSON.stringify(`file://${modulePath}`)};
    const result = await (async () => { ${code} })();
    process.stdout.write(JSON.stringify(result));
  `], { encoding: 'utf8' })
  return JSON.parse(stdout) as T
}

describe('beat onset analysis', () => {
  it('detects clicks at 120 BPM in synthetic PCM and estimates bpm', () => {
    const result = runModule<{ beats: number[]; bpm: number }>(`
      const rate = 8000
      const seconds = 8
      const samples = new Int16Array(rate * seconds)
      for (let beat = 0; beat < 16; beat += 1) {
        const start = Math.round(beat * 0.5 * rate)
        for (let i = 0; i < rate * 0.05; i += 1) samples[start + i] = (i % 2 === 0 ? 20000 : -20000)
      }
      return m.analyzeBeatsFromPcm(Buffer.from(samples.buffer), rate)
    `)

    expect(result.bpm).toBeGreaterThanOrEqual(115)
    expect(result.bpm).toBeLessThanOrEqual(125)
    expect(result.beats.length).toBeGreaterThanOrEqual(14)
    expect(result.beats.length).toBeLessThanOrEqual(18)
    expect(Math.abs(result.beats[0])).toBeLessThan(0.15)
    expect(Math.abs(result.beats[1] - 0.5)).toBeLessThan(0.15)
  })

  it('returns empty results for silence', () => {
    const result = runModule<{ beats: number[]; bpm: number }>(`
      return m.analyzeBeatsFromPcm(Buffer.alloc(8000 * 4 * 2), 8000)
    `)

    expect(result.beats).toEqual([])
    expect(result.bpm).toBe(0)
  })

  it('handles sliced buffers with odd byte offsets', () => {
    const result = runModule<{ beats: number[]; bpm: number }>(`
      const rate = 8000
      const samples = new Int16Array(rate * 2)
      for (let beat = 0; beat < 4; beat += 1) {
        const start = Math.round(beat * 0.5 * rate)
        for (let i = 0; i < rate * 0.05; i += 1) samples[start + i] = 20000
      }
      const raw = Buffer.concat([Buffer.from([255]), Buffer.from(samples.buffer)])
      return m.analyzeBeatsFromPcm(raw.subarray(1), rate)
    `)

    expect(result.beats.length).toBeGreaterThanOrEqual(3)
  })

  it('builds ffmpeg PCM decode args', () => {
    expect(runModule<string[]>(`return m.buildPcmDecodeArgs('/w/in.mp4', '/w/audio.pcm')`)).toEqual([
      '-y', '-i', '/w/in.mp4', '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '/w/audio.pcm',
    ])
  })
})
