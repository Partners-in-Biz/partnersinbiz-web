import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { interpolateKeyframes } from '@/lib/video-editor/keyframes'
import { rampSegments, sourceOffsetAt } from '@/lib/video-editor/speed-ramps'
import type { EditorClip, EditorKeyframe } from '@/lib/video-editor/types'

const modulePath = join(process.cwd(), 'scripts/higgsfield-executor/lib/editor-keyframes.mjs')

function runModule<T>(code: string): T {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import * as m from ${JSON.stringify(`file://${modulePath}`)};
    const result = await (async () => { ${code} })();
    process.stdout.write(JSON.stringify(result));
  `], { encoding: 'utf8' })
  return JSON.parse(stdout) as T
}

const opacityFrames: EditorKeyframe[] = [
  { property: 'transform.opacity', atSeconds: 0, value: 1, easing: 'ease_in_out' },
  { property: 'transform.opacity', atSeconds: 2, value: 0.2, easing: 'bezier', bezier: [0.3, 0, 0.7, 1] },
  { property: 'transform.opacity', atSeconds: 5, value: 0.9 },
]

const rampedClip: EditorClip = {
  id: 'c',
  timelineStart: 0,
  duration: 6,
  keyframes: [
    { property: 'speed', atSeconds: 0, value: 1, easing: 'ease_out' },
    { property: 'speed', atSeconds: 2, value: 0.3, easing: 'linear' },
    { property: 'speed', atSeconds: 4, value: 0.3, easing: 'ease_in' },
    { property: 'speed', atSeconds: 6, value: 1 },
  ],
}

describe('TS ↔ executor mjs parity', () => {
  it('interpolates identical values at 25 sample points', () => {
    const times = Array.from({ length: 25 }, (_, i) => i * 0.25)
    const mjs = runModule<number[]>(`return ${JSON.stringify(times)}.map((t) => m.interpolateKeyframes(${JSON.stringify(opacityFrames)}, 'transform.opacity', t, 1))`)
    times.forEach((t, i) => {
      expect(mjs[i]).toBeCloseTo(interpolateKeyframes(opacityFrames, 'transform.opacity', t, 1), 6)
    })
  })

  it('produces identical ramp segments and source offsets', () => {
    const mjsSegments = runModule<ReturnType<typeof rampSegments>>(`return m.rampSegments(${JSON.stringify(rampedClip)}, 4)`)
    expect(mjsSegments).toEqual(rampSegments(rampedClip, 4))
    const mjsOffset = runModule<number>(`return m.sourceOffsetAt(${JSON.stringify(rampedClip)}, 5)`)
    expect(mjsOffset).toBeCloseTo(sourceOffsetAt(rampedClip, 5), 6)
  })
})
