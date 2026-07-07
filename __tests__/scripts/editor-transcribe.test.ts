import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const modulePath = join(process.cwd(), 'scripts/higgsfield-executor/lib/editor-transcribe.mjs')

function runModule<T>(code: string): T {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import * as m from ${JSON.stringify(`file://${modulePath}`)};
    const result = await (async () => { ${code} })();
    process.stdout.write(JSON.stringify(result));
  `], { encoding: 'utf8' })
  return JSON.parse(stdout) as T
}

describe('editor-transcribe helpers', () => {
  it('builds mono 16k mp3 extraction args', () => {
    expect(runModule<string[]>(`return m.audioExtractArgs('/tmp/in.mp4', '/tmp/audio.mp3')`)).toEqual([
      '-y', '-i', '/tmp/in.mp4', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k', '/tmp/audio.mp3',
    ])
  })

  it('maps whisper verbose_json into word-filled segments', () => {
    const payload = {
      language: 'english',
      duration: 4.2,
      segments: [
        { id: 0, start: 0, end: 2.0, text: ' Hello world ' },
        { id: 1, start: 2.5, end: 4.2, text: ' Second line ' },
      ],
      words: [
        { word: 'Hello', start: 0.1, end: 0.6 },
        { word: 'world', start: 0.7, end: 1.4 },
        { word: 'Second', start: 2.5, end: 3.0 },
        { word: 'line', start: 3.1, end: 3.9 },
      ],
    }
    const result = runModule<{
      language: string
      durationSeconds: number
      segments: Array<{ id: string; start: number; end: number; text: string; words: Array<{ text: string; start: number; end: number }> }>
    }>(`return m.segmentsFromVerboseJson(${JSON.stringify(payload)})`)
    expect(result.language).toBe('english')
    expect(result.durationSeconds).toBe(4.2)
    expect(result.segments).toEqual([
      { id: 'seg-0', start: 0, end: 2, text: 'Hello world', words: [
        { text: 'Hello', start: 0.1, end: 0.6 }, { text: 'world', start: 0.7, end: 1.4 },
      ] },
      { id: 'seg-1', start: 2.5, end: 4.2, text: 'Second line', words: [
        { text: 'Second', start: 2.5, end: 3 }, { text: 'line', start: 3.1, end: 3.9 },
      ] },
    ])
  })

  it('tolerates payloads without word granularity', () => {
    const result = runModule<{ segments: Array<{ words: unknown[] }> }>(
      `return m.segmentsFromVerboseJson({ segments: [{ id: 0, start: 0, end: 1, text: 'Hi' }] })`,
    )
    expect(result.segments[0].words).toEqual([])
  })
})
