import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const modulePath = join(process.cwd(), 'scripts/higgsfield-executor/lib/editor-keyframes.mjs')

function runModule<T>(code: string): T {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import * as m from ${JSON.stringify(`file://${modulePath}`)};
    const result = await (async () => { ${code} })();
    process.stdout.write(JSON.stringify(result));
  `], { encoding: 'utf8' })
  return JSON.parse(stdout) as T
}

describe('keyframeExpr', () => {
  it('builds a piecewise-linear ffmpeg expression for linear keyframes', () => {
    const expr = runModule<string>(`return m.keyframeExpr(${JSON.stringify([
      { property: 'volume', atSeconds: 0, value: 1 },
      { property: 'volume', atSeconds: 2, value: 0 },
    ])}, 1, 't')`)
    expect(expr).toBe('if(lt(t,0),1,if(lt(t,2),1+(0-1)*(t-0)/2,0))')
  })

  it('pre-samples eased segments into 8 linear sub-segments', () => {
    const expr = runModule<string>(`return m.keyframeExpr(${JSON.stringify([
      { property: 'transform.x', atSeconds: 0, value: 0, easing: 'ease_in' },
      { property: 'transform.x', atSeconds: 4, value: 100 },
    ])}, 0, '(t-3)')`)
    // 8 sub-segments → 9 breakpoints → 8 nested lerps + 1 before-first guard
    expect(expr.match(/if\(lt\(/g)?.length).toBe(9)
    expect(expr).toContain('(t-3)')
    expect(expr).toMatch(/,100\)+$/) // constant after the last breakpoint
  })

  it('returns a constant for a single keyframe', () => {
    expect(runModule<string>(`return m.keyframeExpr(${JSON.stringify([
      { property: 'volume', atSeconds: 1, value: 0.5 },
    ])}, 1, 't')`)).toBe('0.5')
  })
})

describe('sendcmdOpacityCommands', () => {
  it('samples opacity keyframes every 0.25s with deduped values', () => {
    const commands = runModule<string>(`return m.sendcmdOpacityCommands(${JSON.stringify([
      { property: 'transform.opacity', atSeconds: 0, value: 1 },
      { property: 'transform.opacity', atSeconds: 1, value: 0 },
    ])}, 1, 'op0', 2, 0.25)`)
    expect(commands).toBe([
      '0 colorchannelmixer@op0 aa 1',
      '0.25 colorchannelmixer@op0 aa 0.75',
      '0.5 colorchannelmixer@op0 aa 0.5',
      '0.75 colorchannelmixer@op0 aa 0.25',
      '1 colorchannelmixer@op0 aa 0',
    ].join(';'))
  })
})

describe('rampSegments (mjs)', () => {
  it('matches the TS segmentation for a linear ramp', () => {
    const segments = runModule<Array<{ speed: number; sourceDuration: number }>>(`return m.rampSegments(${JSON.stringify({
      id: 'c', timelineStart: 0, duration: 4,
      keyframes: [
        { property: 'speed', atSeconds: 0, value: 1 },
        { property: 'speed', atSeconds: 4, value: 2 },
      ],
    })}, 4)`)
    expect(segments.map((s) => s.speed)).toEqual([1.125, 1.375, 1.625, 1.875])
  })
})
