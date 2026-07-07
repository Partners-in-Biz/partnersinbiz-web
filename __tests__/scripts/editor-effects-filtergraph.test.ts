import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const modulePath = join(process.cwd(), 'scripts/higgsfield-executor/lib/editor-filtergraph.mjs')

function runModule<T>(code: string): T {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import * as m from ${JSON.stringify(`file://${modulePath}`)};
    const result = await (async () => { ${code} })();
    process.stdout.write(JSON.stringify(result));
  `], { encoding: 'utf8' })
  return JSON.parse(stdout) as T
}

const settings = { width: 1280, height: 720, fps: 30, background: '#000000' }

function compile(clipExtras: Record<string, unknown>, compileExtras: Record<string, unknown> = {}) {
  return runModule<{ filterComplex: string }>(`return m.compileEditorFiltergraph(${JSON.stringify({
    settings,
    localMediaPaths: { c1: '/tmp/m/c1.mp4' },
    ...compileExtras,
    timeline: {
      version: 1,
      tracks: [{
        id: 't1', kind: 'video',
        clips: [{
          id: 'c1', timelineStart: 0, duration: 4,
          media: { type: 'upload', fileId: 'f1', url: 'https://x.test/a.mp4', mediaKind: 'video' },
          ...clipExtras,
        }],
      }],
    },
  })})`)
}

function compileError(clipExtras: Record<string, unknown>) {
  return runModule<string>(`try {
    m.compileEditorFiltergraph(${JSON.stringify({
      settings,
      localMediaPaths: { c1: '/tmp/m/c1.mp4' },
      timeline: {
        version: 1,
        tracks: [{
          id: 't1', kind: 'video',
          clips: [{
            id: 'c1', timelineStart: 0, duration: 4,
            media: { type: 'upload', fileId: 'f1', url: 'https://x.test/a.mp4', mediaKind: 'video' },
            ...clipExtras,
          }],
        }],
      },
    })})
    return 'ok'
  } catch (error) {
    return String(error.message)
  }`)
}

describe('filter effect compilation', () => {
  it('compiles color_adjust to eq + colortemperature + hue', () => {
    const { filterComplex } = compile({
      effects: [{ kind: 'color_adjust', params: { brightness: 0.1, contrast: 1.2, saturation: 0.8, temperature: 5000, hue: 15 } }],
    })

    expect(filterComplex).toContain('eq=brightness=0.1:contrast=1.2:saturation=0.8')
    expect(filterComplex).toContain('colortemperature=temperature=5000')
    expect(filterComplex).toContain('hue=h=15')
  })

  it('skips no-op color_adjust params', () => {
    const { filterComplex } = compile({
      effects: [{ kind: 'color_adjust', params: { brightness: 0, contrast: 1, saturation: 1, temperature: 6500, hue: 0 } }],
    })

    expect(filterComplex).not.toContain('eq=')
    expect(filterComplex).not.toContain('colortemperature')
    expect(filterComplex).not.toContain('hue=h=')
  })

  it('compiles blur, sharpen, vignette, grain', () => {
    const { filterComplex } = compile({
      effects: [
        { kind: 'blur', params: { sigma: 4 } },
        { kind: 'sharpen', params: { amount: 1.5 } },
        { kind: 'vignette', params: { intensity: 0.5 } },
        { kind: 'grain', params: { strength: 20 } },
      ],
    })

    expect(filterComplex).toContain('gblur=sigma=4')
    expect(filterComplex).toContain('unsharp=5:5:1.5')
    expect(filterComplex).toContain('vignette=angle=0.785')
    expect(filterComplex).toContain('noise=alls=20:allf=t+u')
  })

  it('compiles glow as split + gblur + screen blend, preserving chain continuity', () => {
    const { filterComplex } = compile({
      effects: [{ kind: 'glow', params: { sigma: 10, opacity: 0.6 } }],
    })

    expect(filterComplex).toContain('split=2[fx0a][fx0b]')
    expect(filterComplex).toContain('[fx0b]gblur=sigma=10[fx0c]')
    expect(filterComplex).toContain('[fx0a][fx0c]blend=all_mode=screen:all_opacity=0.6[fx0d]')
    expect(filterComplex).toContain('[base][vc0]overlay=')
  })

  it('keeps unique labels across multiple glow effects in one clip', () => {
    const { filterComplex } = compile({
      effects: [
        { kind: 'blur', params: { sigma: 2 } },
        { kind: 'glow', params: { sigma: 10, opacity: 0.6 } },
        { kind: 'sharpen', params: { amount: 1.2 } },
        { kind: 'glow', params: { sigma: 6, opacity: 0.3 } },
      ],
    })

    expect(filterComplex).toContain('[1:v]trim=start=0:duration=4,setpts=PTS-STARTPTS,gblur=sigma=2,split=2[fx0a][fx0b]')
    expect(filterComplex).toContain('[fx0d]unsharp=5:5:1.2,split=2[fx1a][fx1b]')
    expect(filterComplex).toContain('[fx1a][fx1c]blend=all_mode=screen:all_opacity=0.3[fx1d]')
    expect(filterComplex).toContain('[fx1d]null[vc0]')
  })

  it('fails fast for effect kinds owned by later phase tasks', () => {
    expect(compileError({
      effects: [{ kind: 'chroma_key', params: { color: '#00ff00', similarity: 0.25, blend: 0.1 } }],
    })).toBe('unsupported video editor effect: chroma_key')
  })

  it('keeps legacy output byte-identical when no effects are present', () => {
    const { filterComplex } = compile({})

    expect(filterComplex).toContain('[1:v]trim=start=0:duration=4,setpts=PTS-STARTPTS[vc0]')
  })

  it('applies effects before transform filters', () => {
    const { filterComplex } = compile({
      effects: [{ kind: 'blur', params: { sigma: 4 } }],
      transform: { scale: 1.2, rotation: 15 },
    })

    expect(filterComplex).toContain(
      '[1:v]trim=start=0:duration=4,setpts=PTS-STARTPTS,gblur=sigma=4,scale=w=iw*1.2:h=ih*1.2,rotate=0.262:c=black@0[vc0]',
    )
  })

  it('applies effects after speed-ramp concat and before transforms', () => {
    const { filterComplex } = compile({
      effects: [{ kind: 'blur', params: { sigma: 4 } }],
      transform: { scale: 1.2 },
      keyframes: [
        { property: 'speed', atSeconds: 0, value: 1 },
        { property: 'speed', atSeconds: 4, value: 2 },
      ],
    })

    expect(filterComplex).toContain('[vr0s0][vr0s1][vr0s2][vr0s3]concat=n=4:v=1:a=0[vr0c]')
    expect(filterComplex).toContain('[vr0c]gblur=sigma=4,scale=w=iw*1.2:h=ih*1.2[vc0]')
  })
})
