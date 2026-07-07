import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const modulePath = join(process.cwd(), 'scripts/higgsfield-executor/lib/editor-stabilize.mjs')

function runModule<T>(code: string): T {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import * as m from ${JSON.stringify(`file://${modulePath}`)};
    const result = await (async () => { ${code} })();
    process.stdout.write(JSON.stringify(result));
  `], { encoding: 'utf8' })
  return JSON.parse(stdout) as T
}

describe('vidstab two-pass arg builders', () => {
  it('derives path-safe clip tokens', () => {
    const token = runModule<string>(`return m.stableClipToken('../evil/clip')`)

    expect(token).toMatch(/^[0-9a-f]{16}$/)
    expect(token).not.toContain('/')
    expect(token).toBe(runModule<string>(`return m.stableClipToken('../evil/clip')`))
  })

  it('builds detect args', () => {
    expect(runModule<string[]>(`return m.buildVidstabDetectArgs('/w/in.mp4', '/w/c1.trf', { shakiness: 7 })`)).toEqual([
      '-y', '-i', '/w/in.mp4',
      '-vf', 'vidstabdetect=shakiness=7:result=/w/c1.trf',
      '-f', 'null', '-',
    ])
  })

  it('builds transform args with defaults clamped', () => {
    expect(runModule<string[]>(`return m.buildVidstabTransformArgs('/w/in.mp4', '/w/c1.trf', '/w/out.mp4', {})`)).toEqual([
      '-y', '-i', '/w/in.mp4',
      '-vf', 'vidstabtransform=input=/w/c1.trf:smoothing=10,unsharp=5:5:0.8:3:3:0.4',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'copy', '/w/out.mp4',
    ])
  })

  it('finds stabilize effects on a timeline', () => {
    const found = runModule<Array<{ clipId: string; params: Record<string, number> }>>(`return m.collectStabilizeClips(${JSON.stringify({
      version: 1,
      tracks: [{
        id: 't1', kind: 'video',
        clips: [
          { id: 'c1', timelineStart: 0, duration: 4, media: { type: 'upload', fileId: 'f1', url: 'https://x/a.mp4', mediaKind: 'video' }, effects: [{ kind: 'stabilize', params: { shakiness: 6, smoothing: 20 } }] },
          { id: 'c2', timelineStart: 4, duration: 2, media: { type: 'upload', fileId: 'f2', url: 'https://x/b.mp4', mediaKind: 'image' }, effects: [{ kind: 'stabilize', params: {} }] },
        ],
      }],
    })})`)

    expect(found).toEqual([{ clipId: 'c1', params: { shakiness: 6, smoothing: 20 } }])
  })
})
