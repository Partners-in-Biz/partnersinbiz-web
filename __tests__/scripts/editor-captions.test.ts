import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { EDITOR_CAPTION_STYLE_PRESETS } from '@/lib/video-editor/types'

const modulePath = join(process.cwd(), 'scripts/higgsfield-executor/lib/editor-captions.mjs')

function runModule<T>(code: string): T {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import * as m from ${JSON.stringify(`file://${modulePath}`)};
    const result = await (async () => { ${code} })();
    process.stdout.write(JSON.stringify(result));
  `], { encoding: 'utf8' })
  return JSON.parse(stdout) as T
}

const settings = { width: 1280, height: 720, fps: 30, background: '#000000' }

function captionTimeline(animationPreset: string) {
  return {
    version: 1,
    tracks: [{
      id: 'track-caption-1', kind: 'caption',
      clips: [{
        id: 'cue-1', timelineStart: 1, duration: 2,
        caption: {
          text: 'Hello world', stylePreset: 'clean', animationPreset,
          words: [
            { text: 'Hello', offsetStart: 0, offsetEnd: 0.5 },
            { text: 'world', offsetStart: 0.7, offsetEnd: 1.2 },
          ],
        },
      }],
    }],
  }
}

describe('editor-captions .ass builder', () => {
  it('style preset names match the TS registry', () => {
    const names = runModule<string[]>('return Object.keys(m.ASS_STYLE_PRESETS)')
    expect(names.sort()).toEqual([...EDITOR_CAPTION_STYLE_PRESETS].sort())
  })

  it('formats ASS timestamps', () => {
    expect(runModule<string>('return m.assTimestamp(0)')).toBe('0:00:00.00')
    expect(runModule<string>('return m.assTimestamp(3661.25)')).toBe('1:01:01.25')
  })

  it('escapes ASS text', () => {
    expect(runModule<string>('return m.escapeAssText("a{b}\\nc")')).toBe('a\\{b\\}\\Nc')
  })

  it('builds a plain dialogue document (golden)', () => {
    const ass = runModule<string>(`return m.buildAssDocument({ timeline: ${JSON.stringify(captionTimeline('none'))}, settings: ${JSON.stringify(settings)} })`)
    expect(ass).toContain('PlayResX: 1280')
    expect(ass).toContain('PlayResY: 720')
    expect(ass).toContain('Style: clean,DejaVu Sans,')
    expect(ass).toContain('Dialogue: 0,0:00:01.00,0:00:03.00,clean,,0,0,0,,Hello world')
  })

  it('emits karaoke \\kf tags from word offsets (golden)', () => {
    const ass = runModule<string>(`return m.buildAssDocument({ timeline: ${JSON.stringify(captionTimeline('karaoke'))}, settings: ${JSON.stringify(settings)} })`)
    // Hello: 0.5s → 50cs; gap 0.2s folded into next word lead-in; world: 0.5s → 50cs
    expect(ass).toContain('{\\kf50}Hello {\\kf20}{\\kf50}world')
  })

  it('emits pop animation override tags (golden)', () => {
    const ass = runModule<string>(`return m.buildAssDocument({ timeline: ${JSON.stringify(captionTimeline('pop'))}, settings: ${JSON.stringify(settings)} })`)
    expect(ass).toContain('{\\fscx60\\fscy60\\t(0,120,\\fscx105\\fscy105)\\t(120,200,\\fscx100\\fscy100)}Hello world')
  })

  it('escapes subtitles filter paths', () => {
    expect(runModule<string>(`return m.escapeSubtitlesPath("/tmp/dir:with 'quote'/captions.ass")`))
      .toBe("'/tmp/dir\\:with '\\\\''quote'\\\\''/captions.ass'")
  })

  it('reports whether a timeline has caption cues', () => {
    expect(runModule<boolean>(`return m.timelineHasCaptions(${JSON.stringify(captionTimeline('none'))})`)).toBe(true)
    expect(runModule<boolean>('return m.timelineHasCaptions({ version: 1, tracks: [] })')).toBe(false)
  })
})
